'use strict'

const _ = require('lodash')
const aws = require('aws-sdk')
const jwt = require('jsonwebtoken')
const { MongoClient, ObjectId } = require('mongodb')

let ssmParameters = {}
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
  if (dbConnection) { return dbConnection.db(dbName) }

  const mongoUrl = await ssmParameter('entu-api-mongodb')

  dbConnection = await MongoClient.connect(mongoUrl.Parameter.Value, { ssl: true, sslValidate: true })
  dbConnection.on('close', () => {
    dbConnection = null
    console.log(`Disconnected from ${dbName}`)
  })

  console.log(`Connected to ${dbName}`)

  return dbConnection.db(dbName)
}
exports.db = db

const getSignedUrl = async (key) => {
  return new Promise((resolve, reject) => {
    let conf
    if (process.env.S3_ENDPOINT) {
      conf = { endpoint: process.env.S3_ENDPOINT, s3BucketEndpoint: true }
    }

    aws.config = new aws.Config()
    const s3 = new aws.S3(conf)
    s3.getSignedUrl('getObject', { Bucket: process.env.S3_BUCKET, Key: key, Expires: 60 }, (err, url) => {
      if (err) { return reject(err) }

      resolve(url)
    })
  })
}
exports.getSignedUrl = getSignedUrl

exports.user = async (event) => {
  const jwtSecret = await ssmParameter('entu-api-jwt-secret')

  return new Promise((resolve, reject) => {
    const authHeaderParts = _.get(event, 'headers.Authorization', '').split(' ')
    const jwtConf = {
      issuer: _.get(event, 'queryStringParameters.account'),
      audience: _.get(event, 'requestContext.identity.sourceIp')
    }

    let result = {
      account: jwtConf.issuer
    }

    if (authHeaderParts.length === 2 && authHeaderParts[0].toLowerCase() === 'bearer') {
      try {
        const decoded = jwt.verify(authHeaderParts[1], jwtSecret.Parameter.Value, jwtConf)

        if (decoded.aud !== jwtConf.audience) {
          return reject([401, 'Invalid JWT audience'])
        }

        result = {
          id: decoded.sub,
          account: decoded.iss
        }
      } catch (e) {
        return reject([401, e.message || e])
      }
    }

    if (!result.account) {
      return reject([401, 'No account parameter'])
    }

    db(result.account).then(x => {
      result.db = x
      resolve(result)
    })
  })
}

// Create user session
exports.addUserSession = async (user) => {
  return new Promise((resolve, reject) => {
    if (!user) { return reject('No user') }

    const session = {
      created: new Date(),
      user: user
    }

    db('entu').then(connection => {
      connection.collection('session').insertOne(_.pickBy(session, _.identity)).then(result => {
        resolve(result.insertedId)
      }).catch(err => {
        reject(err)
      })
    }).catch(err => {
      reject(err)
    })
  })
}

