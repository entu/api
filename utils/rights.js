// Returns an array with duplicates removed, using a key function for comparison
export function uniqBy (array, keyFn) {
  const seen = new Map()
  return array.filter((v) => {
    const k = keyFn(v)
    if (seen.has(k))
      return false
    seen.set(k, true)
    return true
  })
}

// Fetches and merges rights from all parent entities, marking them as inherited
export async function getParentRights (entu, parents) {
  const parentRights = await entu.db.collection('entity').find({
    _id: { $in: parents.map((x) => x.reference) }
  }, {
    projection: {
      _id: false,
      'private._noaccess': true,
      'private._viewer': true,
      'private._expander': true,
      'private._editor': true,
      'private._owner': true
    }
  }).toArray()

  const rights = combineRights(parentRights.reduce((acc, cur) => ({
    _viewer: [...acc._viewer || [], ...cur.private?._viewer || []],
    _expander: [...acc._expander || [], ...cur.private?._expander || []],
    _editor: [...acc._editor || [], ...cur.private?._editor || []],
    _owner: [...acc._owner || [], ...cur.private?._owner || []]
  }), {
    _viewer: [],
    _expander: [],
    _editor: [],
    _owner: []
  }))

  rights._noaccess = rights._noaccess?.map((x) => ({ ...x, inherited: true }))
  rights._viewer = rights._viewer?.map((x) => ({ ...x, inherited: true }))
  rights._expander = rights._expander?.map((x) => ({ ...x, inherited: true }))
  rights._editor = rights._editor?.map((x) => ({ ...x, inherited: true }))
  rights._owner = rights._owner?.map((x) => ({ ...x, inherited: true }))

  return rights
}

// Deduplicates rights entries and removes users listed in _noaccess
export function combineRights (rights) {
  const directNoaccess = rights._noaccess?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directViewers = rights._viewer?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directExpanders = rights._expander?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directEditors = rights._editor?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directOwners = rights._owner?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []

  rights._noaccess = rights._noaccess?.filter((x) => x.inherited === undefined || (x.inherited === true && !directNoaccess.includes(x.reference.toString())))
  rights._viewer = rights._viewer?.filter((x) => x.inherited === undefined || (x.inherited === true && !directViewers.includes(x.reference.toString())))
  rights._expander = rights._expander?.filter((x) => x.inherited === undefined || (x.inherited === true && !directExpanders.includes(x.reference.toString())))
  rights._editor = rights._editor?.filter((x) => x.inherited === undefined || (x.inherited === true && !directEditors.includes(x.reference.toString())))
  rights._owner = rights._owner?.filter((x) => x.inherited === undefined || (x.inherited === true && !directOwners.includes(x.reference.toString())))

  const noRights = rights._noaccess?.map((x) => x.reference.toString()) || []

  if (noRights.length > 0) {
    rights._viewer = rights._viewer?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._expander = rights._expander?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._editor = rights._editor?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._owner = rights._owner?.filter((x) => !noRights.includes(x.reference.toString()))
  }

  return rights
}

// Builds the entity access array from rights properties and sharing setting
export function getAccessArray ({ private: entity }) {
  const access = []
  const noAccess = entity._noaccess?.map((x) => x.reference)

  if (entity._sharing?.at(0)?.string) {
    access.push(entity._sharing?.at(0)?.string.toLowerCase())
  }

  ['_viewer', '_expander', '_editor', '_owner'].forEach((type) => {
    if (!entity[type])
      return

    entity[type].forEach((x) => {
      if (noAccess?.includes(x.reference))
        return

      access.push(x.reference)
    })
  })

  return uniqBy(access, (x) => x.toString())
}
