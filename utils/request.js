// Real client address. The platform appends it to X-Forwarded-For, so the last entry is the only one a client cannot
// forge - anything it sends of its own lands to the left of that. Never use the first entry: it is caller-supplied.
export function requestIp (event) {
  const forwarded = event.req.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',').at(-1).trim() : undefined

  return (ip || event.req.context?.clientAddress || event.req.ip || '127.0.0.1').replace('::1', '127.0.0.1')
}
