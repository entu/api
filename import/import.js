'use strict'

const _ = require('lodash')
const async = require('async')
const fs = require('fs')
const mongo = require('mongodb')
const mysql = require('mysql')



require.extensions['.sql'] = (module, filename) => {
    module.exports = fs.readFileSync(filename, 'utf8')
}



const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1'
const MYSQL_PORT = process.env.MYSQL_PORT || 3306
const MYSQL_USER = process.env.MYSQL_USER
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD
const MONGODB = process.env.MONGODB || 'mongodb://localhost:27017/'



var log = (s) => {
    console.log((new Date()).toISOString().substr(11).replace('Z', ''), s)
}



var importProps = (mysqlDb, callback) => {
    log('start database ' +  mysqlDb + ' import')

    var mongoCon = NaN
    var sqlCon = mysql.createConnection({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: mysqlDb,
        multipleStatements: true
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
            log('create mongodb indexes for import')
            mongoCon.collection('property').createIndexes([
                { key: { entity: 1 } },
                { key: { type: 1 } },
                { key: { value_integer: 1 } },
                { key: { created_by: 1 } },
                { key: { deleted_by: 1 } }
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
            sqlCon.query(require('./sql/get_properties.sql'), (err, props) => {
                if(err) { return callback(err) }

                mongoCon.collection('property').insertMany(props, callback)
            })
        },

        (callback) => {
            log('delete empty language field')
            mongoCon.collection('property').updateMany({ language: null }, { $unset: { language: '' } }, callback)
        },
        (callback) => {
            log('delete empty value_text field')
            mongoCon.collection('property').updateMany({ value_text: null }, { $unset: { value_text: '' } }, callback)
        },
        (callback) => {
            log('delete empty value_integer field')
            mongoCon.collection('property').updateMany({ value_integer: null }, { $unset: { value_integer: '' } }, callback)
        },
        (callback) => {
            log('delete empty value_decimal field')
            mongoCon.collection('property').updateMany({ value_decimal: null }, { $unset: { value_decimal: '' } }, callback)
        },
        (callback) => {
            log('delete empty value_date field')
            mongoCon.collection('property').updateMany({ value_date: null }, { $unset: { value_date: '' } }, callback)
        },
        (callback) => {
            log('delete empty created_at field')
            mongoCon.collection('property').updateMany({ created_at: null }, { $unset: { created_at: '' } }, callback)
        },
        (callback) => {
            log('delete empty created_by field')
            mongoCon.collection('property').updateMany({ created_by: null }, { $unset: { created_by: '' } }, callback)
        },
        (callback) => {
            log('delete empty deleted_at field')
            mongoCon.collection('property').updateMany({ deleted_at: null }, { $unset: { deleted_at: '' } }, callback)
        },
        (callback) => {
            log('delete empty deleted_by field')
            mongoCon.collection('property').updateMany({ deleted_by: null }, { $unset: { deleted_by: '' } }, callback)
        },

        (callback) => {
            log('parse file info to separate parameters')

            mongoCon.collection('property').find({ type: 'file', value_text: { $exists: true } }).toArray((err, files) => {
                if(err) { return callback(err) }

                var l = files.length
                async.eachSeries(files, (file, callback) => {
                    var fileArray = file.value_text.split('\n')
                    var fileInfo = {}
                    if (fileArray[0].substr(0, 2) === 'A:' && fileArray[0].substr(2)) { fileInfo.filename = fileArray[0].substr(2) }
                    if (fileArray[1].substr(0, 2) === 'B:' && fileArray[1].substr(2)) { fileInfo.md5 = fileArray[1].substr(2) }
                    if (fileArray[2].substr(0, 2) === 'C:' && fileArray[2].substr(2)) { fileInfo.s3 = fileArray[2].substr(2) }
                    if (fileArray[3].substr(0, 2) === 'D:' && fileArray[3].substr(2)) { fileInfo.url = fileArray[3].substr(2) }
                    if (fileArray[4].substr(0, 2) === 'E:' && fileArray[4].substr(2)) { fileInfo.size = parseInt(fileArray[4].substr(2), 10) }

                    mongoCon.collection('property').updateMany({ _id: file._id }, { $unset: { type: '', value_text: '' }, $set: fileInfo }, (err) => {
                        if(err) { return callback(err) }

                        l--
                        if (l % 1000 === 0 && l > 0) {
                            log(l + ' files to go')
                        }
                        return callback(null)
                    })
                }, callback)
            })
        },

        (callback) => {
            log('replace mysql numeric ids with mongodb _ids')

            mongoCon.collection('entity').find({}).sort({ _mid: 1 }).toArray((err, entities) => {
                if(err) { return callback(err) }

                var l = entities.length
                async.eachSeries(entities, (entity, callback) => {
                    async.parallel([
                        (callback) => {
                            mongoCon.collection('property').updateMany({ entity: entity._mid }, { $set: { entity: entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ type: 'reference', value_integer: entity._mid }, { $set: { value_integer: entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ created_by: entity._mid }, { $set: { created_by: entity._id } }, callback)
                        },
                        (callback) => {
                            mongoCon.collection('property').updateMany({ deleted_by: entity._mid }, { $set: { deleted_by: entity._id } }, callback)
                        },
                    ], (err) => {
                        if(err) { return callback(err) }

                        l--
                        if (l % 1000 === 0 && l > 0) {
                            log(l + ' entities to go')
                        }
                        return callback(null)
                    })
                }, callback)
            })
        },

        (callback) => {
            log('rename value_text to string')
            mongoCon.collection('property').updateMany({ type: 'string' }, { $unset: { type: '' }, $rename: { value_text: 'string' } }, callback)
        },
        (callback) => {
            log('rename value_text to text')
            mongoCon.collection('property').updateMany({ type: 'text' }, { $unset: { type: '' }, $rename: { value_text: 'text' } }, callback)
        },
        (callback) => {
            log('rename value_integer to integer')
            mongoCon.collection('property').updateMany({ type: 'integer' }, { $unset: { type: '' }, $rename: { value_integer: 'integer' } }, callback)
        },
        (callback) => {
            log('rename value_integer to reference')
            mongoCon.collection('property').updateMany({ type: 'reference' }, { $unset: { type: '' }, $rename: { value_integer: 'reference' } }, callback)
        },
        (callback) => {
            log('rename value_integer to boolean true')
            mongoCon.collection('property').updateMany({ type: 'boolean', value_integer: 1 }, { $unset: { type: '', value_integer: '' }, $set: { boolean: true } }, callback)
        },
        (callback) => {
            log('rename value_integer to boolean false')
            mongoCon.collection('property').updateMany({ type: 'boolean', value_integer: 0 }, { $unset: { type: '', value_integer: '' }, $set: { boolean: false } }, callback)
        },
        (callback) => {
            log('rename value_decimal to decimal')
            mongoCon.collection('property').updateMany({ type: 'decimal' }, { $unset: { type: '' }, $rename: { value_decimal: 'decimal' } }, callback)
        },
        (callback) => {
            log('rename value_date to date')
            mongoCon.collection('property').updateMany({ type: 'date' }, { $unset: { type: '' }, $rename: { value_date: 'date' } }, callback)
        },
        (callback) => {
            log('rename value_date to datetime')
            mongoCon.collection('property').updateMany({ type: 'datetime' }, { $unset: { type: '' }, $rename: { value_date: 'datetime' } }, callback)
        },

        (callback) => {
            log('rename created/deleted fields')
            mongoCon.collection('property').updateMany({}, { $rename: { created_at: 'created.at', created_by: 'created.by', deleted_at: 'deleted.at', deleted_by: 'deleted.by' } }, callback)
        },

        (callback) => {
            log('drop mongodb indexes for import')
            mongoCon.collection('property').dropAllIndexes(callback)
        },
        (callback) => {
            log('create property indexes')
            mongoCon.collection('property').createIndexes([
                { key: { entity: 1 } },
                { key: { deleted: 1 } }
            ], callback)
        },
        (callback) => {
            log('create entity indexes')
            mongoCon.collection('entity').createIndexes([
                { key: { _access: 1 } }
            ], callback)
        },

        (callback) => {
            log('create entities')

            mongoCon.collection('entity').find({}, { _id: true }).sort({ _id: 1 }).toArray((err, entities) => {
                if(err) { return callback(err) }

                var l = entities.length
                async.eachSeries(entities, (entity, callback) => {

                    mongoCon.collection('property').find({ entity: entity._id, deleted: { '$exists': false } }).toArray((err, properties) => {
                        if(err) { return callback(err) }

                        var p = _.mapValues(_.groupBy(properties, 'definition'), (o) => {
                            return _.map(o, (p) => {
                                return _.omit(p, ['entity', 'definition', 'created', 'md5', 's3', 'url'])
                            })
                        })

                        p._access = _.map(_.union(p._viewer, p._expander, p._editor, p._owner), 'reference')

                        mongoCon.collection('entity').update({ _id: entity._id }, { '$set': p, }, (err) => {
                            if(err) { return callback(err) }

                            l--
                            if (l % 1000 === 0 && l > 0) {
                                log(l + ' entities to go')
                            }
                            return callback(null)
                        })
                    })
                }, callback)
            })
        },

        (callback) => {
            log('repair mongodb')
            mongoCon.command({ repairDatabase: 1 }, callback)
        },
    ], (err) => {
        if(err) { return callback(err) }

        log('end database ' +  mysqlDb + ' import\n')
        return callback(null)
    })
}



var connection = mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD
})
connection.query(require('./sql/get_databases.sql'), (err, rows) => {
    if(err) {
        console.error(err.toString())
        process.exit(1)
    }

    async.eachSeries(rows, (row, callback) => {
        importProps(row.db, callback)
    }, (err) => {
        if(err) {
            console.error(err.toString())
            process.exit(1)
        }

        process.exit(1)
    })
})
