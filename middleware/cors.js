export default defineEventHandler((event) => {
  if (event.method !== 'OPTIONS') return

  setResponseStatus(event, 204)

  return ''
})
