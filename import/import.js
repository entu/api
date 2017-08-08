var _     = require('underscore')
var async = require('async')
var fs    = require('fs')
var mongo = require('mongodb')
var mysql = require('mysql')
var op    = require('object-path')
var path  = require('path')



require.extensions['.sql'] = function(module, filename) { module.exports = fs.readFileSync(filename, 'utf8') }



MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1'
MYSQL_PORT = process.env.MYSQL_PORT || 3306
MYSQL_USER = process.env.MYSQL_USER
MYSQL_PASSWORD = process.env.MYSQL_PASSWORD
MONGODB = process.env.MONGODB || 'mongodb://localhost:27017/'



var importProps = function(mysqlDb, callback) {
    console.log((new Date()).toISOString(), mysqlDb, 'start import')

    var mongoCon = NaN
    var sqlCon = mysql.createConnection({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: mysqlDb,
        multipleStatements: true
    })

    async.waterfall([
        function(callback) {
            mongo.MongoClient.connect(MONGODB + mysqlDb, { ssl: true, sslValidate: false }, callback)
        },

        function(con, callback) {
            mongoCon = con
            mongoCon.listCollections({ name: 'entity' }).toArray(callback)
        },
        function(collections, callback) {
            if (collections.length > 0) {
                mongoCon.dropCollection('entity', callback)
            } else {
                callback(null, null)
            }
        },
        function(r, callback) {
            mongoCon.listCollections({ name: 'property' }).toArray(callback)
        },
        function(collections, callback) {
            if (collections.length > 0) {
                mongoCon.dropCollection('property', callback)
            } else {
                callback(null, null)
            }
        },

        // function(r, callback) {
        //     console.log((new Date()).toISOString(), mysqlDb, 'create props table')
        //     sqlCon.query(require('./sql/create_props.sql'), callback)
        // },
        //
        // function(r, f, callback) {
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'get entities from mysql')
            sqlCon.query(require('./sql/entity.sql'), callback)
        },
        function(entities, fields, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'insert entities to mongodb')
            mongoCon.collection('entity').insertMany(entities, callback)
        },

        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'get props from mysql')
            sqlCon.query(require('./sql/props.sql'), callback)
        },
        function(props, fields, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'insert props to mongodb')
            mongoCon.collection('property').insertMany(props, callback)
        },

        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty language field')
            mongoCon.collection('property').updateMany({ language: null }, { $unset: { language: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty value_text field')
            mongoCon.collection('property').updateMany({ value_text: null }, { $unset: { value_text: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty value_integer field')
            mongoCon.collection('property').updateMany({ value_integer: null }, { $unset: { value_integer: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty value_decimal field')
            mongoCon.collection('property').updateMany({ value_decimal: null }, { $unset: { value_decimal: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty value_date field')
            mongoCon.collection('property').updateMany({ value_date: null }, { $unset: { value_date: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty created_at field')
            mongoCon.collection('property').updateMany({ created_at: null }, { $unset: { created_at: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty created_by field')
            mongoCon.collection('property').updateMany({ created_by: null }, { $unset: { created_by: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty deleted_at field')
            mongoCon.collection('property').updateMany({ deleted_at: null }, { $unset: { deleted_at: '' } }, callback)
        },
        function(r, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'delete empty deleted_by field')
            mongoCon.collection('property').updateMany({ deleted_by: null }, { $unset: { deleted_by: '' } }, callback)
        },
    ], function(err, r) {
        if(err) { return callback(err) }

        console.log((new Date()).toISOString(), mysqlDb, 'end import')
        callback(null)
    })
}



var connection = mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD
})
connection.query(require('./sql/db.sql'), function(err, rows) {
    if(err) {
        console.error(err.toString())
        process.exit(1)
    }

    async.eachSeries(rows, function(row, callback) {
        importProps(row.db, callback)
    }, function(err) {
        if(err) {
            console.error(err.toString())
            process.exit(1)
        }

        process.exit(1)
    })
})
