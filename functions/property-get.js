'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const aws = require('aws-sdk')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  try {
    const user = await _h.user(event)
    let property = await user.db.collection('property').findOne({ _id: new ObjectId(event.pathParameters.id), deleted: { $exists: false } })

    if (!property) { return _h.error([404, 'Property not found']) }

    const entity = await user.db.collection('entity').findOne({ _id: property.entity }, { projection: { _id: false, access: true } })

    if (!entity) { return _h.error([404, 'Entity not found']) }

    if (!property.public) {
      const access = _.map(_.get(entity, 'access', []), (s) => {
        return s.toString()
      })

      if (access.indexOf(user.id) === -1) { return _h.error([403, 'Forbidden']) }
    }

    if (property.s3) {
      property.url = await getSignedUrl(property.s3)

      _.unset(property, 's3')
    }

    if (property.type === 'entu_api_key') {
      property.string = '***'
    }

    if (_.get(property, 'url') && _.has(event, 'queryStringParameters.download')) {
      return _h.redirect(_.get(property, 'url'))
    } else {
      return _h.json(property)
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getSignedUrl = (key) => {
  return new Promise((resolve, reject) => {
    let conf
    if (process.env.S3_ENDPOINT) {
      conf = { endpoint: process.env.S3_ENDPOINT, s3BucketEndpoint: true }
    }

    aws.config = new aws.Config()
    const s3 = new aws.S3(conf)
    s3.getSignedUrl('getObject', { Bucket: process.env.S3_BUCKET, Key: key, Expires: 10 }, (err, url) => {
      if (err) { return reject(err) }

      resolve(url)
    })
  })
}
