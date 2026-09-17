defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start the OAuth 2.1 authorization flow. Validates the client and PKCE challenge, then hands the user to the normal `/auth/{provider}` login. Without a `provider` parameter it renders a provider picker for the user to choose from. Open this in the user\'s browser, not from your server. Once the login completes, the client\'s `redirect_uri` receives `code` and `state`; exchange the code at `/auth/token`.',
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
      },
      {
        name: 'provider',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['e-mail', 'google', 'apple', 'smart-id', 'mobile-id', 'id-card'],
          description: 'Login provider. Omit to let the user pick one'
        }
      },
      {
        name: 'ui_locales',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'Preferred login language. Falls back to the browser\'s Accept-Language'
        }
      }
    ],
    responses: {
      200: {
        description: 'Provider picker page, when no provider was given',
        content: { 'text/html': { schema: { type: 'string' } } }
      },
      302: { description: 'Redirect to the provider login, or back to the client redirect URI with an OAuth error' },
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

  if (!query.provider) {
    return renderProviderPicker(event, query)
  }

  if (!oauthProviders().includes(query.provider)) {
    return redirectWithError(event, query, 'invalid_request', 'Unknown provider')
  }

  const state = oauthSign(event, 'state', {
    account,
    clientState: query.state,
    codeChallenge: query.code_challenge,
    redirectUri: query.redirect_uri
  })

  // [provider].get.js appends the session id to `next`, so it has to end with the parameter that receives it
  const next = `${oauthBaseUrl(event)}/auth/callback?state=${state}&token=`
  const lang = resolveLang(event, query)
  const url = `${oauthBaseUrl(event)}/auth/${query.provider}?next=${encodeURIComponent(next)}${lang ? `&lang=${lang}` : ''}`

  return sendRedirect(event, url, 302)
})

// Login language from the client's ui_locales hint, else the browser's Accept-Language of the user opening this page
function resolveLang (event, query) {
  const wanted = `${query.ui_locales || ''},${event.req.headers.get('accept-language') || ''}`.toLowerCase()

  for (const part of wanted.split(/[\s,;]+/)) {
    if (languages.includes(part.split('-').at(0))) {
      return part.split('-').at(0)
    }
  }
}

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

// Minimal provider picker - OAuth clients open this in a browser, so the choice has to be made here
function renderProviderPicker (event, query) {
  const links = oauthProviders().map((provider) => {
    const url = new URL(`${oauthBaseUrl(event)}/auth/authorize`)

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }

    url.searchParams.set('provider', provider)

    return `<li><a href="${escapeHtml(url.toString())}">${escapeHtml(provider)}</a></li>`
  }).join('')

  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Entu</title></head>
<body style="font-family:system-ui,sans-serif;max-width:24rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Sign in to Entu</h1>
<ul style="line-height:2;list-style:none;padding:0">${links}</ul>
</body>
</html>`
}

// Escapes text interpolated into the picker markup
function escapeHtml (value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
