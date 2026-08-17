defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const { commitHash } = useRuntimeConfig(event)

  return { version: commitHash }
})
