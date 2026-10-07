export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('response', async (res, event) => {
    const date = new Date().toISOString()
    const entu = event.req.context?.entu

    if (!entu?.db) return

    const collections = await entu.db.listCollections({ name: 'entity' }).toArray()
    if (collections.length === 0) return

    await entu.db.collection('stats').bulkWrite([
      { updateOne: { filter: { date: date.slice(0, 10), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } },
      { updateOne: { filter: { date: date.slice(0, 7), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } },
      { updateOne: { filter: { date: date.slice(0, 4), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } }
    ])
  })
})
