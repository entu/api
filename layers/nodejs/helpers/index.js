'use strict'

const _pickBy = require('lodash/pickBy')
const _identity = require('lodash/identity')
const jwt = require('jsonwebtoken')
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { MongoClient, ObjectId } = require('mongodb')

const ssmParameters = {}

let dbConnection

exports.ssmParameter = async (name) => {
  if (ssmParameters[name]) return ssmParameters[name]

  const ssmClient = new SSMClient()
  const command = new GetParameterCommand({ Name: `${process.env.STACK_NAME}-${name}`, WithDecryption: true })
  const ssmValue = await ssmClient.send(command)

  ssmParameters[name] = ssmValue.Parameter.Value

  return ssmValue.Parameter.Value
}

exports.db = async (dbName) => {
  dbName = dbName.replace(/[^a-z0-9]/gi, '_')

  if (dbConnection) return dbConnection.db(dbName)

  const mongoUrl = await this.ssmParameter('mongodb-url')
  const dbClient = new MongoClient(mongoUrl)

  dbConnection = await dbClient.connect()
  dbConnection.on('close', () => {
    dbConnection = null
    console.log(`Disconnected from ${dbName}`)
  })

  console.log(`Connected to ${dbName}`)

  return dbConnection.db(dbName)
}

exports.getSignedDownloadUrl = async (key) => {
  const s3Region = await this.ssmParameter('files-s3-region')
  const s3Bucket = await this.ssmParameter('files-s3-bucket')

  const config = {
    region: s3Region
    // s3BucketEndpoint: true,
    // endpoint: `https://s3.${s3Region}.amazonaws.com`
  }

  const s3 = new S3Client(config)
  const command = new GetObjectCommand({ Bucket: s3Bucket, Key: key })
  const url = await getSignedUrl(s3, command, { expiresIn: 60 })

  return url
}

exports.getSignedUploadUrl = async (key, filename, filetype, contentDisposition) => {
  const s3Region = await this.ssmParameter('files-s3-region')
  const s3Bucket = await this.ssmParameter('files-s3-bucket')

  const config = {
    region: s3Region
    // s3BucketEndpoint: true,
    // endpoint: `https://s3.${s3Region}.amazonaws.com`
  }

  const s3 = new S3Client(config)
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    ContentType: filetype,
    ContentDisposition: contentDisposition,
    ACL: 'private'
  })
  const url = await getSignedUrl(s3, command, { expiresIn: 60 })

  return url
}

exports.user = async (event) => {
  const jwtSecret = await this.ssmParameter('jwt-secret')

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
        const decoded = jwt.verify(jwtToken, jwtSecret, jwtConf)

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
  const jwtSecret = await this.ssmParameter('jwt-secret')

  return new Promise((resolve, reject) => {
    if (!user) return reject(new Error('No user'))

    const session = {
      created: new Date(),
      user
    }

    this.db('entu').then((connection) => {
      connection.collection('session').insertOne(_pickBy(session, _identity)).then((result) => {
        const token = jwt.sign({}, jwtSecret, {
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

exports.addEntityAggregateSqs = async (context, account, entity, dt) => {
  const region = context.invokedFunctionArn.split(':')[3]
  const accountId = context.invokedFunctionArn.split(':')[4]
  const queueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/${process.env.STACK_NAME}-entity-aggregate-${account}`
  const message = {
    account,
    entity,
    dt,
    timestamp: new Date().getTime()
  }

  const sqsClient = new SQSClient()
  const command = new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) })
  const sqsResponse = await sqsClient.send(command)

  console.log(`Entity ${entity} added to SQS`)

  return sqsResponse
}

exports.strToId = (str) => {
  try {
    return new ObjectId(str)
  } catch (e) {
    throw new Error('Invalid _id')
  }
}

exports.addStats = async (event, functionName) => {
  const user = await this.user(event)
  const date = new Date().toISOString()

  user.db.collection('stats').updateOne(
    { date: date.substring(0, 10), function: null },
    { $inc: { count: 1 } },
    { upsert: true }
  )
  user.db.collection('stats').updateOne(
    { date: date.substring(0, 10), function: functionName },
    { $inc: { count: 1 } },
    { upsert: true }
  )

  user.db.collection('stats').updateOne(
    { date: date.substring(0, 7), function: null },
    { $inc: { count: 1 } },
    { upsert: true }
  )
  user.db.collection('stats').updateOne(
    { date: date.substring(0, 7), function: functionName },
    { $inc: { count: 1 } },
    { upsert: true }
  )

  user.db.collection('stats').updateOne(
    { date: date.substring(0, 4), function: null },
    { $inc: { count: 1 } },
    { upsert: true }
  )
  user.db.collection('stats').updateOne(
    { date: date.substring(0, 4), function: functionName },
    { $inc: { count: 1 } },
    { upsert: true }
  )
}

exports.getHeader = (event, headerKey) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v])
  )

  return headers[headerKey.toLowerCase()] || ''
}

exports.getBody = (event) => {
  let body = event.body

  if (!body) return {}

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
    code = err.at(0)
    message = err.at(1)

    console.error(code.toString(), message)
  } else if (parseInt(err.toString().split(':').at(1))) {
    code = parseInt(err.toString().split(':').at(1))
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
