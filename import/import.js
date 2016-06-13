var _      = require('underscore')
var async  = require('async')
var fs     = require('fs')
var mysql  = require('mysql')
var op     = require('object-path')
var router = require('express').Router()



require.extensions['.sql'] = function(module, filename) {
    module.exports = fs.readFileSync(filename, 'utf8')
}



var sql = require('./data.sql')



var getVersions = function(callback) {
    var connection = mysql.createConnection({
    })

    connection.query(sql, function(err, rows) {
        if(err) { return callback(err) }

        console.log(new Date())

        var entityVersions = {}

        var entitiesCount = 0
        var versionsCount = 0
        var timer = new Date()

        var entities = _.groupBy(rows, 'entity_id')
        for (var e in entities) {
            if (!entities.hasOwnProperty(e)) { continue }
            // if (!entity.entity_deleted !== null) { continue }

            var entity = entities[e]

            var dates = ['']
            for (var p in entity) {
                if (!entity.hasOwnProperty(p)) { continue }

                var property = entity[p]

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
            }
            dates = _.uniq(dates)

            for (var d in dates) {
                if (!dates.hasOwnProperty(d)) { continue }

                var date = dates[d].split('#')[0]

                var references = []
                var files = []
                for (var p in entity) {
                    if (!entity.hasOwnProperty(p)) { continue }

                    var property = entity[p]

                    if (!property.property_value) { continue }

                    if (property.property_created_at && property.property_created_at > date) { continue }
                    if (property.property_deleted_at && property.property_deleted_at <= date) { continue }

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
                    op.push(entityVersions, [e, dates[d], property.property_definition], value)
                }
                if (!op.get(entityVersions, [e, dates[d]])) { continue }

                op.set(entityVersions, [e, dates[d], '_versionId'], dates[d])

                if (_.uniq(references).length > 0) { op.set(entityVersions, [e, dates[d], '_references'], _.uniq(references)) }
                if (_.uniq(files).length > 0) { op.set(entityVersions, [e, dates[d], '_files'], _.uniq(files)) }
            }

            var versions = _.sortBy(_.values(entityVersions[e]), '_versionId')

            entitiesCount = entitiesCount + 1
            versionsCount = versionsCount + versions.length
            if (entitiesCount % 100 === 0) {
                var now = new Date()
                console.log(new Date(), entitiesCount, versionsCount, versionsCount / (now - timer) * 100)
                // timer = new Date()
            }

            if (versions.length < 2) { continue }

            for (var i = 0; i < versions.length; i++) {
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

            for (var i in entityVersions[e]) {
                if (!entityVersions[e].hasOwnProperty(i)) { continue }
                if (entityVersions[e][i]._versionId.split('#')[2] !== 'del') { continue }

                delete entityVersions[e][i]
            }

            entityVersions[e] = _.sortBy(_.values(entityVersions[e]), '_versionId')
        }

        callback(null, entityVersions)
    })
}



console.log(new Date())
getVersions(function(err, data) {
    if(err) { return console.error(err.toString()) }

    console.log(_.values(data).length)
    // console.log(JSON.stringify(_.values(data)[1], null, '  '))
    console.log(new Date())

    process.exit(0)
})
