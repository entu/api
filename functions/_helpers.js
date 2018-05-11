'use strict'

const _ = require('lodash')
const jwt = require('jsonwebtoken')
const mongo = require('mongodb').MongoClient

let dbConnection
const db = async (dbName) => {
  return new Promise((resolve, reject) => {
    if (dbConnection) {
      return resolve(dbConnection.db(dbName))
    }

    dbConnection = mongo.connect(process.env.MONGODB, { ssl: true, sslValidate: true }).then((connection) => {
      dbConnection = connection

      dbConnection.on('close', () => {
        dbConnection = null
        console.log(`Disconnected from ${dbName}`)
      })

      console.log(`Connected to ${dbName}`)

      resolve(dbConnection.db(dbName))
    }).catch((err) => {
      reject(err)
    })
  })
}
exports.db = db

exports.user = async (event) => {
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
        const decoded = jwt.verify(authHeaderParts[1], process.env.JWT_SECRET, jwtConf)

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
      return reject([400, 'No account parameter'])
    }

    db(result.account).then((x) => {
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

    db('entu').then((connection) => {
      connection.collection('session').insertOne(_.pickBy(session, _.identity)).then((result) => {
        resolve(result.insertedId)
      }).catch((err) => {
        reject(err)
      })
    }).catch((err) => {
      reject(err)
    })
  })
}

// Aggregate entity from property collection
exports.aggregateEntity = async (db, entityId, property) => {
  return new Promise((resolve, reject) => {
    db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray().then((properties) => {
      let p = _.groupBy(properties, v => { return v.public === true ? 'public' : 'private' })

      if (p.public) {
        p.public = _.mapValues(_.groupBy(p.public, 'type'), (o) => {
          return _.map(o, (p) => {
            return _.omit(p, ['entity', 'type', 'created', 's3', 'url', 'public'])
          })
        })
      }
      if (p.private) {
        p.private = _.mapValues(_.groupBy(p.private, 'type'), (o) => {
          return _.map(o, (p) => {
            return _.omit(p, ['entity', 'type', 'created', 's3', 'url', 'public'])
          })
        })
      }
      p.private = Object.assign({}, _.get(p, 'public', {}), _.get(p, 'private', {}))

      const access = _.map(_.union(_.get(p, 'private._viewer', []), _.get(p, 'private._expander', []), _.get(p, 'private._editor', []), _.get(p, 'private._owner', [])), 'reference')
      if (_.get(p, 'private._public.0.boolean', false) === true) {
        access.push('public')
      }
      if (access.length > 0) {
        p.access = access
      }

      if (_.has(p, 'private._deleted')) {
        db.collection('entity').deleteOne({ _id: entityId }).then(r => {
          resolve(r)
        }).catch((err) => {
          reject(err)
        })
      } else {
        db.collection('entity').update({ _id: entityId }, p).then(r => {
          resolve(r)
        }).catch((err) => {
          reject(err)
        })
      }
    }).catch((err) => {
      reject(err)
    })
  })
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

exports.error = (err) => {
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
