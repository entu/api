defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start the OAuth 2.1 authorization code flow (PKCE required) in the user\'s browser. See [Authorize](https://entu.ee/api/authentication/#authorize).',
    security: [], // The user is not authenticated yet — that is what this flow does
    parameters: [
      {
        name: 'client_id',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          description: 'From `POST /auth/register`'
        }
      },
      {
        name: 'redirect_uri',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          description: 'A registered redirect URI',
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
          description: 'Only `code`'
        }
      },
      {
        name: 'code_challenge',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          minLength: 43,
          description: 'base64url SHA-256 of the verifier'
        }
      },
      {
        name: 'code_challenge_method',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['S256'],
          description: 'Only `S256`'
        }
      },
      {
        name: 'db',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Database to scope to; required without `resource`',
          example: 'mydatabase'
        }
      },
      {
        name: 'resource',
        in: 'query',
        schema: {
          type: 'string',
          description: 'RFC 8707 resource, database as first path segment; host in the API\'s parent domain',
          example: 'https://mcp.entu.app/mydatabase'
        }
      },
      {
        name: 'provider',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['passkey', 'apple', 'google', 'e-mail', 'smart-id', 'mobile-id', 'id-card'],
          description: 'Skip the provider choice'
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'OAuth.ee page language'
        }
      },
      {
        name: 'state',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Returned unchanged'
        }
      }
    ],
    responses: {
      302: { description: 'To the login, or to `redirect_uri` with an OAuth error' },
      400: {
        description: 'Invalid `client_id` (`invalid_grant`), unregistered `redirect_uri` (`invalid_request`), invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Database name is a reserved route name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

// Providers a client may ask for - the same list as /auth/{provider}, plus passkey
const providers = ['passkey', 'apple', 'google', 'e-mail', 'smart-id', 'mobile-id', 'id-card']

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

  const account = formatDatabaseName(query.db || parseResourceAccount(event, query.resource))

  if (!account) {
    return redirectWithError(event, query, 'invalid_request', 'Missing database - add it as the resource or db parameter')
  }

  if (query.provider !== undefined && !providers.includes(query.provider)) {
    return redirectWithError(event, query, 'invalid_request', `Unknown provider - use one of ${providers.join(', ')}`)
  }

  // The authorization travels inside the login state and comes back to /auth/callback with the login
  return oauthStartLogin(event, {
    provider: query.provider,
    state: {
      account,
      clientState: query.state,
      codeChallenge: query.code_challenge,
      redirectUri: query.redirect_uri
    }
  })
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

// Reads the database name from an RFC 8707 resource indicator such as https://mcp.entu.app/mydatabase. The resource
// has to be one of ours - api and mcp are separate hosts in the same domain, so the domain is what gets compared.
function parseResourceAccount (event, resource) {
  if (typeof resource !== 'string' || !URL.canParse(resource)) return

  const host = new URL(oauthApiUrl(event)).hostname
  const domain = host.includes('.') ? host.slice(host.indexOf('.')) : undefined
  const { hostname, pathname } = new URL(resource)

  if (hostname !== host && !(domain && hostname.endsWith(domain))) return

  return pathname.split('/').filter((x) => x).at(0)
}
