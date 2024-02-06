'use strict'

const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    await _h.addStats(event, context.functionName)

    const user = await _h.user(event)
    const eId = event.pathParameters?._id ? _h.strToId(event.pathParameters._id) : null

    const entity = await user.db.collection('entity').findOne({
      _id: eId
    }, {
      projection: {
        _id: false,
        access: true
      }
    })

    if (!entity) return _h.error([404, 'Entity not found'])

    const access = (entity.access || []).map((s) => s.toString())

    if (!access.includes(user.id)) return _h.error([403, 'User not in any rights property'])

    const changes = await user.db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: { $nin: ['_mid', '_created'] }
        }
      }, {
        $project: {
          type: '$type',
          at: '$created.at',
          by: '$created.by',
          new: {
            boolean: '$boolean',
            date: '$date',
            datetime: '$datetime',
            filename: '$filename',
            filesize: '$filesize',
            md5: '$md5',
            number: '$number',
            reference: '$reference',
            string: '$string'
          }
        }
      }, {
        $unionWith: {
          coll: 'property',
          pipeline: [
            {
              $match: {
                entity: eId,
                deleted: { $exists: true },
                type: {
                  $nin: ['_mid', '_created']
                }
              }
            }, {
              $project: {
                type: '$type',
                at: '$deleted.at',
                by: '$deleted.by',
                old: {
                  boolean: '$boolean',
                  date: '$date',
                  datetime: '$datetime',
                  filename: '$filename',
                  filesize: '$filesize',
                  md5: '$md5',
                  number: '$number',
                  reference: '$reference',
                  string: '$string'
                }
              }
            }
          ]
        }
      }, {
        $group: {
          _id: { type: '$type', at: '$at', by: '$by' },
          type: { $max: '$type' },
          at: { $max: '$at' },
          by: { $max: '$by' },
          old: { $max: '$old' },
          new: { $max: '$new' }
        }
      }, {
        $project: { _id: false }
      }, {
        $sort: { at: 1 }
      }
    ]).toArray()

    const cleanChanges = changes.map((x) => {
      if (x.type === 'entu_api_key') {
        if (x.old.string) x.old.string = '***'
        if (x.new.string) x.new.string = '***'
      }

      return x
    })

    return _h.json(cleanChanges)
  } catch (e) {
    return _h.error(e)
  }
}
