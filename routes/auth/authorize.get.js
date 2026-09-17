defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start the OAuth 2.1 authorization flow. Validates the client and PKCE challenge, then hands the user to the normal Entu login, where OAuth.ee asks which provider to use. Open this in the user\'s browser, not from your server. Once the login completes, the client\'s `redirect_uri` receives `code` and `state`; exchange the code at `/auth/token`.',
    security: [], // The user is not authenticated yet — that is what this flow does
    parameters: [
      {
        name: 'client_id',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          description: 'Client id issued by /auth/register'
        }
      },
      {
        name: 'redirect_uri',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          description: 'Where to return the user — must be one of the URIs registered for this client',
          example: 'https://your-app.com/callback'
        }
      },
      {
        name: 'response_type',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['code'],
          description: 'Only the authorization code flow is supported'
        }
      },
      {
        name: 'code_challenge',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          description: 'PKCE challenge — base64url SHA-256 of the code verifier, at least 43 characters'
        }
      },
      {
        name: 'code_challenge_method',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['S256'],
          description: 'PKCE method — plain challenges are rejected'
        }
      },
      {
        name: 'db',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Database this authorization is scoped to. Required unless `resource` is given',
          example: 'mydatabase'
        }
      },
      {
        name: 'resource',
        in: 'query',
        schema: {
          type: 'string',
          description: 'RFC 8707 resource indicator naming the database, as an alternative to `db`',
          example: 'https://mcp.entu.app/mydatabase'
        }
      },
      {
        name: 'state',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Opaque value returned unchanged to the redirect URI'
        }
      }
    ],
    responses: {
      302: { description: 'Redirect to the login, or back to the client redirect URI with an OAuth error' },
      400: {
        description: 'Unknown client_id, or a redirect_uri not registered for it',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const client = oauthVerify(event, 'client', query.client_id)

  if (!client.redirectUris.includes(query.redirect_uri)) {
    throw oauthError('invalid_request', 'redirect_uri is not registered for this client')
  }

  // Everything below is reported to the client's redirect_uri, now that it is known to be genuine
  if (query.response_type !== 'code') {
    return redirectWithError(event, query, 'unsupported_response_type', 'Only response_type=code is supported')
  }

  if (query.code_challenge_method !== 'S256') {
    return redirectWithError(event, query, 'invalid_request', 'Only code_challenge_method=S256 is supported')
  }

  if (typeof query.code_challenge !== 'string' || query.code_challenge.length < 43) {
    return redirectWithError(event, query, 'invalid_request', 'Missing code_challenge')
  }

  const account = formatDatabaseName(query.db || parseResourceAccount(query.resource))

  if (!account) {
    return redirectWithError(event, query, 'invalid_request', 'Missing database - add it as the resource or db parameter')
  }

  const state = oauthSign(event, 'state', {
    account,
    clientState: query.state,
    codeChallenge: query.code_challenge,
    redirectUri: query.redirect_uri
  })

  // /auth starts the login and appends the session id to `next`, so `next` has to end with the parameter receiving it
  const next = `${oauthBaseUrl(event)}/auth/callback?state=${state}&token=`

  return sendRedirect(event, `${oauthBaseUrl(event)}/auth?next=${encodeURIComponent(next)}`, 302)
})

// Sends the user back to the client with an OAuth error, as required once the redirect_uri is validated
function redirectWithError (event, query, error, description) {
  const url = new URL(query.redirect_uri)

  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)

  if (query.state) {
    url.searchParams.set('state', query.state)
  }

  return sendRedirect(event, url.toString(), 302)
}

// Reads the database name from an RFC 8707 resource indicator such as https://mcp.entu.app/mydatabase
function parseResourceAccount (resource) {
  if (typeof resource !== 'string' || !URL.canParse(resource)) return

  return new URL(resource).pathname.split('/').filter((x) => x).at(0)
}
