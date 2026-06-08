import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let s3Client

function getS3Client () {
  if (!s3Client) {
    const { s3Region, s3Endpoint, s3Key, s3Secret } = useRuntimeConfig()

    s3Client = new S3Client({
      region: s3Region,
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: s3Key,
        secretAccessKey: s3Secret
      }
    })
  }

  return s3Client
}

export async function getSignedDownloadUrl (account, entityId, property) {
  const { s3BucketFiles } = useRuntimeConfig()

  const command = new GetObjectCommand({
    Bucket: s3BucketFiles,
    Key: getFileKey(account, entityId, property)
  })

  return await getSignedUrl(getS3Client(), command, { expiresIn: 60 })
}

export async function getSignedUploadUrl (account, entityId, property, contentDisposition, contentType) {
  const { s3BucketFiles } = useRuntimeConfig()

  const command = new PutObjectCommand({
    Bucket: s3BucketFiles,
    Key: getFileKey(account, entityId, property),
    ACL: 'private',
    ContentDisposition: contentDisposition,
    ContentType: contentType
  })

  return await getSignedUrl(getS3Client(), command, { expiresIn: 60 })
}

// Downloads an original file from the files bucket. Returns the bytes as a
// Buffer plus the object's stored S3 ContentType. Throws if the object exceeds
// maxBytes (authoritative size check on the actual object).
export async function getFileBuffer (account, entityId, property, maxBytes) {
  const { s3BucketFiles } = useRuntimeConfig()

  const response = await getS3Client().send(new GetObjectCommand({
    Bucket: s3BucketFiles,
    Key: getFileKey(account, entityId, property)
  }))

  if (maxBytes && response.ContentLength > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large to process (max ${maxBytes} bytes)`
    })
  }

  return {
    buffer: Buffer.from(await response.Body.transformToByteArray()),
    contentType: response.ContentType
  }
}

// Returns true if a thumbnail object already exists in the thumbnails bucket.
export async function thumbnailExists (key) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  try {
    await getS3Client().send(new HeadObjectCommand({
      Bucket: s3BucketThumbnails,
      Key: key
    }))

    return true
  }
  catch {
    return false
  }
}

// Uploads a generated thumbnail to the thumbnails bucket. The object is
// immutable for its key (keyed by file property _id + size), so it carries a
// long immutable Cache-Control for browsers/CDNs fetching the signed URL.
export async function putThumbnail (key, body, contentType) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  await getS3Client().send(new PutObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key,
    ACL: 'private',
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Body: body
  }))
}

// Returns a signed download URL for a thumbnail object.
export async function getSignedThumbnailUrl (key) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  const command = new GetObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key
  })

  return await getSignedUrl(getS3Client(), command, { expiresIn: 60 })
}

export function getFileKey (account, entityId, property) {
  return `${account}/${entityId}/${property._id}`
}

export function getThumbnailKey (account, entityId, property, size) {
  return `${account}/${entityId}/${property._id}_${size}.jpg`
}

const PREVIEWABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif', 'pdf']

// Cheap pre-filter so obviously non-previewable files are rejected before any
// S3 download. Trust the DB filetype when present; legacy uploads may lack it,
// so fall back to the filename extension. getThumbnail remains the
// authoritative byte-level guard for genuinely undecodable sources.
export function isPreviewableFile (property) {
  if (!property?.filename) {
    return false
  }

  if (property.filetype) {
    return property.filetype.startsWith('image/') || property.filetype === 'application/pdf'
  }

  const extension = property.filename.split('.').pop()?.toLowerCase()

  return PREVIEWABLE_EXTENSIONS.includes(extension)
}
