var _      = require('lodash')
var async  = require('async')
var fs     = require('fs')
var mysql  = require('mysql')
var op     = require('object-path')
var path   = require('path')
var router = require('express').Router()

var entu   = require('../helpers/entu')



require.extensions['.sql'] = function(module, filename) { module.exports = fs.readFileSync(filename, 'utf8') }



router.get('/sql', function(req, res, next) {
    var config = {
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: 'entu'
    }
    if (MYSQL_SSL_PATH) {
        config.ssl = {
            cert: fs.readFileSync(path.join(MYSQL_SSL_PATH, 'mysql-client-cert.pem')),
            key: fs.readFileSync(path.join(MYSQL_SSL_PATH, 'mysql-client-key.pem')),
            ca: fs.readFileSync(path.join(MYSQL_SSL_PATH, 'mysql-server-ca.pem'))
        }
    }


    var connection = mysql.createConnection(config)

    async.waterfall([
        function(callback) {
            connection.query(require('../import/customer_conf.sql'), function (err, rows) {
                callback(err, rows)
            })
        },
        function(customers, callback) {
            async.each(customers, function (customer, callback) {
                var config = {
                    host: customer.host,
                    user: customer.user,
                    password: customer.password,
                    database: customer.database
                }
                if (customer.ssl) {
                    config.ssl = {
                        cert: fs.readFileSync(path.join(customer.ssl, 'mysql-client-cert.pem')),
                        key: fs.readFileSync(path.join(customer.ssl, 'mysql-client-key.pem')),
                        ca: fs.readFileSync(path.join(customer.ssl, 'mysql-server-ca.pem'))
                    }
                }

                var customerConnection = mysql.createConnection(config)

                async.waterfall([
                    function (callback) {
                        customerConnection.query(require('../import/processlist.sql'), function (err, rows) {
                            if (err) { console.log(new Date(), err.message) }
                            callback(err, rows)
                        })
                    },
                    function (processlist, callback) {
                        async.each(processlist, function (p, callback) {
                            console.log(new Date(), 'KILL:', customer.database, 'process nr', p.id)
                            customerConnection.query(mysql.format(require('../import/kill.sql'), parseInt(p.id)), function (err, rows) {
                                if (err) { console.log(new Date(), err.message) }
                                callback(err, rows)
                            })
                        }, function (err, rows) {
                            if (err) { console.log(new Date(), err.message) }
                            callback(err, rows)
                        })
                    },
                    function (data, callback) {
                        customerConnection.end(function (err) {
                            if (err) { console.log(new Date(), err.message) }
                            callback(err)
                        })
                    },
                ], function (err, rows) {
                    if (err) { console.log(new Date(), err.message) }
                    callback(err, rows)
                })

            }, function (err, rows) {
                if (err) { console.log(new Date(), err.message) }
                callback(err, rows)
            })
        },
    ], function(err, result) {
        if(err) { return next(err) }

        connection.end()

        res.respond(result)
    })

})



router.get('/test', function() {
    throw new Error('böö')
})



module.exports = router