// Add to entu-api-entity-aggregate-queue
exports.addEntityAggregateSqs = async (context, account, entity) => {
  const region = context.invokedFunctionArn.split(':')[3]
  const accountId = context.invokedFunctionArn.split(':')[4]
  const queueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/entu-api-entity-aggregate-queue`
  const message = {
    account: account,
    entity: entity.toString()
  }

  const sqs = new aws.SQS()
  const sqsResponse = await sqs.sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }).promise()

  return sqsResponse
}

// Return public or private properties (based user rights)
const claenupEntity = async (entity, user) => {
  if (!entity) { return }

  let result = { _id: entity._id }

  const access = _.map(_.get(entity, 'access', []), (s) => s.toString())

  if (user.id && access.includes(user.id)) {
    result = Object.assign({}, result, _.get(entity, 'private', {}))
  } else if (access.includes('public')) {
    result = Object.assign({}, result, _.get(entity, 'public', {}))
  } else {
    return
  }

  if (_.has(result, 'photo.0.s3')) {
    result._thumbnail = await getSignedUrl(_.get(result, 'photo.0.s3'))
  }

  for (let property in result) {
    if (!result.hasOwnProperty(property)) { continue }
    if (property === '_id') { continue }

    for (let i = 0; i < result[property].length; i++) {
      if (result[property][i].formula) {
        result[property][i].string = await formula(result[property][i].formula, entity._id, user)
      }
      if (result[property][i].reference) {
        result[property][i].string = await reference(result[property][i].reference, user)
      }
      if (result[property][i].date) {
        result[property][i].date = (new Date(result[property][i].date)).toISOString().substring(0, 9)
      }
    }
  }

  if (_.has(result, 'entu_api_key')) {
    _.get(result, 'entu_api_key', []).forEach(k => {
      k.string = '***'
    })
  }

  if (!result._thumbnail) {
    delete result._thumbnail
  }

  return result
}
exports.claenupEntity = claenupEntity

const reference = async (entityId, user) => {
  const config = {
    projection: {
      access: true,
      'private.name': true,
      'public.name': true
    }
  }
  const e = await user.db.collection('entity').findOne({ _id: new ObjectId(entityId) }, config)
  const entity = await claenupEntity(e, user)

  return _.get(entity, 'name', []).map(v => v.string).join('; ')
}

const formula = async (str, entityId, user) => {
  let result = ''
  let data = formulaContent(str)

  if (data.includes('(') || data.includes(')')) {
    data = await formula(data)
  }

  const dataArray = data.split(',')

  switch (formulaFunction(str)) {
    case 'CONCAT':
      for (let i = 0; i < dataArray.length; i++) {
        result += await formulaField(dataArray[i], entityId, user)
      }
      break
    case null:
      result = data
      break
    default:
      result = str
  }

  return result
}

const formulaFunction = (str) => {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return null
  } else {
    return str.substring(0, str.indexOf('(')).toUpperCase()
  }
}

const formulaContent = (str) => {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return str
  } else {
    return str.substring(str.indexOf('(') + 1, str.lastIndexOf(')'))
  }
}

const formulaField = async (str, entityId, user) => {
  str = str.trim()

  if ((str.startsWith("'") || str.startsWith('"')) && (str.endsWith("'") || str.endsWith('"'))) {
    return str.substring(1, str.length - 1)
  }

  let result

  switch (str.split('.').length) {
    case 1:
      const config = _.set({}, ['projection', `private.${str}.string`], true)
      const e = await user.db.collection('entity').findOne({ _id: new ObjectId(entityId) }, config)
      result = _.get(e, ['private', str, 0, 'string'], '')
      break
    default:
      result = ''
  }

  return result
}

exports.json = (data, code, headers) => {
  if (headers) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else {
    headers = {
      'Access-Control-Allow-Origin': '*'
    }
  }
  if (process.env.GIT_SHA1) {
    headers['X-Entu-Version'] = process.env.GIT_SHA1
  }

  return {
    statusCode: code || 200,
    headers: headers || {},
    body: JSON.stringify(data),
    isBase64Encoded: false
  }
}

exports.error = err => {
  let code
  let message
  let headers = {
    'Access-Control-Allow-Origin': '*'
  }

  console.error(err)

  if (process.env.GIT_SHA1) {
    headers['X-Entu-Version'] = process.env.GIT_SHA1
  }

  if (err.constructor === Array) {
    code = err[0]
    message = err[1]
  } else {
    message = err.toString()
  }

  return {
    statusCode: code || 500,
    headers: headers,
    body: JSON.stringify({ message: message }),
    isBase64Encoded: false
  }
}

exports.redirect = (url, code, headers) => {
  if (headers) {
    headers['Location'] = url
  } else {
    headers = {
      Location: url
    }
  }
  headers['Access-Control-Allow-Origin'] = '*'

  return {
    statusCode: code || 302,
    headers: headers,
    body: null
  }
}
