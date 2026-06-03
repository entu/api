import { generateAuthenticationOptions } from '@simplewebauthn/server'
import jwt from 'jsonwebtoken'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { passkeyRpId, jwtSecret } = useRuntimeConfig(event)

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId,
    userVerification: 'preferred',
    allowCredentials: []
  })

  const challengeToken = jwt.sign({ challenge: options.challenge }, jwtSecret, { expiresIn: '5m' })

  return { ...options, challengeToken }
})
