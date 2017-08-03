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
            mongo.MongoClient.connect(MONGODB + mysqlDb, callback)
        },
        function(con, callback) {
            mongoCon = con
            mongoCon.listCollections({ name: 'property' }).toArray(callback)
        },
        function(collections, callback) {
            if (collections.length > 0) {
                mongoCon.dropCollection('property', callback)
            } else {
                callback(null, null)
            }
        },
        function(r, callback) {
            sqlCon.query(require('./sql/create_props.sql'), callback)
        },
        function(r, f, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'props table created')
            sqlCon.query(require('./sql/data.sql'), callback)
        },
        function(props, fields, callback) {
            console.log((new Date()).toISOString(), mysqlDb, 'props selected')
            mongoCon.collection('property').insertMany(props, callback)
        },
    ], function(err, r) {
        if(err) { return callback(err) }

        console.log((new Date()).toISOString(), mysqlDb, r.insertedCount, 'properties inserted')
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
