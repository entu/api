import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

// Returns a thumbnail object's metadata ({ color } may be missing on older thumbnails), or undefined if the thumbnail does not exist.
export async function getThumbnailMetadata (key) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  try {
    const response = await getS3Client().send(new HeadObjectCommand({
      Bucket: s3BucketThumbnails,
      Key: key
    }))

    return response.Metadata || {}
  }
  catch {
    return
  }
}

// Downloads a thumbnail object's bytes.
export async function getThumbnailBuffer (key) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  const response = await getS3Client().send(new GetObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key
  }))

  return Buffer.from(await response.Body.transformToByteArray())
}

// Uploads a generated thumbnail with its dominant color as object metadata; keyed by file _id and size, so it is cached as immutable.
export async function putThumbnail (key, body, contentType, color) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  await getS3Client().send(new PutObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key,
    ACL: 'private',
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { color },
    Body: body
  }))
}

// Adds the dominant color to an existing thumbnail's metadata by copying the object onto itself.
export async function setThumbnailColor (key, contentType, color) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  await getS3Client().send(new CopyObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key,
    CopySource: encodeURI(`${s3BucketThumbnails}/${key}`),
    MetadataDirective: 'REPLACE',
    ACL: 'private',
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { color }
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
