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

// Downloads an original file from the files bucket as a Buffer. Throws if the
// object exceeds maxBytes (authoritative size check on the actual object).
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

  return Buffer.from(await response.Body.transformToByteArray())
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

// Uploads a generated thumbnail to the thumbnails bucket.
export async function putThumbnail (key, body, contentType) {
  const { s3BucketThumbnails } = useRuntimeConfig()

  await getS3Client().send(new PutObjectCommand({
    Bucket: s3BucketThumbnails,
    Key: key,
    ACL: 'private',
    ContentType: contentType,
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
