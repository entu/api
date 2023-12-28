'use strict'

const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const user = await _h.user(event)

    const stats = await user.db.stats()

    const entities = await user.db.collection('entity').countDocuments()
    const deletedEntities = await user.db.collection('property').aggregate([
      {
        $match: {
          type: '_deleted'
        }
      },
      {
        $group: {
          _id: '$entity'
        }
      },
      {
        $count: 'count'
      }
    ]).toArray()

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
      entities,
      deletedEntities: deletedEntities?.at(0)?.count || 0,
      properties: properties.find((e) => e._id === false)?.count || 0,
      deletedProperties: properties.find((e) => e._id === true)?.count || 0,
      files: files.find((e) => e._id === false)?.count || 0,
      filesSize: files.find((e) => e._id === false)?.filesize || 0,
      deletedFiles: files.find((e) => e._id === true)?.count || 0,
      deletedFilesSize: files.find((e) => e._id === true)?.filesize || 0,
      dbSize: stats.dataSize + stats.indexSize
    })
  } catch (e) {
    return _h.error(e)
  }
}
