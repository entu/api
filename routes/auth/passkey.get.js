import { generateAuthenticationOptions } from '@simplewebauthn/server'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { passkeyRpId } = useRuntimeConfig(event)

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId,
    userVerification: 'preferred',
    allowCredentials: []
  })

  return options
})
