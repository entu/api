'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const aws = require('aws-sdk')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'Forbidden']) }

    const body = JSON.parse(event.body)
    if (!body) { return _h.error([400, 'No data']) }
    if (!_.isArray(body)) { return _h.error([400, 'Data must be array']) }
    if (body.length === 0) { return _h.error([400, 'At least one property must be set']) }

    var eId = new ObjectId(event.pathParameters.id)

    const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: { _id: false, 'private._owner': true, 'private._editor': true } })

    if (!entity) { return _h.error([404, 'Entity not found']) }

    const access = _.map(_.concat(_.get(entity, 'private._owner', []), _.get(entity, 'private._editor', [])), (s) => {
      return s.reference.toString()
    })

    if (access.indexOf(user.id) === -1) { return _h.error([403, 'Forbidden']) }

    let properties = []
    for (let i = 0; i < body.length; i++) {
      let property = body[i]

      if (!property.type) { return _h.error([400, 'Property type not set']) }
      if (!property.type.match(/^[A-Za-z0-9\_]+$/)) { return _h.error([400, 'Property type must be alphanumeric']) }
      if (property.type.substr(0, 1) === '_') { return _h.error([400, 'Property type can\'t begin with _']) }

      if (property.reference) { property.reference = new ObjectId(property.reference) }
      if (property.date) { property.date = new Date(property.date) }
      if (property.datetime) { property.datetime = new Date(property.datetime) }

      property.entity = eId
      property.created = {
        at: new Date(),
        by: new ObjectId(user.id)
      }
      properties.push(property)
    }

    var pIds = []
    for (var i = 0; i < properties.length; i++) {
      const property = properties[i]
      const newProperty = await user.db.collection('property').insertOne(property)

      if (property.filename && property.size) {
        aws.config = new aws.Config()

        const s3 = new aws.S3()
        const key = `${user.account}/${newProperty.insertedId}`
        const s3Params = {
          Bucket: process.env.S3_BUCKET,
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
          url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
          signedRequest: signedRequest
        })
      } else {
        pIds.push({ _id: newProperty.insertedId })
      }
    }

    await _h.aggregateEntity(user.db, eId, null)

    return _h.json(pIds)
  } catch (e) {
    return _h.error(e)
  }
}
