defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    description: 'Chat with the Entu AI assistant. The assistant can read account configuration and data, and propose (but never apply) write operations. Proposed operations must be confirmed via the execute endpoint.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'db',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          description: 'Database name'
        }
      }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                description: 'Conversation history — 1 to 40 messages, newest last',
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['user', 'assistant'], description: 'Message author' },
                    content: { type: 'string', description: 'Message text (max 8000 characters)' }
                  },
                  required: ['role', 'content']
                }
              }
            },
            required: ['messages']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Assistant reply, optionally with proposed operations for user confirmation',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Assistant reply text' },
                usage: {
                  type: 'object',
                  description: 'Token usage for this turn (may span several internal model calls)',
                  properties: {
                    total: { type: 'integer', description: 'Total tokens processed this turn — input (incl. cache reads/writes) + completion' },
                    cached: { type: 'integer', description: 'Input tokens served from cache at the discounted rate (subset of total)' }
                  }
                },
                proposal: {
                  type: 'object',
                  description: 'Present only when the assistant proposed write operations',
                  properties: {
                    operations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          op: { type: 'string', description: 'Operation type' },
                          tempId: { type: 'string', description: 'Temporary id ("$1", "$2", ...) other operations may reference' },
                          params: { type: 'object', description: 'Operation parameters' },
                          description: { type: 'string', description: 'Human-readable description of the operation' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid messages',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      402: {
        description: 'Tokens limit reached',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      502: {
        description: 'AI service error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

const maxIterations = 10
const maxToolCallsPerTurn = 10
const maxMessages = 40
const maxMessageLength = 8000
const maxTotalLength = 100000
const maxOperations = 25

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const body = await event.req.json()
  const messages = validateMessages(body?.messages)

  const systemPrompt = await aiBuildSystemPrompt(entu)

  // cache_control caches the system prompt prefix across loop iterations and follow-up messages (5m TTL)
  const systemMessage = {
    role: 'system',
    content: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral', ttl: '5m' } }]
  }

  const loopMessages = [systemMessage, ...messages]
  const operations = []
  const usage = { total: 0, cached: 0 }
  let finalText
  let cachedTail

  for (let i = 0; i < maxIterations; i++) {
    const response = await aiChatCompletion({ entu, messages: loopMessages, tools: aiToolDefinitions })

    accumulateUsage(usage, response)

    const message = response?.choices?.at(0)?.message

    if (!message) {
      throw createError({
        statusCode: 502,
        statusMessage: 'AI service error'
      })
    }

    if (!message.tool_calls?.length) {
      finalText = message.content || ''
      break
    }

    loopMessages.push(message)

    for (let t = 0; t < message.tool_calls.length; t++) {
      const toolCall = message.tool_calls.at(t)
      const result = t < maxToolCallsPerTurn
        ? await executeToolCall(entu, toolCall, operations)
        : { error: 'Too many tool calls in one turn' }

      loopMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      })
    }

    // Roll the cache breakpoint onto the newest tool-result tail so the next iteration
    // (and the final summary call) read it at ~0.1x instead of reprocessing at full price
    cachedTail = moveCacheBreakpoint(loopMessages.at(-1), cachedTail)
  }

  // Iteration cap reached with tool calls still pending — force one final call without tools for a summary
  if (finalText === undefined) {
    const response = await aiChatCompletion({ entu, messages: loopMessages })

    accumulateUsage(usage, response)

    finalText = response?.choices?.at(0)?.message?.content || ''
  }

  return {
    message: finalText,
    proposal: operations.length > 0 ? { operations } : undefined,
    usage
  }
})

// Adds one AI response's token usage into the running per-turn totals returned to the client.
// DO reports usage two ways: OpenAI/open-source models fold cached tokens into prompt_tokens
// (surfaced as prompt_tokens_details.cached_tokens), while Anthropic models report prompt_tokens
// as the uncached remainder with cache read/creation counted separately. Both are normalised to a
// full token total; cached stays the discounted cache-read subset of it.
function accumulateUsage (usage, response) {
  const u = response?.usage

  if (!u) {
    return
  }

  const cacheRead = u.cache_read_input_tokens || u.prompt_tokens_details?.cached_tokens || 0
  const cacheCreated = u.cache_created_input_tokens || 0

  const inputTokens = u.prompt_tokens_details?.cached_tokens != null
    ? (u.prompt_tokens || 0)
    : (u.prompt_tokens || 0) + cacheRead + cacheCreated

  usage.total += inputTokens + (u.completion_tokens || 0)
  usage.cached += cacheRead
}

// Moves the single rolling cache breakpoint onto `message`, clearing it from `previous`.
// Only one tail breakpoint exists at a time — the system prompt already holds one, and
// Anthropic allows at most 4. Returns the newly marked message so the caller can track it.
function moveCacheBreakpoint (message, previous) {
  if (previous && previous !== message && Array.isArray(previous.content)) {
    previous.content = previous.content.at(0).text
  }

  message.content = [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral', ttl: '5m' } }]

  return message
}

// Validates the client-provided conversation and strips it down to role/content only
function validateMessages (messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > maxMessages) {
    throw createError({
      statusCode: 400,
      statusMessage: `Messages must be an array of 1 to ${maxMessages} items`
    })
  }

  let totalLength = 0

  for (const message of messages) {
    if (!message || typeof message !== 'object' || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each message must have role user or assistant and string content'
      })
    }

    if (message.content.length === 0 || message.content.length > maxMessageLength) {
      throw createError({
        statusCode: 400,
        statusMessage: `Message content must be 1 to ${maxMessageLength} characters`
      })
    }

    totalLength += message.content.length
  }

  if (totalLength > maxTotalLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `Total messages length must not exceed ${maxTotalLength} characters`
    })
  }

  return messages.map((message) => ({ role: message.role, content: message.content }))
}

// Runs a single tool call — read tools execute immediately, write tools are queued for user confirmation
async function executeToolCall (entu, toolCall, operations) {
  const name = toolCall.function?.name
  let args

  try {
    args = JSON.parse(toolCall.function?.arguments || '{}')
  }
  catch {
    return { error: 'Invalid tool arguments' }
  }

  if (aiReadToolNames.includes(name)) {
    try {
      return await aiExecuteReadTool(entu, name, args)
    }
    catch (error) {
      return { error: error.statusMessage || 'Tool error' }
    }
  }

  if (operations.length >= maxOperations) {
    return { error: `No more than ${maxOperations} operations can be queued` }
  }

  const operation = { op: name, params: args }

  try {
    aiValidateOperations([...operations, operation])
    await aiCheckUpdatableValues(entu, operation)
  }
  catch (error) {
    return { error: error.statusMessage || 'Invalid operation' }
  }

  operation.tempId = `$${operations.length + 1}`
  operation.description = aiDescribeOperation(operation)
  operation.properties = await aiPreviewOperationProperties(operation)

  operations.push(operation)

  return { queued: true, tempId: operation.tempId }
}
