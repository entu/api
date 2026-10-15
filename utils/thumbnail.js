import decodeHeic from 'heic-decode'
import * as mupdf from 'mupdf'
import sharp from 'sharp'

// Untrusted uploads may reach only the buffer loaders of the formats we thumbnail; libvips' own, CSV, matrix and other loaders stay blocked. Raw input needs no loader.
sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({
  operation: [
    'VipsForeignLoadJpegBuffer',
    'VipsForeignLoadUhdrBuffer',
    'VipsForeignLoadPngBuffer',
    'VipsForeignLoadWebpBuffer',
    'VipsForeignLoadNsgifBuffer',
    'VipsForeignLoadTiffBuffer',
    'VipsForeignLoadHeifBuffer',
    'VipsForeignLoadSvgBuffer'
  ]
})

const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_RENDER_DIM = 2000
const MAX_PIXELS = 40000000

// Stored when a thumbnail has no colorful dominant color, so it is not recomputed on every request.
const NO_COLOR = 'none'
const COLOR_PATTERN = /^#[\da-f]{6}$/

// Returns a signed URL and the dominant color (#rrggbb, omitted when none) of a file's square thumbnail, generating and caching it on first request.
export async function getThumbnail (account, entityId, photo, size) {
  if (!isPreviewableFile(photo)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File is not a previewable file'
    })
  }

  const thumbnailKey = getThumbnailKey(account, entityId, photo, size)
  const metadata = await getThumbnailMetadata(thumbnailKey)

  if (metadata) {
    if (metadata.color !== NO_COLOR && !COLOR_PATTERN.test(metadata.color)) {
      addThumbnailColor(thumbnailKey)
    }

    return {
      url: await getSignedThumbnailUrl(thumbnailKey),
      color: COLOR_PATTERN.test(metadata.color) ? metadata.color : undefined
    }
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

  const { buffer, color } = await renderThumbnail(source, contentType, size, thumbnailKey)

  await putThumbnail(thumbnailKey, buffer, 'image/jpeg', color)

  return {
    url: await getSignedThumbnailUrl(thumbnailKey),
    color: COLOR_PATTERN.test(color) ? color : undefined
  }
}

// Thumbnail keys whose color is being added, or failed to store, in this process; each is attempted once so a refused copy cannot repeat the work.
const colorBackfills = new Set()

// Adds the dominant color to a thumbnail made before colors were stored, in the background; the request that triggers it is answered without a color.
async function addThumbnailColor (key) {
  if (colorBackfills.has(key)) return

  colorBackfills.add(key)

  try {
    const color = await getDominantColor(sharp(await getThumbnailBuffer(key)))

    await setThumbnailColor(key, 'image/jpeg', color)

    colorBackfills.delete(key)
  }
  catch (error) {
    // The color stays missing until the API restarts; the thumbnail itself is unaffected.
    loggerError(`thumbnail color not stored for ${key}: ${error.message}`)
  }
}

// Same parameters as the native app's CIKMeans call in `dominantRGB`.
const KMEANS_CLUSTERS = 6
const KMEANS_PASSES = 10

// Clustering runs on a downscaled copy; 4096 pixels are ample for 6 clusters and keep the event loop free.
const KMEANS_SAMPLE_SIZE = 64

