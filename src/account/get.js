'use strict'

const _ = require('lodash')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)

    const stats = await user.db.stats()

    const entities = await user.db.collection('entity').aggregate([{
      $group: {
        _id: { $gt: ['$private._deleted', null] },
        count: { $sum: 1 }
      }
    }]).toArray()

    const properties = await user.db.collection('property').aggregate([{
      $group: {
        _id: { $gt: ['$deleted', null] },
        count: { $sum: 1 }
      }
    }]).toArray()

    const files = await user.db.collection('property').aggregate([
      {
        $match: {
          size: { $exists: true }
        }
      }, {
        $group: {
          _id: { $gt: ['$deleted', null] },
          count: { $sum: 1 },
          size: { $sum: '$size' }
        }
      }
    ]).toArray()

    return _h.json({
      entities: _.get(entities.filter(e => e._id === false), '0.count', 0),
      deletedEntities: _.get(entities.filter(e => e._id === true), '0.count', 0),
      properties: _.get(properties.filter(e => e._id === false), '0.count', 0),
      deletedProperties: _.get(properties.filter(e => e._id === true), '0.count', 0),
      files: _.get(files.filter(e => e._id === false), '0.count', 0),
      filesSize: _.get(files.filter(e => e._id === false), '0.size', 0),
      deletedFiles: _.get(files.filter(e => e._id === true), '0.count', 0),
      deletedFilesSize: _.get(files.filter(e => e._id === true), '0.size', 0),
      dbSize: stats.dataSize + stats.indexSize
    })
  } catch (e) {
    return _h.error(e)
  }
}
