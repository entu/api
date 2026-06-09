export const ALLOWED_SIZES = [50, 200, 400]

export function parseThumbnailSize (event) {
  const size = Number.parseInt(getRouterParam(event, 'size'), 10)

  if (!ALLOWED_SIZES.includes(size)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid size. Allowed sizes: ${ALLOWED_SIZES.join(', ')}`
    })
  }

  return size
}
