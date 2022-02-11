const http = require('http')
const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')

const port = process.env.PORT || 8080
const mongoDbName = process.env.MONGODB_NAME
const mongoDbUrl = process.env.MONGODB_URL
const mongoDbCA = process.env.MONGODB_CERT

const mongoDbCAPath = path.resolve(__dirname, 'mongodb.ca.crt')

if (!fs.existsSync(mongoDbCAPath)) {
  fs.writeFileSync(mongoDbCAPath, mongoDbCA)
  console.log('MongoDb CA certificate saved')
}

const dbClient = new MongoClient(mongoDbUrl)

const server = http.createServer(async (req, res) => {
  await dbClient.connect()
  const database = dbClient.db(mongoDbName, { tlsCAFile: mongoDbCAPath, ssl: true, sslValidate: true })
  await database.command({ ping: 1 })

  console.log('Connected to MongoDb')

  try {
    const { method, socket } = req
    const headers = getHeaders(req)
    const params = await getParams(req)
    const { pathname } = new URL(req.url, `${req.protocol}://${headers.host}/`)

    if (method === 'GET' && pathname === '/') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: true
      }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        clientIp: headers['x-forwarded-for'] || socket.remoteAddress,
        method: method,
        path: pathname,
        params: params
      }))
    }
  } catch (error) {
    console.error(error)

    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: true
    }))
  }
})

function getHeaders (req) {
  return Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])
  )
}

function getParams (req) {
  return new Promise(resolve => {
    const { method } = req
    const headers = getHeaders(req)

    if (method === 'GET') {
      const { searchParams } = new URL(req.url, `${req.protocol}://${headers.host}/`)
      resolve(Object.fromEntries(searchParams))
    }

    if (method === 'POST') {
      let body = ''

      req.on('data', chunk => {
        body += chunk.toString()
      })

      req.on('end', () => {
        switch (headers['content-type']) {
          case 'application/x-www-form-urlencoded': {
            const { searchParams } = new URL(`/?${body}`, `${req.protocol}://${headers.host}/`)
            resolve(Object.fromEntries(searchParams))
            break
          }
          case 'application/json': {
            resolve(JSON.parse(body))
            break
          }
          default: {
            resolve({})
            break
          }
        }
      })
    }
  })
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
