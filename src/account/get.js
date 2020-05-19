'use strict'

const _get = require('lodash/get')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

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
          filesize: { $exists: true }
        }
      }, {
        $group: {
          _id: { $gt: ['$deleted', null] },
          count: { $sum: 1 },
          filesize: { $sum: '$filesize' }
        }
      }
    ]).toArray()

    return _h.json({
      entities: _get(entities.filter((e) => e._id === false), '0.count', 0),
      deletedEntities: _get(entities.filter((e) => e._id === true), '0.count', 0),
      properties: _get(properties.filter((e) => e._id === false), '0.count', 0),
      deletedProperties: _get(properties.filter((e) => e._id === true), '0.count', 0),
      files: _get(files.filter((e) => e._id === false), '0.count', 0),
      filesSize: _get(files.filter((e) => e._id === false), '0.filesize', 0),
      deletedFiles: _get(files.filter((e) => e._id === true), '0.count', 0),
      deletedFilesSize: _get(files.filter((e) => e._id === true), '0.filesize', 0),
      dbSize: stats.dataSize + stats.indexSize
    })
  } catch (e) {
    return _h.error(e)
  }
}
