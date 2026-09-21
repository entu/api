// Builds an entity's change history - the shared body of GET /{db}/entity/{_id}/history and the AI history tool.
// The caller checks access first: history exposes values that may since have been made private, so it needs direct
// rights on the entity rather than the domain or public view.
export async function entityHistory (entu, entityId, { limit = 100, skip = 0 } = {}) {
  const changes = await entu.db.collection('property').aggregate([
    {
      $match: {
        entity: entityId,
        type: { $nin: ['_mid', '_created'] }
      }
    },
    {
      $project: {
        type: '$type',
        at: '$created.at',
        by: '$created.by',
        new: {
          _id: '$_id',
          boolean: '$boolean',
          date: '$date',
          datetime: '$datetime',
          filename: '$filename',
          filesize: '$filesize',
          language: '$language',
          md5: '$md5',
          number: '$number',
          reference: '$reference',
          string: '$string'
        }
      }
    },
    {
      $unionWith: {
        coll: 'property',
        pipeline: [
          {
            $match: {
              entity: entityId,
              deleted: { $exists: true },
              type: {
                $nin: ['_mid', '_created']
              }
            }
          },
          {
            $project: {
              type: '$type',
              at: '$deleted.at',
              by: '$deleted.by',
              old: {
                _id: '$_id',
                boolean: '$boolean',
                date: '$date',
                datetime: '$datetime',
                filename: '$filename',
                filesize: '$filesize',
                language: '$language',
                md5: '$md5',
                number: '$number',
                reference: '$reference',
                string: '$string'
              }
            }
          }
        ]
      }
    },
    {
      $group: {
        _id: { type: '$type', at: '$at', by: '$by' },
        type: { $max: '$type' },
        at: { $max: '$at' },
        by: { $max: '$by' },
        old: { $max: '$old' },
        new: { $max: '$new' }
      }
    },
    {
      $lookup: {
        from: 'entity',
        let: { ref: '$new.reference' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$ref'] } } },
          { $project: { _id: false, name: { $arrayElemAt: ['$private.name.string', 0] } } }
        ],
        as: '_newRef'
      }
    },
    {
      $lookup: {
        from: 'entity',
        let: { ref: '$old.reference' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$ref'] } } },
          { $project: { _id: false, name: { $arrayElemAt: ['$private.name.string', 0] } } }
        ],
        as: '_oldRef'
      }
    },
    {
      $addFields: {
        'new.string': {
          $cond: [{ $gt: ['$new.reference', null] }, { $arrayElemAt: ['$_newRef.name', 0] }, '$new.string']
        },
        'old.string': {
          $cond: [{ $gt: ['$old.reference', null] }, { $arrayElemAt: ['$_oldRef.name', 0] }, '$old.string']
        }
      }
    },
    {
      $project: { _id: false, _newRef: false, _oldRef: false }
    },
    {
      $sort: { at: 1 }
    },
    {
      $facet: {
        changes: [{ $skip: skip }, { $limit: limit }],
        count: [{ $count: 'total' }]
      }
    }
  ]).toArray()

  const raw = changes[0]
  const count = raw.count[0]?.total || 0

  const cleanChanges = raw.changes.map((x) => {
    if (x.type === 'entu_api_key') {
      if (x.old.string) {
        x.old.string = '***'
      }
      if (x.new.string) {
        x.new.string = '***'
      }
    }
    else if (x.type === 'entu_passkey') {
      if (x.old?.string) {
        x.old.string = `${x.old.passkey_device || ''} ${x.old._id.toString().slice(-4).toUpperCase()}`.trim()
      }
      if (x.new?.string) {
        x.new.string = `${x.new.passkey_device || ''} ${x.new._id.toString().slice(-4).toUpperCase()}`.trim()
      }
    }
    else if (x.type === 'entu_user') {
      if (x.old?.string) {
        x.old.string = '***'
      }
      if (x.new?.string) {
        x.new.string = '***'
      }
    }

    if (x.at === null) {
      delete x.at
    }
    if (x.by === null) {
      delete x.by
    }
    if (x.old === null) {
      delete x.old
    }
    if (x.new === null) {
      delete x.new
    }

    return x
  })

  return { changes: cleanChanges, count }
}
