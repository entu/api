'use strict'

const _h = require('helpers')

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
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const user = await _h.user(event)
    if (!user.id) return _h.error([403, 'No user'])

    const createdDt = new Date()
    const userId = _h.strToId(user.id)

    const body = _h.getBody(event)

    if (body && !Array.isArray(body)) return _h.error([400, 'Data must be array'])

    let eId = event.pathParameters?._id ? _h.strToId(event.pathParameters._id) : null

    if (eId) {
      if (!body || (Array.isArray(body) && body.length === 0)) {
        await _h.addEntityAggregateSqs(context, user.account, eId)
        return _h.json({ _id: eId })
      }

      const entity = await user.db.collection('entity').findOne({
        _id: eId
      }, {
        projection: {
          _id: false,
          'private._owner': true,
          'private._editor': true
        }
      })

      if (!entity) return _h.error([404, 'Entity not found'])

      const access = [...(entity.private?._owner || []), ...(entity.private?._editor || [])].map((s) => s.reference?.toString())

      if (!access.includes(user.id)) return _h.error([403, 'User not in _owner nor _editor property'])

      const rigtsProperties = body.filter((property) => rightTypes.includes(property.type))
      const owners = (entity.private?._owner || []).map((s) => s.reference?.toString())

      if (rigtsProperties.length > 0 && !owners.includes(user.id)) return _h.error([403, 'User not in _owner property'])
    }

    if (!body) return _h.error([400, 'No data'])
    if (body.length === 0) return _h.error([400, 'At least one property must be set'])

    for (let i = 0; i < body.length; i++) {
      const property = body[i]

      if (!property.type) return _h.error([400, 'Property type not set'])
      if (!property.type.match(/^[A-Za-z0-9_]+$/)) return _h.error([400, 'Property type must be alphanumeric'])
      if (property.type.startsWith('_') && !allowedTypes.includes(property.type)) return _h.error([400, 'Property type can\'t begin with _'])

      if (property.type === '_parent' && property.reference) {
        const parent = await user.db.collection('entity').findOne({
          _id: _h.strToId(property.reference)
        }, {
          projection: {
            _id: false,
            'private._owner': true,
            'private._editor': true,
            'private._expander': true
          }
        })

        if (!parent) return _h.error([400, 'Entity in _parent property not found'])

        const parentAccess = [...(parent.private?._owner || []), ...(parent.private?._editor || []), ...(parent.private?._expander || [])].map((s) => s.reference?.toString())

        if (!parentAccess.includes(user.id)) return _h.error([403, 'User not in parent _owner, _editor nor _expander property'])
      }
    }

    if (!eId) {
      const entity = await user.db.collection('entity').insertOne({})
      eId = entity.insertedId

      body.push({ entity: eId, type: '_owner', reference: userId, created: { at: createdDt, by: userId } })
      body.push({ entity: eId, type: '_created', reference: userId, datetime: createdDt, created: { at: createdDt, by: userId } })
    }

    const pIds = []
    for (let i = 0; i < body.length; i++) {
      const property = body[i]

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

      if (property.filename && property.filesize && property.filetype) {
        const contentDisposition = `inline;filename="${encodeURI(property.filename.replace('"', '\"'))}"`

        newProperty.upload = {
          url: await _h.getSignedUploadUrl(`${user.account}/${newProperty._id}`, property.filename, property.filetype, contentDisposition),
          method: 'PUT',
          headers: {
            ACL: 'private',
            'Content-Disposition': contentDisposition,
            'Content-Type': property.filetype
          }
        }

        await user.db.collection('property').updateOne({
          _id: newProperty._id
        }, {
          $set: {
            s3: `${user.account}/${newProperty._id}`
          }
        })
      }

      pIds.push(newProperty)
    }

    await _h.addEntityAggregateSqs(context, user.account, eId)

    return _h.json({ _id: eId, properties: pIds })
  } catch (e) {
    return _h.error(e)
  }
}
