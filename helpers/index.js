'use strict'

const _pickBy = require('lodash/pickBy')
const _identity = require('lodash/identity')
const jwt = require('jsonwebtoken')
const { MongoClient, ObjectId } = require('mongodb')
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

let dbConnection

exports.db = async (dbName) => {
  dbName = dbName.replace(/[^a-z0-9]/gi, '_')

  if (dbConnection) { return dbConnection.db(dbName) }

  const dbClient = new MongoClient(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true })

  dbConnection = await dbClient.connect()
  dbConnection.on('close', () => {
    dbConnection = null
    console.log(`Disconnected from ${dbName}`)
  })

  console.log(`Connected to ${dbName}`)

  return dbConnection.db(dbName)
}

exports.getSignedDownloadUrl = async (key) => {
  const s3Region = process.env.S3_REGION
  const s3Bucket = process.env.S3_BUCKET

  const config = {
    region: s3Region,
    s3BucketEndpoint: true,
    endpoint: `https://s3.${s3Region}.amazonaws.com`
  }

  const s3 = new S3Client(config)
  const command = new GetObjectCommand({ Bucket: s3Bucket, Key: key })
  const url = await getSignedUrl(s3, command, { expiresIn: 60 })

  return url
}

exports.getSignedUploadUrl = async (key, filename, filetype) => {
  const s3Region = process.env.S3_REGION
  const s3Bucket = process.env.S3_BUCKET

  const config = {
    region: s3Region,
    s3BucketEndpoint: true,
    endpoint: `https://s3.${s3Region}.amazonaws.com`
  }

  const s3 = new S3Client(config)
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    ContentType: filetype,
    ContentDisposition: `inline;filename="${filename.replace('"', '\"')}"`,
    ACL: 'private',
    ServerSideEncryption: 'AES256'
  })
  const url = await getSignedUrl(s3, command, { expiresIn: 60 })

  return url
}

exports.user = async (event) => {
  return new Promise((resolve, reject) => {
    const jwtToken = this.getHeader(event, 'authorization').replace('Bearer ', '')
    const jwtConf = {
      issuer: event.queryStringParameters?.account,
      audience: event.requestContext?.http?.sourceIp
    }

    let result = {
      account: jwtConf.issuer
    }

    if (jwtToken) {
      try {
        const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET, jwtConf)

        if (decoded.aud !== jwtConf.audience) {
          return reject(new Error('401:Invalid JWT audience'))
        }

        result = {
          id: decoded.sub,
          account: decoded.iss
        }
      } catch (e) {
        return reject(new Error(`401:${e.message || e}`))
      }
    }

    if (!result.account) {
      return reject(new Error('401:No account parameter'))
    }

    this.db(result.account).then((x) => {
      result.db = x
      resolve(result)
    })
  })
}

exports.addUserSession = async (user) => {
  return new Promise((resolve, reject) => {
    if (!user) { return reject(new Error('No user')) }

    const session = {
      created: new Date(),
      user
    }

    this.db('entu').then((connection) => {
      connection.collection('session').insertOne(_pickBy(session, _identity)).then((result) => {
        const token = jwt.sign({}, process.env.JWT_SECRET, {
          audience: user.ip,
          subject: result.insertedId.toString(),
          expiresIn: '5m'
        })

        resolve(token)
      }).catch((err) => {
        reject(err)
      })
    }).catch((err) => {
      reject(err)
    })
  })
}

exports.strToId = (str) => {
  try {
    return new ObjectId(str)
  } catch (e) {
    throw new Error('Invalid _id')
  }
}

exports.getHeader = (event, headerKey) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v])
  )

  return headers[headerKey.toLowerCase()] || ''
}

exports.getBody = (event) => {
  let body = event.body

  if (!body) { return {} }

  if (event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString()
  }

  if (this.getHeader(event, 'content-type') === 'application/x-www-form-urlencoded') {
    const url = new URL('?' + body, 'http://localhost')
    return Object.fromEntries(url.searchParams)
  } else {
    return JSON.parse(body)
  }
}

exports.json = (data) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'X-Entu-Version': process.env.GIT_SHA },
    body: JSON.stringify(data),
    isBase64Encoded: false
  }
}

exports.error = (err) => {
  let code
  let message

  console.error(err)

  if (Array.isArray(err)) {
    code = err[0]
    message = err[1]

    console.error(code.toString(), message)
  } else if (parseInt(err.toString().split(':')[1])) {
    code = parseInt(err.toString().split(':')[1])
    message = err.toString()
  }

  return {
    statusCode: code || 500,
    headers: { 'Content-Type': 'application/json', 'X-Entu-Version': process.env.GIT_SHA },
    body: JSON.stringify({ message }),
    isBase64Encoded: false
  }
}

exports.redirect = (url) => {
  return {
    statusCode: 302,
    headers: { Location: url },
    body: null
  }
}
