export default defineEventHandler((event) => {
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
