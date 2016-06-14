var _      = require('underscore')
var async  = require('async')
var fs     = require('fs')
var mysql  = require('mysql')
var op     = require('object-path')
var router = require('express').Router()


require.extensions['.sql'] = function(module, filename) { module.exports = fs.readFileSync(filename, 'utf8') }
var sql = require('./data.sql')



MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1'
MYSQL_USER = process.env.MYSQL_USER
MYSQL_PASSWORD = process.env.MYSQL_PASSWORD



var getVersions = function(mysqlDb, callback) {
    var connection = mysql.createConnection({
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: mysqlDb
    })

    connection.query(sql, function(err, rows) {
        if(err) { return callback(err) }

        // console.log(new Date())

        var entityVersions = []

        var entitiesCount = 0
        var versionsCount = 0
        var timer = new Date()

        var entities = _.values(_.groupBy(rows, 'entity_id'))

        _.each(_.values(_.groupBy(rows, 'entity_id')), function(entity) {
            var versions = {}
            var dates = ['##']

            _.each(entity, function(property) {
                dates.push([
                    (property.property_created_at || ''),
                    (property.property_created_by || ''),
                    property.property_definition === '_deleted_at' || property.property_definition === '_deleted_by' ? 'del' : ''
                ].join('#'))
                dates.push([
                    (property.property_deleted_at || ''),
                    (property.property_deleted_by || ''),
                    property.property_definition === '_deleted_at' || property.property_definition === '_deleted_by' ? 'del' : ''
                ].join('#'))
            })
            dates = _.uniq(dates)

            _.each(dates, function(date) {
                var references = []
                var files = []

                _.each(entity, function(property) {
                    if (!property.property_value) { return }

                    if (property.property_created_at && property.property_created_at > date.split('#')[0]) { return }
                    if (property.property_deleted_at && property.property_deleted_at <= date.split('#')[0]) { return }

                    var value = {}
                    if (property.property_type) { value.type = property.property_type }
                    if (property.property_language) { value.lang = property.property_language }

                    switch(property.property_type) {
                        case 'integer':
                            value.value = parseInt(property.property_value, 10)
                            break
                        case 'decimal':
                            value.value = parseFloat(property.property_value, 10)
                            break
                        case 'boolean':
                            value.value = property.property_value === '1'
                            break
                        case 'reference':
                            value.value = property.property_value
                            references.push(property.property_definition)
                            break
                        case 'date':
                            value.value = new Date(property.property_value)
                            break
                        case 'datetime':
                            value.value = new Date(property.property_value.replace(' ', 'T') + '-0000')
                            break
                        case 'file':
                            value.value = parseInt(property.property_value, 10)
                            files.push(property.property_definition)
                            break
                        default:
                            value.value = property.property_value
                    }
                    op.push(versions, [date, property.property_definition], value)
                })
                if (!op.get(versions, [date])) { return }

                op.set(versions, [date, '_versionId'], date)

                if (_.uniq(references).length > 0) { op.set(versions, [date, '_references'], _.uniq(references)) }
                if (_.uniq(files).length > 0) { op.set(versions, [date, '_files'], _.uniq(files)) }
            })

            var versions = _.sortBy(_.values(versions), '_versionId')
            var versionsLength = versions.length

            // entitiesCount = entitiesCount + 1
            // versionsCount = versionsCount + versions.length
            // if (entitiesCount % 1000 === 0) {
            //     var now = new Date()
            //     console.log(new Date(), entitiesCount, versionsCount, versionsCount / (now - timer) * 100)
            // }

            if (versionsLength < 2) { return }

            for (var i = 0; i < versionsLength; i++) {
                if (i > 0 && versions[i]._versionId.split('#')[0]) {
                    versions[i]._created_at = {
                        type: 'datetime',
                        value: new Date(versions[i]._versionId.split('#')[0].replace(' ', 'T') + '-0000')
                    }
                }
                if (i > 0 && versions[i]._versionId.split('#')[1]) {
                    versions[i]._created_by = {
                        type: 'reference',
                        value: versions[i]._versionId.split('#')[1]
                    }
                }
                if (i < versions.length - 1 && versions[i+1]._versionId.split('#')[0]) {
                    versions[i]._deleted_at = {
                        type: 'datetime',
                        value: new Date(versions[i+1]._versionId.split('#')[0].replace(' ', 'T') + '-0000')
                    }
                }
                if (i < versions.length - 1 && versions[i+1]._versionId.split('#')[1]) {
                    versions[i]._deleted_by = {
                        type: 'reference',
                        value: versions[i+1]._versionId.split('#')[1]
                    }
                }
            }

            for (var x = 0; x < versionsLength; x++) {
                if (versions[x]._versionId.split('#')[2] !== 'del') { continue }

                delete versions[x]
            }

            entityVersions.push(versions)
        })

        callback(null, entityVersions)
    })
}



async.waterfall([
    function(callback) {
        var connection = mysql.createConnection({
            host: MYSQL_HOST,
            user: MYSQL_USER,
            password: MYSQL_PASSWORD,
            database: 'entu'
        })
        connection.query('SELECT DISTINCT TABLE_SCHEMA AS db FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ("information_schema", "performance_schema", "mysql", "sys") ORDER BY TABLE_SCHEMA;', callback)
    },
    function(rows, fields, callback) {
        callback(null, _.map(rows, function(row) {
            return row.db
        }))
    },
    function(databases, callback) {
        console.log(new Date())
        async.eachSeries(databases, function(db) {
            getVersions(db, function(err, entities) {
                if(err) { return callback(err) }
                console.log(new Date(), db, entities.length)
            })
        }, callback)
    },
], function(err) {
    if(err) {
        console.error(err.toString())
        process.exit(1)
    }

    process.exit(1)
})
