'use strict'

const _ = require('lodash')
const async = require('async')
const aws = require('aws-sdk')
const jwt = require('jsonwebtoken')
const mongo = require('mongodb').MongoClient
const mysql = require('mysql')



let parameters = {}
const loadParameters = (names, callback) => {
    const ssm = new aws.SSM()

    var params = {
        Names: names,
        WithDecryption: true
    }

    ssm.getParameters(params, function(err, data) {
        if (err) { return callback(err) }

        _.get(data, 'Parameters', []).forEach(function(element) {
            parameters[element.Name] = element.Value
        })
    })
}



let dbConnection
const db = (dbName, callback) => {
    if (dbConnection) {
        return callback(null, dbConnection.db(dbName))
    }

    mongo.connect(process.env.MONGODB, { ssl: true, sslValidate: true }, (err, connection) => {
        if (err) { return callback(err) }

        console.log(`Connected to ${dbName}`)

        connection.on('close', () => {
            dbConnection = null
            console.log(`Disconnected from ${dbName}`)
        })

        dbConnection = connection

        callback(null, dbConnection.db(dbName))
    })
}
exports.db = db



let mysqlConnection = {}
const mysqlDb = (dbName) => {
    if (mysqlConnection[dbName]) {
        return mysqlConnection[dbName]
    }

    mysqlConnection[dbName] = mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: dbName,
        multipleStatements: false,
        // ssl: {
        //     ca: fs.readFileSync(MYSQL_SSL_CA)
        // }
    })

    mysqlConnection[dbName].on('error', (err) => {
        console.log(err)
        mysqlConnection[dbName].end()
        delete mysqlConnection[dbName]
    })

    console.log(`Connected to ${dbName}`)

    return mysqlConnection[dbName]
}
exports.mysqlDb = mysqlDb



exports.user = (event, callback) => {
    var result

    const authHeaderParts = _.get(event, 'headers.Authorization', '').split(' ')
    const jwtConf = {
        issuer: _.get(event, 'queryStringParameters.account'),
        audience: _.get(event, 'requestContext.identity.sourceIp')
    }

    async.waterfall([
        (callback) => {
            if (authHeaderParts.length === 2 && authHeaderParts[0].toLowerCase() === 'bearer') {
                jwt.verify(authHeaderParts[1], process.env.JWT_SECRET, jwtConf, (err, decoded) => {
                    if (err) { return callback([401, err]) }

                    if (decoded.aud !== jwtConf.audience) { return callback([403, 'Invalid JWT audience']) }

                    callback(null, {
                        id: decoded.sub,
                        account: decoded.iss
                    })
                })
            } else {
                callback(null, {
                    account: jwtConf.issuer
                })
            }
        },
        (u, callback) => {
            if (!u.account) { return callback([400, 'No account parameter']) }

            result = u
            db(result.account, callback)
        },
    ], (err, db) => {
        if (err) { return callback(err) }

        result.db = db

        callback(null, result)
    })
}



// Create user session
exports.addUserSession = (user, callback) => {
    if(!user) { return callback('No user') }

    const session = {
        created: new Date(),
        user: user
    }

    async.waterfall([
        (callback) => {
            db('entu', callback)
        },
        (connection, callback) => {
            connection.collection('session').insertOne(_.pickBy(session, _.identity), callback)
        }
    ], (err, r) => {
        if(err) { return callback(err) }

        return callback(null, r.insertedId)
    })
}



// Aggregate entity from property collection
exports.aggregateEntity = (db, entityId, property, callback) => {
    var connection

    async.waterfall([
        (callback) => {
            db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray((err, properties) => {
                if(err) { return callback(err) }

                let p = _.groupBy(properties, v => { return v.public === true ? 'public' : 'private' })

                if (p.public) {
                    p.public = _.mapValues(_.groupBy(p.public, 'type'), (o) => {
                        return _.map(o, (p) => {
                            return _.omit(p, ['entity', 'type', 'created', 's3', 'url', 'public'])
                        })
                    })
                }
                if (p.private) {
                    p.private = _.mapValues(_.groupBy(p.private, 'type'), (o) => {
                        return _.map(o, (p) => {
                            return _.omit(p, ['entity', 'type', 'created', 's3', 'url', 'public'])
                        })
                    })
                }
                p.private = Object.assign({}, _.get(p, 'public', {}), _.get(p, 'private', {}))

                const access = _.map(_.union(_.get(p, 'private._viewer', []), _.get(p, 'private._expander', []), _.get(p, 'private._editor', []), _.get(p, 'private._owner', [])), 'reference')
                if (_.get(p, 'private._public.0.boolean', false) === true) {
                    access.push('public')
                }
                if (access.length > 0) {
                    p.access = access
                }

                if (!_.isEmpty(p)) {
                    if (_.has(p, '_deleted')) {
                        db.collection('entity').deleteOne({ _id: entityId }, callback)
                    } else {
                        db.collection('entity').update({ _id: entityId }, p, callback)
                    }
                } else {
                    return callback(null)
                }
            })
        }
    ], callback)
}



exports.json = (data, code, headers) => {
    if (headers) {
        headers['Access-Control-Allow-Origin'] = '*'
    } else {
        headers = {
            'Access-Control-Allow-Origin': '*'
        }
    }

    return {
        statusCode: code || 200,
        headers: headers || {},
        body: JSON.stringify(data),
        isBase64Encoded: false
    }
}



exports.error = (err, headers) => {
    let code
    let message

    if (headers) {
        headers['Access-Control-Allow-Origin'] = '*'
    } else {
        headers = {
            'Access-Control-Allow-Origin': '*'
        }
    }

    if (err.constructor === Array) {
        code = err[0]
        message = err[1]
    } else {
        message = err.toString()
    }

    return {
        statusCode: code || 500,
        headers: headers,
        body: JSON.stringify({ message: message }),
        isBase64Encoded: false
    }
}



exports.redirect = (url, code, headers) => {
    if (headers) {
        headers['Location'] = url
    } else {
        headers = {
            'Location' : url
        }
    }
    headers['Access-Control-Allow-Origin'] = '*'

    return {
        statusCode: code || 302,
        headers: headers,
        body: null
    }
}
