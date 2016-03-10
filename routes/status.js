var _      = require('underscore')
var async  = require('async')
var op     = require('object-path')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/requests', function(req, res) {
    var limit = req.query.limit || 5
    var days = req.query.days || 7

    var today = new Date();
    var lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);

    async.waterfall([
        function(callback) {
            entu.dbConnection('entu', callback)
        },
        function(connection, callback) {
            connection.collection('request').aggregate([
            	{
            		'$match' : {
                		date: {
                    		$gt: lastWeek
                		}
            		}
            	},
            	{
            		'$group' : {
            			_id: {
                            host: '$host',
                            month: { $month: '$date' },
                            day: { $dayOfMonth: '$date' },
                            year: { $year: '$date' }
                        },
            			count: {
            				$sum: 1
            			}
            		}
            	}
            ]).toArray(callback)
        },
        function(result, callback) {
            var seriesData = {}
            var seriesSum = {}

            for (var i in result) {
                if(!result.hasOwnProperty(i)) { continue }

                var host = op.get(result[i], '_id.host')
                var day = '00' + op.get(result[i], '_id.day')
                var day = day.substr(day.length - 2)
                var month = '00' + op.get(result[i], '_id.month')
                var month = month.substr(month.length - 2)
                var year = op.get(result[i], '_id.year')

                var date = [year, month, day].join('-')
                var count = op.get(result[i], 'count')

                op.set(seriesData, [host, 'sum'], op.get(seriesData, [host, 'sum'], 0) + count)
                op.set(seriesData, [host, 'name'], host)
                op.push(seriesData, [host, 'data'], [date, count])
                op.set(seriesData, [host, 'incomplete_from'], today.toISOString().substr(0, 10))

                var seriesDataValues = _.values(seriesData)
                var seriesDataValuesSorted = _.sortBy(seriesDataValues, 'sum')
            }
            var graphData = {
                x_axis: {
                    type: 'datetime'
                },
                series: seriesDataValuesSorted.slice(0, limit)
            }

            callback(null, graphData)
        },
    ], function(err, result) {
        if(err) {
            res.send({
                error: err,
                version: APP_VERSION,
                started: APP_STARTED
            })
        } else {
            res.send(result)
        }
    })
})



router.get('/test', function() {
    throw new Error('böö')
})



module.exports = router
