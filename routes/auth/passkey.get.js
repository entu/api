import { generateAuthenticationOptions } from '@simplewebauthn/server'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { hostname } = getRequestURL(event)

  const options = await generateAuthenticationOptions({
    rpID: hostname,
    userVerification: 'preferred',
    allowCredentials: []
  })

  return options
})
