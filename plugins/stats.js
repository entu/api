export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', async (event) => {
    const date = new Date().toISOString()
    const entu = event.context.entu

    // const path = event.path.split('?').at(0).replace('/api', '').replace(`/${entu.account}`, '')
    // const query = getQuery(event)
    // const queryStr = new URLSearchParams(query).toString()
    // const ip = getRequestIP(event, { xForwardedFor: true })

    // await indexOpenSearchDb('entu-requests', {
    //   '@timestamp': date,
    //   db: entu?.account,
    //   user: !entu?.systemUser && entu?.userStr ? entu?.userStr : undefined,
    //   method: event.method,
    //   path: path ? path : '/',
    //   query: queryStr ? decodeURIComponent(queryStr) : undefined,
    //   ip: ip ? ip.replace(/^::ffff:/, '') : undefined,
    //   browser: event.req.headers.get('user-agent')
    // })

    if (!entu?.db)
      return

    const collections = await entu.db.listCollections({ name: 'entity' }).toArray()
    if (collections.length === 0)
      return

    await entu.db.collection('stats').bulkWrite([
      { updateOne: { filter: { date: date.substring(0, 10), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } },
      { updateOne: { filter: { date: date.substring(0, 7), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } },
      { updateOne: { filter: { date: date.substring(0, 4), function: 'ALL' }, update: { $inc: { count: 1 } }, upsert: true } }
      // entu.db.collection('stats').updateOne(
      //   { date: date.substring(0, 10), function: functionName },
      //   { $inc: { count: 1 } },
      //   { upsert: true }
      // ),
      // entu.db.collection('stats').updateOne(
      //   { date: date.substring(0, 7), function: functionName },
      //   { $inc: { count: 1 } },
      //   { upsert: true }
      // ),
      // entu.db.collection('stats').updateOne(
      //   { date: date.substring(0, 4), function: functionName },
      //   { $inc: { count: 1 } },
      //   { upsert: true }
      // )
    ])
  })
})
