const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')

const mongoDbUrl = process.env.MONGODB_URL
const mongoDbCA = process.env.MONGODB_CERT

let dbConnection

async function db (dbName) {
  dbName = dbName.replace(/[^a-z0-9]/gi, '_')

  if (dbConnection) { return dbConnection.db(dbName) }

  const mongoDbCAPath = path.resolve(__dirname, 'mongodb.ca.crt')

  if (!fs.existsSync(mongoDbCAPath)) {
    fs.writeFileSync(mongoDbCAPath, mongoDbCA)
    console.log('MongoDb CA certificate saved')
  }

  dbConnection = await MongoClient.connect(mongoDbUrl, { ssl: true, sslValidate: true, tls: true, tlsCAFile: mongoDbCAPath })
  dbConnection.on('close', () => {
    dbConnection = null
    console.log(`Disconnected from ${dbName} database`)
  })

  console.log(`Connected to ${dbName}`)

  return dbConnection.db(dbName)
}

module.exports = {
  db
}
