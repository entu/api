import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  serverDir: './',
  imports: {},
  runtimeConfig: {
    graphqlBasePath: '',
    jwtSecret: '',
    mongodbUrl: '',
    oauthId: '',
    oauthSecret: '',
    runAggregation: false,
    s3Region: '',
    s3Endpoint: '',
    s3Bucket: '',
    s3Key: '',
    s3Secret: '',
    sesRegion: '',
    sesEmail: '',
    sesKey: '',
    sesSecret: '',
    stripeKey: '',
    stripeEndpointSecret: ''
  },
  routeRules: {
    '/**': { cors: true }
  },
  experimental: {
    openAPI: true
  },
  openAPI: {
    meta: {
      title: 'Entu API Documentation'
    },
    production: 'prerender',
    ui: {
      scalar: {
        route: '/docs',
        spec: {
          url: '/openapi'
        },
        theme: 'default',
        hideDownloadButton: true,
        hideModels: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha'
      },
      swagger: false
    }
  }
})
