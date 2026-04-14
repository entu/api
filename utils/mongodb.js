import { MongoClient, ObjectId } from 'mongodb'

export const mongoDbSystemDbs = ['admin', 'config', 'local']

const dbConnections = {}
let dbConnection

export async function connectDb (dbName, isNew) {
  if (!dbName)
    return

  if (dbConnections[dbName]) {
    return dbConnections[dbName]
  }

  if (!dbConnection) {
    const { mongodbUrl } = useRuntimeConfig()
    const dbClient = new MongoClient(mongodbUrl)

    dbConnection = await dbClient.connect()
  }

  const dbs = await dbConnection.db().admin().listDatabases()
  const dbNames = dbs.databases.map((db) => db.name)

  if (mongoDbSystemDbs.includes(dbName)) {
    logger('Database is a system database', { account: dbName })

    throw createError({
      statusCode: 400,
      statusMessage: `Account ${dbName} not found`
    })
  }

  if (!isNew && !dbNames.includes(dbName)) {
    logger('Database not found', { account: dbName })
    throw createError({
      statusCode: 404,
      statusMessage: `Account ${dbName} not found`
    })
  }

  dbConnections[dbName] = dbConnection.db(dbName)
  logger('Connected to database', { account: dbName })

  return dbConnections[dbName]
}

export function getObjectId (_id) {
  return new ObjectId(_id)
}

export function formatDatabaseName (name) {
  if (typeof name !== 'string' || !name)
    return

  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid database name: ${name}` })
  }

  if (mongoDbSystemDbs.includes(name)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid database name: ${name}` })
  }

  return name
}
