export default defineEventHandler((event) => {
  const { commitHash } = useRuntimeConfig(event)

  return { version: commitHash }
})
