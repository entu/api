var _      = require('underscore')
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
                            if (err) { console.log(err.message) }
                            if (rows) { console.log(rows) }
                            callback(err, rows)
                        })
                    },
                    function (processlist, callback) {
                        async.each(processlist, function (p, callback) {
                            console.log('KILL:', customer.database, 'process nr', p.id)
                            customerConnection.query(mysql.format(require('../import/kill.sql'), parseInt(p.id)), function (err, rows) {
                                if (err) { console.log(err.message) }
                                if (rows) { console.log(rows) }
                                callback(err, rows)
                            })
                        }, function (err, rows) {
                            if (err) { console.log(err.message) }
                            if (rows) { console.log(rows) }
                            callback(err, rows)
                        })
                    },
                    function (callback) {
                        customerConnection.end(function (err) {
                            if (err) { console.log(err.message) }
                            callback(err)
                        })
                    },
                ], function (err, rows) {
                    if (err) { console.log(err.message) }
                    if (rows) { console.log(rows) }
                    callback(err, rows)
                })

            }, function (err, rows) {
                if (err) { console.log(err.message) }
                if (rows) { console.log(rows) }
                callback(err, rows)
            })
        },
    ], function(err, result) {
        if(err) { return next(err) }

        connection.end()

        res.respond(result)
    })

})



router.get('/requests', function(req, res, next) {
    var top = req.query.top || 5
    var days = req.query.days || 7

    var today = new Date()
    var beginning = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))

    async.waterfall([
        function(callback) {
            entu.dbConnection('entu', callback)
        },
        function(connection, callback) {
            connection.collection('request').aggregate([
            	{
            		'$match' : {
                		date: {
                    		$gte: beginning
                		},

            		}
            	},
            	{
            		'$group' : {
            			_id: {
                            host: '$host',
                            date: {
                                $dateToString: {
                                    format: "%Y-%m-%d",
                                    date: "$date"
                                }
                            },
                        },
            			count: {
            				$sum: 1
            			}
            		}
            	}
            ]).toArray(callback)
        },
        function(result, callback) {
            // var seriesTotals = {}
            // var seriesData = {}
            //
            // for (var i in result) {
            //     if(!result.hasOwnProperty(i)) { continue }
            //
            //     var host = op.get(result[i], '_id.host').replace('.entu.ee', '')
            //     var date = op.get(result[i], '_id.date')
            //     var count = op.get(result[i], 'count')
            //
            //     op.set(seriesTotals, date, op.get(seriesTotals, date, 0) + count)
            //     op.set(seriesData, [host, 'sum'], op.get(seriesData, [host, 'sum'], 0) + count)
            //     op.set(seriesData, [host, 'name'], host)
            //     op.push(seriesData, [host, 'data'], [date, count])
            //     op.set(seriesData, [host, 'incomplete_from'], today.toISOString().substr(0, 10))
            // }
            //
            // seriesData = _.sortBy(_.values(seriesData), 'sum').reverse().slice(0, top)
            // seriesData.unshift({
            //     name: '*',
            //     data: _.map(seriesTotals, function(num, key){
            //         return [key, num]
            //     }),
            //     incomplete_from: today.toISOString().substr(0, 10)
            // })
            //
            // for (var i in seriesData) {
            //     if(!seriesData.hasOwnProperty(i)) { continue }
            //
            //     for (var n in seriesData[i].data) {
            //         if(!seriesData[i].data.hasOwnProperty(n)) { continue }
            //
            //         seriesData[i].data[n][1] = (date === today.toISOString().substr(0, 10)) ? seriesData[i].data[n][1] / (today.getHours() * 60 + today.getMinutes()) : seriesData[i].data[n][1] / 1440
            //         seriesData[i].data[n][1] = Math.round(seriesData[i].data[n][1] * 100) / 100
            //     }
            //
            // }
            //
            // var graphData = {
            //     x_axis: {
            //         type: 'datetime'
            //     },
            //     series: seriesData
            // }
            //
            // callback(null, graphData)

            callback(null, result)
        },
    ], function(err, result) {
        if(err) { return next(err) }

        res.respond(result)
    })
})



router.get('/test', function() {
    throw new Error('böö')
})



module.exports = router
