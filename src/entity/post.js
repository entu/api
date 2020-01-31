'use strict'

const _ = require('lodash')
const _h = require('../_helpers')
const aws = require('aws-sdk')

const allowedTypes = [
  '_type',
  '_parent',
  '_public',
  '_viewer',
  '_expander',
  '_editor',
  '_owner'
]
const rightTypes = [
  '_viewer',
  '_expander',
  '_editor',
  '_owner',
  '_public'
]

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const s3Bucket = await _h.ssmParameter('entu-api-files-s3-bucket')
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'No user']) }

    const createdDt = new Date()
    const userId = _h.strToId(user.id)

    const body = JSON.parse(event.body)

    if (body && !_.isArray(body)) { return _h.error([400, 'Data must be array']) }

    let eId = event.pathParameters && event.pathParameters.id ? _h.strToId(event.pathParameters.id) : null

    if (eId) {
      if (!body || _.isArray(body) && body.length === 0) {
        await _h.addEntityAggregateSqs(context, user.account, eId)
        return _h.json({ _id: eId })
      }

      const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: { _id: false, 'private._owner': true, 'private._editor': true } })

      if (!entity) { return _h.error([404, 'Entity not found']) }

      const access = _.get(entity, 'private._owner', []).concat(_.get(entity, 'private._editor', [])).map((s) => s.reference.toString())

      if (!access.includes(user.id)) { return _h.error([403, 'User not in _owner nor _editor property']) }

      const rigtsProperties = body.filter((property) => rightTypes.includes(property.type))
      const owners = _.get(entity, 'private._owner', []).map((s) => s.reference.toString())

      if (rigtsProperties.length > 0 && !owners.includes(user.id)) { return _h.error([403, 'User not in _owner property']) }
    }

    if (!body) { return _h.error([400, 'No data']) }
    if (body.length === 0) { return _h.error([400, 'At least one property must be set']) }

    for (let i = 0; i < body.length; i++) {
      let property = body[i]

      if (!property.type) { return _h.error([400, 'Property type not set']) }
      if (!property.type.match(/^[A-Za-z0-9\_]+$/)) { return _h.error([400, 'Property type must be alphanumeric']) }
      if (property.type.startsWith('_') && !allowedTypes.includes(property.type)) { return _h.error([400, 'Property type can\'t begin with _']) }

      if (property.type === '_parent' && property.reference) {
        const parent = await user.db.collection('entity').findOne({ _id: _h.strToId(property.reference) }, { projection: { _id: false, 'private._owner': true, 'private._editor': true, 'private._expander': true } })

        if (!parent) { return _h.error([400, 'Entity in _parent property not found']) }

        const parentAccess = _.get(parent, 'private._owner', []).concat(_.get(parent, 'private._editor', []), _.get(parent, 'private._expander', [])).map((s) => s.reference.toString())

        if (!parentAccess.includes(user.id)) { return _h.error([403, 'User not in parent _owner, _editor nor _expander property']) }
      }
    }

    if (!eId) {
      const entity = await user.db.collection('entity').insertOne({})
      eId = entity.insertedId

      body.push({ entity: eId, type: '_owner', reference: userId, created: { at: createdDt, by: userId } })
      body.push({ entity: eId, type: '_created', reference: userId, datetime: createdDt, created: { at: createdDt, by: userId } })
    }

    var pIds = []
    for (let i = 0; i < body.length; i++) {
      let property = body[i]

      if (property.reference) { property.reference = _h.strToId(property.reference) }
      if (property.date) { property.date = new Date(property.date) }
      if (property.datetime) { property.datetime = new Date(property.datetime) }

      property.entity = eId
      property.created = {
        at: createdDt,
        by: userId
      }

      const insertedProperty = await user.db.collection('property').insertOne(property)
      const newProperty = { _id: insertedProperty.insertedId, ...property }

      delete newProperty.entity
      delete newProperty.created

      if (property.filename && property.filesize) {
        aws.config = new aws.Config()

        const s3 = new aws.S3()
        const key = `${user.account}/${newProperty._id}`
        const s3Params = {
          Bucket: s3Bucket,
          Key: key,
          Expires: 60,
          ContentType: property.filetype,
          ACL: 'private',
          ContentDisposition: `inline;filename="${property.filename.replace('"', '\"')}"`,
          ServerSideEncryption: 'AES256'
        }

        newProperty.upload = {
          url: await _h.getSignedUrl('putObject', s3Params),
          method: 'PUT',
          headers: {
            'Content-Type': property.filetype,
            ACL: 'private'
          }
        }
      }

      pIds.push(newProperty)
    }

    await _h.addEntityAggregateSqs(context, user.account, eId)

    return _h.json({ _id: eId, properties: pIds })
  } catch (e) {
    return _h.error(e)
  }
}
