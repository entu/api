'use strict'

const _h = require('helpers')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const mongoDbSystemDbs = ['admin', 'config', 'local']

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const key = _h.getHeader(event, 'authorization').replace('Bearer ', '')

    if (!key) return _h.error([400, 'No key'])

    const authFilter = {}
    const connection = await _h.db('entu')

    try {
      const decoded = jwt.verify(key, jwtSecret, { audience: event.requestContext?.http?.sourceIp })
      const session = await connection.collection('session').findOneAndUpdate({ _id: _h.strToId(decoded.sub), deleted: { $exists: false } }, { $set: { deleted: new Date() } })

      if (!session?.value) return _h.error([400, 'No session'])
      if (!session.value.user?.email) return _h.error([400, 'No user email'])

      authFilter['private.entu_user.string'] = session.value?.user?.email
    } catch (e) {
      authFilter['private.entu_api_key.string'] = crypto.createHash('sha256').update(key).digest('hex')
    }

    const onlyForAccount = event.queryStringParameters?.account

    const dbs = await connection.admin().listDatabases()
    const accounts = {}

    for (let i = 0; i < dbs.databases.length; i++) {
      const account = dbs.databases[i].name
      if (onlyForAccount && onlyForAccount !== account) { continue }
      if (mongoDbSystemDbs.includes(account)) { continue }

      const accountCon = await _h.db(account)
      const person = await accountCon.collection('entity').findOne(authFilter, { projection: { _id: true, 'private.name.string': true } })

      if (person) {
        const token = jwt.sign({}, jwtSecret, {
          issuer: account,
          audience: event.requestContext?.http?.sourceIp,
          subject: person._id.toString(),
          expiresIn: '48h'
        })

        accounts[account] = {
          _id: person._id.toString(),
          name: person.private?.name?.[0]?.string,
          account,
          token
        }
      }
    }

    return _h.json(Object.values(accounts))
  } catch (e) {
    return _h.error(e)
  }
}
