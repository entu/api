// Monthly AI token allowance used when the database entity has no billing_tokens_limit property
export const aiTokensLimitDefault = 100000

// How many times a rate-limited AI request is retried before failing
const maxRateLimitRetries = 2

// Throws when the account's monthly AI token limit is reached - check before making costly AI requests
export async function aiCheckTokensLimit (entu) {
  const month = new Date().toISOString().slice(0, 7)

  const [database, usage] = await Promise.all([
    entu.db.collection('entity').findOne({ 'private._type.string': 'database' }, { projection: { 'private.billing_tokens_limit.number': true } }),
    entu.db.collection('stats').findOne({ date: month, function: 'AI' })
  ])

  const limit = database?.private?.billing_tokens_limit?.at(0)?.number || aiTokensLimitDefault
  const used = (usage?.promptTokens || 0) + (usage?.completionTokens || 0)

  if (used >= limit) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Tokens limit reached'
    })
  }
}

// Calls the configured OpenAI-compatible chat completions API, records usage stats and returns the parsed response
export async function aiChatCompletion ({ entu, messages, tools }) {
  const { aiKey, aiModel, aiUrl } = useRuntimeConfig()

  const body = {
    model: aiModel,
    messages,
    max_tokens: 4096
  }

  if (tools) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  let response

  // Rate-limit responses are retried with backoff, everything else fails as a generic 502
  for (let attempt = 0; ; attempt++) {
    try {
      response = await $fetch(aiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}` },
        body,
        signal: AbortSignal.timeout(120000)
      })

      break
    }
    catch (error) {
      if (error.status === 429 && attempt < maxRateLimitRetries) {
        const retryAfter = Math.min(Number(error.response?.headers?.get('retry-after')) || 5 * (attempt + 1), 30)

        logger(`AI request rate limited, retrying in ${retryAfter}s`, entu)

        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        continue
      }

      loggerError(`AI request failed: ${error.status || ''} ${error.message || error}`, entu)

      throw createError({
        statusCode: 502,
        statusMessage: 'AI service error'
      })
    }
  }

  recordUsage(entu, response).catch((error) => loggerError(`AI stats write failed: ${error.message || error}`, entu))

  return response
}

// Accumulates per-db AI usage into the stats collection at day/month/year granularity - same pattern as plugins/stats.js
async function recordUsage (entu, response) {
  const usage = response?.usage

  if (!usage)
    return

  const inc = {
    count: 1,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    cacheCreatedTokens: usage.cache_created_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || usage.prompt_tokens_details?.cached_tokens || 0
  }

  const date = new Date().toISOString()

  await entu.db.collection('stats').bulkWrite([
    { updateOne: { filter: { date: date.slice(0, 10), function: 'AI' }, update: { $inc: inc }, upsert: true } },
    { updateOne: { filter: { date: date.slice(0, 7), function: 'AI' }, update: { $inc: inc }, upsert: true } },
    { updateOne: { filter: { date: date.slice(0, 4), function: 'AI' }, update: { $inc: inc }, upsert: true } }
  ])
}
