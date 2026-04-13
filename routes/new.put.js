import stripe from 'stripe'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = await event.req.json()
  const { stripeKey } = useRuntimeConfig()

  if (typeof body.database !== 'string' || !body.database) {
    throw createError({ statusCode: 400, statusMessage: 'No database' })
  }

  const databaseName = formatDatabaseName(body.database)

  if (!databaseName) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid database name' })
  }

  const db = await connectDb(databaseName, true)

  if (!await isAvailableDatabase(databaseName, db)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid database name' })
  }

  if (!body.sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'No session' })
  }

  // Retrieve and validate Stripe session
  let session

  try {
    session = await stripe(stripeKey).checkout.sessions.retrieve(body.sessionId, {
      expand: ['line_items']
    })
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid session' })
  }

  if (session.status !== 'complete') {
    throw createError({ statusCode: 402, statusMessage: 'Payment required' })
  }

  const billingCustomerId = session.customer || null
  const customerEmail = session.customer_details?.email || null
  const customerName = session.customer_details?.name || null
  const customerPlan = session.line_items?.data?.at(0)?.description || null

  const entu = { account: databaseName, db, systemUser: true }

  const inviteToken = await initializeNewDatabase(entu, { email: customerEmail, name: customerName, plan: customerPlan }, billingCustomerId)

  return { db: databaseName, inviteToken }
})
