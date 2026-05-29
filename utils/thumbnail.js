import { Jimp } from 'jimp'
import * as mupdf from 'mupdf'

const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_RENDER_DIM = 2000
const MAX_PIXELS = 40000000

// Returns a signed URL for the square thumbnail of an entity's photo file at
// the given size, generating and caching it in the thumbnails bucket on first
// request. Throws on unsupported or undecodable source files.
export async function getThumbnail (account, entityId, photo, size) {
  const thumbnailKey = getThumbnailKey(account, entityId, photo, size)

  if (await thumbnailExists(thumbnailKey)) {
    return await getSignedThumbnailUrl(thumbnailKey)
  }

  let source
  let contentType
  try {
    ({ buffer: source, contentType } = await getFileBuffer(account, entityId, photo, MAX_SOURCE_BYTES))
  }
  catch (error) {
    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 404,
      statusMessage: 'File not found in storage'
    })
  }

  // Route on the actual bytes / S3 ContentType rather than DB metadata, which
  // legacy files may lack. PDFs start with the `%PDF-` magic; everything else
  // goes to Jimp, which validates real image bytes and rejects anything else.
  const isPdf = (contentType || '').toLowerCase() === 'application/pdf'
    || source.subarray(0, 5).toString('latin1') === '%PDF-'

  const thumbnail = await renderThumbnail(source, isPdf, size)

  await putThumbnail(thumbnailKey, thumbnail, 'image/jpeg')

  return await getSignedThumbnailUrl(thumbnailKey)
}

// Renders a source image or PDF buffer to a square, center cover-cropped JPEG.
async function renderThumbnail (source, isPdf, size) {
  try {
    // Normalize source to a raster buffer Jimp can read.
    let raster = source

    if (isPdf) {
      const doc = mupdf.Document.openDocument(source, 'application/pdf')
      const page = doc.loadPage(0)
      const [x0, y0, x1, y1] = page.getBounds()
      const maxSide = Math.max(x1 - x0, y1 - y0)
      const scale = maxSide > MAX_RENDER_DIM ? MAX_RENDER_DIM / maxSide : 1
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false)

      raster = Buffer.from(pixmap.asPNG())
    }

    const image = await Jimp.read(raster)

    if (image.bitmap.width * image.bitmap.height > MAX_PIXELS) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Image dimensions too large to process'
      })
    }

    image.cover({ w: size, h: size })

    return await image.getBuffer('image/jpeg')
  }
  catch (error) {
    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to generate thumbnail from file'
    })
  }
}