// The native app's `dominantRGB`: k-means (6 clusters, 10 passes) in linear RGB, clusters ranked by pixel share, the heaviest colorful one wins, else the heaviest; as sRGB #rrggbb.
async function getDominantColor (image) {
  const data = await image.resize(KMEANS_SAMPLE_SIZE, KMEANS_SAMPLE_SIZE, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
  const pixels = []

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    pixels.push([toLinear(data[i] / 255), toLinear(data[i + 1] / 255), toLinear(data[i + 2] / 255)])
  }

  if (pixels.length === 0) {
    return NO_COLOR
  }

  const means = seedMeans(pixels, KMEANS_CLUSTERS)
  let counts = []

  for (let pass = 0; pass < KMEANS_PASSES; pass++) {
    const sums = means.map(() => [0, 0, 0])

    counts = means.map(() => 0)

    for (const pixel of pixels) {
      const nearest = nearestMean(means, pixel)

      counts[nearest]++
      sums[nearest][0] += pixel[0]
      sums[nearest][1] += pixel[1]
      sums[nearest][2] += pixel[2]
    }

    for (const [index, sum] of sums.entries()) {
      if (counts[index] === 0) continue

      means[index] = sum.map((x) => x / counts[index])
    }
  }

  const clusters = means
    .map((mean, index) => ({ weight: counts[index], red: toSrgb(mean[0]), green: toSrgb(mean[1]), blue: toSrgb(mean[2]) }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  const winner = clusters.find(isColorful) || clusters.at(0)

  return `#${[winner.red, winner.green, winner.blue].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`
}

// Deterministic farthest-point seeding: the average color first, then repeatedly the pixel farthest from every chosen mean.
function seedMeans (pixels, count) {
  const average = [0, 1, 2].map((channel) => pixels.reduce((sum, x) => sum + x[channel], 0) / pixels.length)
  const means = [average]

  while (means.length < count) {
    let farthest = pixels.at(0)
    let farthestDistance = -1

    for (const pixel of pixels) {
      const distance = colorDistance(pixel, means[nearestMean(means, pixel)])

      if (distance > farthestDistance) {
        farthest = pixel
        farthestDistance = distance
      }
    }

    means.push([...farthest])
  }

  return means
}

// Returns the index of the mean closest to the pixel.
function nearestMean (means, pixel) {
  let nearest = 0
  let nearestDistance = Infinity

  for (const [index, mean] of means.entries()) {
    const distance = colorDistance(pixel, mean)

    if (distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  }

  return nearest
}

function colorDistance (a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

// sRGB → linear transfer, the working space CIKMeans clusters in.
function toLinear (value) {
  return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

// Linear → sRGB transfer, as the native app applies to the cluster colors.
function toSrgb (value) {
  const v = Math.min(Math.max(value, 0), 1)

  return v <= 0.003_130_8 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

// The native app's rule: saturated and not near-black, so it can carry the entity's identity on a header.
function isColorful ({ red, green, blue }) {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const saturation = max === 0 ? 0 : (max - min) / max

  return saturation >= 0.15 && max >= 0.15
}

// ISO BMFF brands of HEVC-coded HEIF; AVIF shares the container but sharp decodes it itself.
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx'])
const FTYP_MAX_BYTES = 256

// Renders a source image or PDF buffer to a square, center cover-cropped JPEG and its dominant color.
async function renderThumbnail (source, contentType, size, key) {
  try {
    const { input, options } = await getSharpInput(source, contentType)
    const { width, height } = await sharp(input, { ...options, limitInputPixels: MAX_PIXELS }).metadata()

    assertPixelLimit(width, height)

    // The square crop is kept as raw RGBA so the JPEG and the color sample both start from it; sharp allows one resize per pipeline.
    const { data, info } = await sharp(input, { ...options, autoOrient: true, limitInputPixels: MAX_PIXELS })
      .resize(size, size, { fit: 'cover' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const raw = { raw: { width: info.width, height: info.height, channels: info.channels } }

    return {
      // JPEG has no alpha, so transparent pixels would encode as black; flatten onto white first.
      buffer: await sharp(data, raw).flatten({ background: '#ffffff' }).jpeg().toBuffer(),
      color: await getDominantColor(sharp(data, raw))
    }
  }
  catch (error) {
    if (error.statusCode) {
      throw error
    }

    loggerError(`thumbnail not generated for ${key}: ${error.message}`)

    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to generate thumbnail from file'
    })
  }
}

// Routes on the file's bytes and S3 ContentType, not DB metadata, which legacy files may lack; formats sharp cannot read are decoded first, the rest pass as-is.
async function getSharpInput (source, contentType) {
  if ((contentType || '').toLowerCase() === 'application/pdf' || source.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { input: renderFirstPage(source, 'application/pdf') }
  }

  if (source.toString('latin1', 0, 2) === 'BM') {
    // MuPDF decodes the whole bitmap before its size is known, so check the dimensions in the DIB header first.
    if (source.length < 26) {
      throw new Error('BMP header truncated')
    }

    // OS/2 BITMAPCOREHEADER (12 bytes) stores 16-bit dimensions; every later header stores signed 32-bit ones.
    if (source.readUInt32LE(14) === 12) {
      assertPixelLimit(source.readUInt16LE(18), source.readUInt16LE(20))
    }
    else {
      assertPixelLimit(Math.abs(source.readInt32LE(18)), Math.abs(source.readInt32LE(22)))
    }

    return { input: renderFirstPage(source, 'image/bmp') }
  }

  if (isHevcHeif(source)) {
    return await decodeHevcHeif(source)
  }

  return { input: source }
}

// Throws 400 when an image's pixel count is unknown or above MAX_PIXELS.
function assertPixelLimit (width, height) {
  if (width > 0 && height > 0 && width * height <= MAX_PIXELS) return

  throw createError({
    statusCode: 400,
    statusMessage: 'Image dimensions too large to process'
  })
}

// Decodes the primary HEVC HEIF image to raw RGBA sharp input, checking its declared size before any pixel buffer is allocated.
async function decodeHevcHeif (source) {
  const images = await decodeHeic.all({ buffer: source })

  try {
    const [image] = images

    assertPixelLimit(image.width, image.height)

    const { width, height, data } = await image.decode()

    return {
      input: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      options: { raw: { width, height, channels: 4 } }
    }
  }
  finally {
    images.dispose()
  }
}

// Renders the first page of a document or image MuPDF opens (PDF, BMP) to a PNG, its longest side capped at MAX_RENDER_DIM.
function renderFirstPage (source, magic) {
  const page = mupdf.Document.openDocument(source, magic).loadPage(0)
  const [x0, y0, x1, y1] = page.getBounds()
  const maxSide = Math.max(x1 - x0, y1 - y0)
  const scale = maxSide > MAX_RENDER_DIM ? MAX_RENDER_DIM / maxSide : 1
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false)

  return Buffer.from(pixmap.asPNG())
}

// Whether the source is HEIF holding HEVC images, by the major and compatible brands of its leading ftyp box.
function isHevcHeif (source) {
  if (source.length < 16 || source.subarray(4, 8).toString('latin1') !== 'ftyp') {
    return false
  }

  if (HEVC_BRANDS.has(source.toString('latin1', 8, 12))) {
    return true
  }

  // Real ftyp boxes list a handful of brands; the cap keeps a forged box size from scanning the whole file.
  const boxEnd = Math.min(source.readUInt32BE(0), source.length, FTYP_MAX_BYTES)

  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    if (HEVC_BRANDS.has(source.toString('latin1', offset, offset + 4))) {
      return true
    }
  }

  return false
}
