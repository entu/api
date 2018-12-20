'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const aws = require('aws-sdk')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const ObjectID = require('mongodb').ObjectID

const mongoDbSystemDbs = ['admin', 'config', 'local']

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const authHeaderParts = _.get(event, 'headers.Authorization', '').split(' ')
    if (authHeaderParts.length !== 2 || authHeaderParts[0].toLowerCase() !== 'bearer') { return _h.error([400, 'No key']) }

    const key = authHeaderParts[1]
    if (key.length !== 24 && key.length !== 48) { return _h.error([400, 'Invalid key']) }

    var authFilter = {}
    const connection = await _h.db('entu')

    if (key.length === 24) {
      const session = await connection.collection('session').findOneAndUpdate({ _id: new ObjectID(key), deleted: { $exists: false } }, { $set: { deleted: new Date() } })

      if (!session.value) { return _h.error([400, 'No session']) }

      authFilter['private.entu_user.string'] = _.get(session, 'value.user.email')
    } else {
      authFilter['private.entu_api_key.string'] = crypto.createHash('sha256').update(key).digest('hex')
    }

    const ssm = new aws.SSM()
    const jwtSecret = await ssm.getParameter({ Name: 'entu-api-jwt-secret', WithDecryption: true }).promise()

    const dbs = await connection.admin().listDatabases()
    let accounts = []

    for (let i = 0; i < dbs.databases.length; i++) {
      const account = _.get(dbs, ['databases', i, 'name'])
      if (mongoDbSystemDbs.includes(account)) { continue }

      const accountCon = await _h.db(account)
      const person = await accountCon.collection('entity').findOne(authFilter, { projection: { _id: true } })

      if (person) {
        accounts.push({
          _id: person._id.toString(),
          account: account,
          token: jwt.sign({}, jwtSecret.Value, {
            issuer: account,
            audience: _.get(event, 'requestContext.identity.sourceIp'),
            subject: person._id.toString(),
            expiresIn: '48h'
          })
        })
      }
    }

    return _h.json(_.mapValues(_.groupBy(_.compact(accounts), 'account'), (o) => _.first(o)))
  } catch (e) {
    return _h.error(e)
  }
}
