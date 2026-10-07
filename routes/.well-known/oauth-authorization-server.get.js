// RFC 8414 discovery document - OAuth client libraries fetch it themselves, so it stays out of the spec
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const base = oauthBaseUrl(event)

  return {
    issuer: base,
    authorization_endpoint: `${base}/auth/authorize`,
    token_endpoint: `${base}/auth/token`,
    registration_endpoint: `${base}/auth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  }
})
