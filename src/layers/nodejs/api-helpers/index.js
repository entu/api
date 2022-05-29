'use strict'

const _pickBy = require('lodash/pickBy')
const _identity = require('lodash/identity')
const aws = require('aws-sdk')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')
const { MongoClient, ObjectId } = require('mongodb')

const ssmParameters = {}
const ssmParameter = async (name) => {
  if (ssmParameters[name]) { return ssmParameters[name] }

  const ssm = new aws.SSM()
  const ssmValue = await ssm.getParameter({ Name: name, WithDecryption: true }).promise()

  ssmParameters[name] = ssmValue.Parameter.Value

  return ssmValue.Parameter.Value
}
exports.ssmParameter = ssmParameter

let dbConnection
const db = async (dbName) => {
  dbName = dbName.replace(/[^a-z0-9]/gi, '_')

  if (dbConnection) { return dbConnection.db(dbName) }

  const mongoUrl = await ssmParameter('entu-api-mongodb')

  dbConnection = await MongoClient.connect(mongoUrl, { ssl: true, sslValidate: true, useNewUrlParser: true, useUnifiedTopology: true })
  dbConnection.on('close', () => {
    dbConnection = null
    console.log(`Disconnected from ${dbName}`)
  })

  console.log(`Connected to ${dbName}`)

  return dbConnection.db(dbName)
}
exports.db = db

const getSignedUrl = async (operation, params) => {
  const s3Endpoint = await ssmParameter('entu-api-files-s3-endpoint')
  const s3Bucket = await ssmParameter('entu-api-files-s3-bucket')

  if (!params.Bucket) {
    params.Bucket = s3Bucket
  }

  if (!params.Expires) {
    params.Expires = 60
  }

  return new Promise((resolve, reject) => {
    let conf

    if (s3Endpoint) {
      conf = { endpoint: s3Endpoint, s3BucketEndpoint: true }
    }

    aws.config = new aws.Config()
    const s3 = new aws.S3(conf)

    s3.getSignedUrl(operation, params, (err, url) => {
      if (err) { return reject(err) }

      resolve(url)
    })
  })
}
exports.getSignedUrl = getSignedUrl

exports.user = async (event) => {
  const jwtSecret = await ssmParameter('entu-api-jwt-secret')

  return new Promise((resolve, reject) => {
    const jwtToken = getHeader(event, 'authorization').replace('Bearer ', '')
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

    db(result.account).then((x) => {
      result.db = x
      resolve(result)
    })
  })
}

// Create user session
exports.addUserSession = async (user) => {
  const jwtSecret = await ssmParameter('entu-api-jwt-secret')

  return new Promise((resolve, reject) => {
    if (!user) { return reject(new Error('No user')) }

    const session = {
      created: new Date(),
      user
    }

    db('entu').then((connection) => {
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

// Add to entu-api-entity-aggregate-queue
exports.addEntityAggregateSqs = async (context, account, entity, dt) => {
  const region = context.invokedFunctionArn.split(':')[3]
  const accountId = context.invokedFunctionArn.split(':')[4]
  const queueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/entu-api-entity-aggregate-queue-${account}.fifo`
  const message = {
    account,
    entity: entity.toString(),
    dt,
    timestamp: (new Date()).getTime()
  }

  const sqs = new aws.SQS()
  const sqsResponse = await sqs.sendMessage({ QueueUrl: queueUrl, MessageGroupId: account, MessageBody: JSON.stringify(message) }).promise()

  console.log(`Entity ${entity} added to SQS`)

  return sqsResponse
}

const strToId = (str) => {
  try {
    return new ObjectId(str)
  } catch (e) {
    throw new Error('Invalid _id')
  }
}
exports.strToId = strToId

const getHeader = (event, headerKey) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v])
  )

  return headers[headerKey.toLowerCase()] || ''
}
exports.getHeader = getHeader

exports.getBody = (event) => {
  let body = event.body

  if (!body) { return {} }

  if (event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString()
  }

  if (getHeader(event, 'content-type') === 'application/x-www-form-urlencoded') {
    return querystring.parse(body)
  } else {
    return JSON.parse(body)
  }
}

exports.json = (data) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'X-Entu-Version': process.env.GIT_SHA1 },
    body: JSON.stringify(data),
    isBase64Encoded: false
  }
}

exports.error = (err) => {
  let code
  let message

  if (err.constructor === Array) {
    code = err[0]
    message = err[1]

    console.error(code.toString(), message)
  } else {
    message = err.toString()

    console.error(err)
  }

  return {
    statusCode: code || 500,
    headers: { 'Content-Type': 'application/json', 'X-Entu-Version': process.env.GIT_SHA1 },
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
