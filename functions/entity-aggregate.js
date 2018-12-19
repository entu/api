'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

const aggregateEntity = async (db, entityId) => {
  return new Promise((resolve, reject) => {
    db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray().then(properties => {
      let p = _.groupBy(properties, v => { return v.public === true ? 'public' : 'private' })

      if (p.public) {
        p.public = _.mapValues(_.groupBy(p.public, 'type'), (o) => {
          return _.map(o, (p) => {
            return _.omit(p, ['entity', 'type', 'created', 'search', 'public'])
          })
        })
      }
      if (p.private) {
        p.private = _.mapValues(_.groupBy(p.private, 'type'), (o) => {
          return _.map(o, (p) => {
            return _.omit(p, ['entity', 'type', 'created', 'search', 'public'])
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
        }).catch(err => {
          reject(err)
        })
      } else {
        db.collection('entity').update({ _id: entityId }, p).then(r => {
          resolve(r)
        }).catch(err => {
          reject(err)
        })
      }
    }).catch(err => {
      reject(err)
    })
  })
}

exports.handler = async (event, context) => {
  if (!event.Records && event.Records.length < 1) { return }

  for (var i = 0; i < event.Records.length; i++) {
    const data = JSON.parse(event.Records[i].body)
    const db = await _h.db(data.account)
    const eId = new ObjectId(data.entity)

    const e = await aggregateEntity(db, eId)

    console.log(JSON.stringify(e.result, null, 3))
  }
}
