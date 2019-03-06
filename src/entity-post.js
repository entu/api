'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const aws = require('aws-sdk')
const { ObjectId } = require('mongodb')

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
  if (event.source === 'aws.events') { return }

  try {
    const s3Bucket = await _h.ssmParameter('entu-api-files-s3-bucket')
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'Forbidden. No user.']) }

    const createdDt = new Date()
    const userId = new ObjectId(user.id)

    const body = JSON.parse(event.body)
    if (!body) { return _h.error([400, 'No data']) }
    if (!_.isArray(body)) { return _h.error([400, 'Data must be array']) }
    if (body.length === 0) { return _h.error([400, 'At least one property must be set']) }

    let eId = event.pathParameters && event.pathParameters.id ? new ObjectId(event.pathParameters.id) : null

    if (eId) {
      const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: { _id: false, 'private._owner': true, 'private._editor': true } })

      if (!entity) { return _h.error([404, 'Entity not found']) }

      const access = _.map(_.concat(_.get(entity, 'private._owner', []), _.get(entity, 'private._editor', [])), (s) => s.reference.toString())

      if (!access.includes(user.id)) { return _h.error([403, 'Forbidden. User not in _owner nor _editor property.']) }

      const rigtsProperties = body.filter((property) => rightTypes.includes(property.type))
      const owners = _.map(_.get(entity, 'private._owner', []), (s) => s.reference.toString())

      if (rigtsProperties.length > 0 && !owners.includes(user.id)) { return _h.error([403, 'Forbidden. User not in _owner property.']) }
    }

    for (let i = 0; i < body.length; i++) {
      let property = body[i]

      if (!property.type) { return _h.error([400, 'Property type not set']) }
      if (!property.type.match(/^[A-Za-z0-9\_]+$/)) { return _h.error([400, 'Property type must be alphanumeric']) }
      if (property.type.startsWith('_') && !allowedTypes.includes(property.type)) { return _h.error([400, 'Property type can\'t begin with _']) }
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

      if (property.reference) { property.reference = new ObjectId(property.reference) }
      if (property.date) { property.date = new Date(property.date) }
      if (property.datetime) { property.datetime = new Date(property.datetime) }

      property.entity = eId
      property.created = {
        at: createdDt,
        by: userId
      }

      const newProperty = await user.db.collection('property').insertOne(property)

      if (property.filename && property.size) {
        aws.config = new aws.Config()

        const s3 = new aws.S3()
        const key = `${user.account}/${newProperty.insertedId}`
        const s3Params = {
          Bucket: s3Bucket,
          Key: key,
          Expires: 60,
          ContentType: property.type,
          ACL: 'private',
          ContentDisposition: `inline;filename="${property.filename.replace('"', '\"')}"`,
          ServerSideEncryption: 'AES256'
        }

        const signedRequest = await s3.getSignedUrl('putObject', s3Params).promise()

        pIds.push({
          _id: newProperty.insertedId,
          url: `https://${s3Bucket}.s3.amazonaws.com/${key}`,
          signedRequest: signedRequest
        })
      } else {
        pIds.push({ _id: newProperty.insertedId })
      }
    }

    await _h.addEntityAggregateSqs(context, user.account, eId)

    return _h.json({ _id: eId, properties: pIds })
  } catch (e) {
    return _h.error(e)
  }
}
