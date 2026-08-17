import Stripe from 'stripe'

defineRouteMeta({
  openAPI: {
    tags: ['Database'],
    description: 'Returns a time-limited Stripe customer portal URL for managing subscriptions, payment methods, and invoices. If the database has no Stripe customer yet, one is created on the fly and stored before opening the portal.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'db',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          description: 'Database name'
        }
      },
      {
        name: 'locale',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Locale for billing portal (e.g., en, et)',
          example: 'en'
        }
      }
    ],
    responses: {
      200: {
        description: 'Billing portal URL for Stripe customer portal',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                billingUrl: {
                  type: 'string',
                  description: 'Stripe billing portal URL',
                  example: 'https://billing.stripe.com/p/session/...'
                }
              }
            }
          }
        }
      },
      403: {
        description: 'No user',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Database not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

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

  const database = await entu.db.collection('entity').findOne({
    'private._type.string': 'database',
    'private._editor.reference': entu.user
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
