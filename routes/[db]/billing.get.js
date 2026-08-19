import Stripe from 'stripe'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const { locale } = getQuery(event)
  const { stripeKey, appUrl } = useRuntimeConfig()

  if (!stripeKey) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe is not configured' })
  }

  const database = await entu.db.collection('entity').findOne({
    'private._type.string': 'database',
    'private._editor.reference': entu.user,
    _origin_db: { $exists: false }
  }, { projection: { _id: true, 'private.billing_customer_id.string': true } })

  if (!database?._id) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Database not found'
    })
  }

  const stripe = new Stripe(stripeKey)

  let customerId = database.private?.billing_customer_id?.at(0)?.string

  // Create and store a Stripe customer stub for databases that have no billing_customer_id yet
  if (!customerId) {
    const person = await entu.db.collection('entity').findOne({
      _id: entu.user
    }, { projection: { 'private.name.string': true, 'private.email.string': true } })

    const name = person?.private?.name?.at(0)?.string
    const email = person?.private?.email?.at(0)?.string || entu.email

    const customer = await stripe.customers.create({
      ...(name ? { name } : {}),
      description: entu.account,
      ...(email ? { email } : {})
    })

    customerId = customer.id

    await setEntity(
      { account: entu.account, db: entu.db, systemUser: true },
      database._id,
      [{ type: 'billing_customer_id', string: customerId }]
    )
  }

  const { url } = await stripe.billingPortal.sessions.create({
    customer: customerId,
    locale,
    return_url: `${appUrl}/${entu.account}`
  })

  return { billingUrl: url }
})
