'use strict'

const _ = require('lodash')
const async = require('async')
const aws = require('aws-sdk')
const crypto = require('crypto')
const fs = require('fs')
const mongo = require('mongodb')
const mysql = require('mysql')
const path = require('path')



require.extensions['.sql'] = (module, filename) => {
    module.exports = fs.readFileSync(filename, 'utf8')
}



const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1'
const MYSQL_PORT = process.env.MYSQL_PORT || 3306
const MYSQL_USER = process.env.MYSQL_USER
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD
// const MYSQL_SSL_PATH = process.env.MYSQL_SSL_PATH
const MONGODB = process.env.MONGODB || 'mongodb://localhost:27017/'



const log = (s) => {
    console.log((new Date()).toISOString().substr(11).replace('Z', ''), s)
}



const importProps = (mysqlDb, callback) => {
    log(`start database ${mysqlDb} import`)

    var mongoCon
    var sqlCon = mysql.createConnection({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: mysqlDb,
        multipleStatements: true
        // ssl: {
        //     key: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-key.pem`),
        //     cert: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-cert.pem`),
        //     ca: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-server-ca.pem`)
        // }
    })

    async.series([
        (callback) => {
            log('create props table')
            sqlCon.query(require('./sql/create_props.sql'), callback)
        },

        (callback) => {
            mongo.MongoClient.connect(MONGODB, { ssl: true, sslValidate: true }, (err, con) => {
                if(err) { return callback(err) }

                mongoCon = con.db(mysqlDb)
                return callback(null)
            })
        },

        (callback) => {
            mongoCon.listCollections({ name: 'entity' }).toArray((err, collections) => {
                if(err) { return callback(err) }

                if (collections.length > 0) {
                    mongoCon.dropCollection('entity', callback)
                } else {
                    return callback(null)
                }
            })
        },
        (callback) => {
            mongoCon.listCollections({ name: 'property' }).toArray((err, collections) => {
                if(err) { return callback(err) }

                if (collections.length > 0) {
                    mongoCon.dropCollection('property', callback)
                } else {
                    return callback(null)
                }
            })
        },

        (callback) => {
            log('create entity indexes')
            mongoCon.collection('entity').createIndexes([
                { key: { '_oid': 1 } },
                { key: { _access: 1 } }
            ], callback)
        },
        (callback) => {
            log('create property indexes')
            mongoCon.collection('property').createIndexes([
                { key: { entity: 1 } },
                { key: { type: 1 } },
                { key: { deleted: 1 } },
                { key: { reference: 1 } },
                { key: { 'created.by': 1 } },
                { key: { 'deleted.by': 1 } }
            ], callback)
        },

        (callback) => {
            log('insert entities to mongodb')
            sqlCon.query(require('./sql/get_entities.sql'), (err, entities) => {
                if(err) { return callback(err) }

                mongoCon.collection('entity').insertMany(entities, callback)
            })
        },

        (callback) => {
            log('insert props to mongodb')

            var limit = 100000
            var count = limit
            var offset = 0

            async.whilst(
                () => { return count === limit },
                (callback) => {
                    sqlCon.query(require('./sql/get_properties.sql'), [limit, offset], (err, props) => {
                        if(err) { return callback(err) }

                        count = props.length
                        offset = offset + count

                        let cleanProps = _.map(props, x => _.pickBy(x, (value, key) => { return value === 0 || value === false || !!value }))
                        let correctedProps = _.map(cleanProps, x => {
                            if (x.created_by) {
                                _.set(x, 'created.by', x.created_by)
                                _.unset(x, 'created_by')
                            }
                            if (x.created_at) {
                                _.set(x, 'created.at', x.created_at)
                                _.unset(x, 'created_at')
                            }
                            if (x.deleted_by) {
                                _.set(x, 'deleted.by', x.deleted_by)
                                _.unset(x, 'deleted_by')
                            }
                            if (x.deleted_at) {
                                _.set(x, 'deleted.at', x.deleted_at)
                                _.unset(x, 'deleted_at')
                            }
                            if (x.datatype === 'datetime') {
                                _.set(x, 'datetime', x.date)
                                _.unset(x, 'date')
                            }
                            if (x.datatype === 'boolean') {
                                _.set(x, 'boolean', x.integer === 1)
                                _.unset(x, 'integer')
                            }
                            if (x.datatype === 'file') {
                                let fileArray = x.string.split('\n')
                                if (fileArray[0].substr(0, 2) === 'A:' && fileArray[0].substr(2)) { _.set(x, 'filename', fileArray[0].substr(2)) }
                                if (fileArray[1].substr(0, 2) === 'B:' && fileArray[1].substr(2)) { _.set(x, 'md5', fileArray[1].substr(2)) }
                                if (fileArray[2].substr(0, 2) === 'C:' && fileArray[2].substr(2)) { _.set(x, 's3', fileArray[2].substr(2)) }
                                if (fileArray[3].substr(0, 2) === 'D:' && fileArray[3].substr(2)) { _.set(x, 'url', fileArray[3].substr(2)) }
                                if (fileArray[4].substr(0, 2) === 'E:' && fileArray[4].substr(2)) { _.set(x, 'size', parseInt(fileArray[4].substr(2), 10)) }
                                _.unset(x, 'string')
                            }
                            _.unset(x, 'datatype')

                            return x
                        })

                        mongoCon.collection('property').insertMany(cleanProps, callback)
                    })
                }, callback)
        },

        (callback) => {
            log('close mysql connection')
            sqlCon.end(callback)
        },

        (callback) => {
            log('replace mysql ids with mongodb _ids')

            mongoCon.collection('entity').find({}).sort({ _oid: 1 }).toArray((err, entities) => {
                if(err) { return callback(err) }

                var l = entities.length
                async.eachSeries(entities, (entity, callback) => {
                    async.parallel([
                        (callback) => {
                            mongoCon.collection('property').updateMany({ entity: entity._oid }, { $set: { entity: entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ reference: entity._oid }, { $set: { reference: entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ 'created.by': entity._oid }, { $set: { 'created.by': entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ 'deleted.by': entity._oid }, { $set: { 'deleted.by': entity._id } }, callback)
                        },
                    ], (err) => {
                        if(err) { return callback(err) }

                        l--
                        if (l % 10000 === 0 && l > 0) {
                            log(`${l} entities to go`)
                        }
                        return callback(null)
                    })
                }, callback)
            })
        },

        (callback) => {
            log('create entities')

            mongoCon.collection('entity').find({}, { _id: true }).sort({ _id: 1 }).toArray((err, entities) => {
                if(err) { return callback(err) }

                var l = entities.length
                async.eachSeries(entities, (entity, callback) => {

                    mongoCon.collection('property').find({ entity: entity._id, deleted: { $exists: false } }).toArray((err, properties) => {
                        if(err) { return callback(err) }

                        let p = _.mapValues(_.groupBy(properties, 'type'), (o) => {
                            return _.map(o, (p) => {
                                return _.omit(p, ['_md5', 'entity', 'type', 'created', 's3', 'url', 'public'])
                            })
                        })

                        const access = _.map(_.union(p._viewer, p._expander, p._editor, p._owner), 'reference')
                        if (access.length > 0) {
                            p._access = access
                        }

                        if (!_.isEmpty(p)) {
                            mongoCon.collection('entity').update({ _id: entity._id }, { $set: p, }, (err) => {
                                if(err) { return callback(err) }

                                l--
                                if (l % 10000 === 0 && l > 0) {
                                    log(`${l} entities to go`)
                                }
                                return callback(null)
                            })
                        } else {
                            return callback(null)
                        }
                    })
                }, callback)
            })
        },

        (callback) => {
            log('delete deleted entities')
            mongoCon.collection('entity').deleteMany({ _deleted: { $exists: true } }, callback)
        },

        (callback) => {
            log('repair mongodb')
            mongoCon.command({ repairDatabase: 1 }, callback)
        },
        (callback) => {
            log('close mongodb connection')
            mongoCon.close(callback)
        },
    ], (err) => {
        if(err) { return callback(err) }

        log(`end database ${mysqlDb} import\n`)
        return callback(null)
    })
}



const importFiles = (mysqlDb, callback) => {
    log(`start ${mysqlDb} files import`)

    var sqlCon = mysql.createConnection({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: mysqlDb,
        multipleStatements: true,
        // ssl: {
        //     key: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-key.pem`),
        //     cert: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-cert.pem`),
        //     ca: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-server-ca.pem`)
        // }
    })

    aws.config = new aws.Config()
    aws.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
    aws.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
    aws.config.region = process.env.AWS_REGION

    sqlCon.query(require('./sql/get_files.sql'), (err, files) => {
        if(err) { return callback(err) }

        const s3 = new aws.S3()

        if (!fs.existsSync(process.env.FILES_PATH)) {
            fs.mkdirSync(process.env.FILES_PATH)
        }
        if (!fs.existsSync(path.join(process.env.FILES_PATH, mysqlDb))) {
            fs.mkdirSync(path.join(process.env.FILES_PATH, mysqlDb))
        }

        async.eachSeries(files, (file, callback) => {
            if (!file.s3_key) {
                if (file.md5) {
                    if (fs.existsSync(path.join(process.env.OLD_FILES_PATH, mysqlDb, file.md5.substr(0, 1), file.md5))) {
                        let f = fs.readFileSync(path.join(process.env.OLD_FILES_PATH, mysqlDb, file.md5.substr(0, 1), file.md5))

                        if (!fs.existsSync(path.join(process.env.FILES_PATH, mysqlDb, file.md5.substr(0, 1)))) {
                            fs.mkdirSync(path.join(process.env.FILES_PATH, mysqlDb, file.md5.substr(0, 1)))
                        }
                        fs.writeFileSync(path.join(process.env.FILES_PATH, mysqlDb, file.md5.substr(0, 1), file.md5), f)

                        sqlCon.query(require('./sql/update_files.sql'), [file.md5, f.length, 'Copied local file', file.id], (err) => {
                            if(err) { return callback(err) }
                            return callback(null)
                        })
                    } else {
                        sqlCon.query(require('./sql/update_files_error.sql'), ['No local file', file.id], (err) => {
                            if(err) { return callback(err) }
                            return callback(null)
                        })
                    }
                } else {
                    sqlCon.query(require('./sql/update_files_error.sql'), ['No file', file.id], (err) => {
                        if(err) { return callback(err) }
                        return callback(null)
                    })
                }
            } else {
                s3.getObject({ Bucket: process.env.AWS_S3_BUCKET, Key: file.s3_key }, (err, data) => {
                    if(err) {
                        sqlCon.query(require('./sql/update_files_error.sql'), [err.toString(), file.id], callback)
                        return
                    }

                    let md5 = crypto.createHash('md5').update(data.Body).digest('hex')
                    let size = data.Body.length

                    if(file.md5 && file.md5 !== md5) { log(`${file.id} - md5 not same ${md5}`) }
                    if(file.filesize !== size) { log(`${file.id} - size not same ${size}`) }

                    if (!fs.existsSync(path.join(process.env.FILES_PATH, mysqlDb, md5.substr(0, 1)))) {
                        fs.mkdirSync(path.join(process.env.FILES_PATH, mysqlDb, md5.substr(0, 1)))
                    }

                    fs.writeFileSync(path.join(process.env.FILES_PATH, mysqlDb, md5.substr(0, 1), md5), data.Body)

                    sqlCon.query(require('./sql/update_files.sql'), [md5, size, 'S3', file.id], callback)
                })
            }
        }, (err) => {
            if(err) { return callback(err) }

            log(`end ${mysqlDb} files import`)
            return callback(null)
        })
    })
}



const connection = mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    // ssl: {
    //     key: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-key.pem`),
    //     cert: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-client-cert.pem`),
    //     ca: fs.readFileSync(`${MYSQL_SSL_PATH}/mysql-server-ca.pem`)
    // }
})
connection.query(require('./sql/get_databases.sql'), (err, rows) => {
    if(err) {
        console.error(err.toString())
        process.exit(1)
    }

    connection.end()

    async.eachSeries(rows, (row, callback) => {
        // importFiles(row.db, callback)
        importProps(row.db, callback)
    }, (err) => {
        if(err) {
            console.error(err.toString())
            process.exit(1)
        }

        process.exit(0)
    })
})
