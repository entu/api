import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
  const { s3Bucket } = useRuntimeConfig()

  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: getKey(account, entityId, property)
  })

  return await getSignedUrl(getS3Client(), command, { expiresIn: 60 })
}

export async function getSignedUploadUrl (account, entityId, property, contentDisposition, contentType) {
  const { s3Bucket } = useRuntimeConfig()

  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: getKey(account, entityId, property),
    ACL: 'private',
    ContentDisposition: contentDisposition,
    ContentType: contentType
  })

  return await getSignedUrl(getS3Client(), command, { expiresIn: 60 })
}

function getKey (account, entityId, property) {
  return `${account}/${entityId}/${property._id}`
}
