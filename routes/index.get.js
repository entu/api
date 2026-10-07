// Deployment version probe, not part of the API surface, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const { commitHash } = useRuntimeConfig(event)

  return { version: commitHash }
})
