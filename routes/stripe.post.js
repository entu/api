import stripe from 'stripe'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { stripeKey, stripeEndpointSecret } = useRuntimeConfig()

  const stripeSignature = event.req.headers.get('stripe-signature')
  const body = Buffer.from(await event.req.arrayBuffer())

  const { webhooks } = stripe(stripeKey)

  const stripeEvent = webhooks.constructEvent(body, stripeSignature, stripeEndpointSecret)

  if (stripeEvent.type === 'checkout.session.completed') {
    const { customer, client_reference_id: reference } = stripeEvent.data?.object

    if (!customer) {
      loggerError('No customer found in checkout')

      return
    }

    // No reference = new DB purchase (pricing table has no client-reference-id) — nothing to do
    if (!reference)
      return

    // Existing billing flow: update billing customer ID
    const [db, user] = reference.split('-')

    if (!user)
      return

    const entu = {
      account: db,
      db: await connectDb(db),
      systemUser: true
    }

    const { _id: databaseId } = await entu.db.collection('entity').findOne({
      'private._type.string': 'database'
    }, { projection: { _id: true } })

    await setEntity(entu, databaseId, [
      { type: 'billing_customer_id', string: customer }
    ])
  }
  else {
    loggerError(`Unhandled Stripe event "${stripeEvent.type}"`)
  }
})
