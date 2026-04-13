import jwt from 'jsonwebtoken'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start OAuth flow via OAuth.ee. Redirects to provider login, exchanges authorization code for user profile, matches or creates person entity, and redirects back with a temporary session token. Exchange it at `/auth` for a JWT.',
    security: [], // No authentication required for OAuth callback
    parameters: [
      {
        name: 'provider',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          enum: ['e-mail', 'google', 'apple', 'smart-id', 'mobile-id', 'id-card'],
          description: 'OAuth provider'
        }
      },
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'URL to redirect to after successful authentication'
        }
      },
      {
        name: 'code',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth authorization code from provider'
        }
      },
      {
        name: 'error',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth error message if authentication failed'
        }
      },
      {
        name: 'state',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth state parameter for CSRF protection'
        }
      }
    ],
    responses: {
      200: {
        description: 'Temporary session token (when `next` is not set)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Session token — exchange at `/auth` for JWT', example: 'M2s8xKpwxG77JYxbx7xw4cS9' }
              }
            }
          }
        }
      },
      302: {
        description: 'Redirect to `next` URL with session token appended, or redirect to OAuth provider'
      },
      400: {
        description: 'OAuth error from provider',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const provider = getRouterParam(event, 'provider')
  const { jwtSecret, oauthId, oauthSecret } = useRuntimeConfig(event)
  const { code, error, state } = getQuery(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')

  if (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error
    })
  }

  if (code && state) {
    const decodedState = jwt.verify(state, jwtSecret, { audience })

    const accessToken = await getToken(code, oauthId, oauthSecret)
    const profile = await $fetch(`https://oauth.ee/api/user?access_token=${accessToken}`)

    const user = {
      ip: audience,
      provider: profile.provider,
      id: profile.id,
      name: profile.name,
      email: profile.email
    }

    const sessionId = await addUserSession(user, jwtSecret)

    if (decodedState.next) {
      return redirect(`${decodedState.next}${sessionId}`, 302)
    }
    else {
      return { key: sessionId }
    }
  }
  else {
    const state = jwt.sign({ next: getQuery(event).next }, jwtSecret, {
      audience,
      expiresIn: '5m'
    })

    const { origin, pathname } = getRequestURL(event)

    const url = new URL('https://oauth.ee')
    url.pathname = `/auth/${provider}`
    url.search = new URLSearchParams({
      client_id: oauthId,
      redirect_uri: `${origin}${pathname}`,
      response_type: 'code',
      scope: 'openid',
      state
    }).toString()

    return redirect(url.toString(), 302)
  }
})

async function getToken (code, oauthId, oauthSecret) {
  const tokenResponse = await $fetch('https://oauth.ee/api/token', {
    method: 'POST',
    body: {
      client_id: oauthId,
      client_secret: oauthSecret,
      code,
      grant_type: 'authorization_code'
    }
  })

  return tokenResponse.access_token
}

async function addUserSession (user, jwtSecret) {
  const connection = await connectDb('entu')

  const session = await connection.collection('session').insertOne({
    created: new Date(),
    user
  })

  return jwt.sign({}, jwtSecret, {
    audience: user.ip,
    subject: session.insertedId.toString(),
    expiresIn: '5m'
  })
}
