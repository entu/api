import { Jimp } from 'jimp'
import * as mupdf from 'mupdf'

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

  // Route on the actual bytes / S3 ContentType rather than DB metadata, which
  // legacy files may lack. PDFs start with the `%PDF-` magic; everything else
  // goes to Jimp, which validates real image bytes and rejects anything else.
  const isPdf = (contentType || '').toLowerCase() === 'application/pdf'
    || source.subarray(0, 5).toString('latin1') === '%PDF-'

  const { buffer, color } = await renderThumbnail(source, isPdf, size)

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
    const color = getDominantColor(await Jimp.read(await getThumbnailBuffer(key)))

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
function getDominantColor (image) {
  const { data } = image.clone().resize({ w: KMEANS_SAMPLE_SIZE, h: KMEANS_SAMPLE_SIZE }).bitmap
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

// Renders a source image or PDF buffer to a square, center cover-cropped JPEG and its dominant color.
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

    return {
      buffer: await image.getBuffer('image/jpeg'),
      color: getDominantColor(image)
    }
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
