var _      = require('underscore')
var async  = require('async')
var op     = require('object-path')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/requests', function(req, res) {
    var today = new Date();
    var lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);

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

            for (var variable in object) {
                if(!object.hasOwnProperty(variable)) { continue }

                var host = op.get(result, '_id.host')
                var day = op.get(result, '_id.year') + '-' + ('00' + op.get(result, '_id.month')).substr(0, 2) + '-' + ('00' + op.get(result, '_id.day')).substr(0, 2)
                var count = op.get(result, 'count')

                op.set(seriesData, [host, 'name'], host)
                op.push(seriesData, [host, 'data'], [day, count])
                op.push(seriesData, [host, 'incomplete_from'], today.toISOString().substr(0, 7))
            }
            var graphData = {
                x_axis: {
                    type: 'datetime'
                },
                series: _.values(seriesData)
                // [
                //     {
                //         name: 'Requests per day',
                //         data: [
                //             ['2014-01', 71173],
                //             ['2014-02', 57624],
                //             ['2014-03', 64851],
                //             ['2014-04', 60486],
                //             ['2014-05', 60500],
                //             ['2014-06', 62908],
                //             ['2014-07', 64818],
                //             ['2014-08', 59961],
                //             ['2014-09', 58542],
                //             ['2014-10', 22050]
                //         ],
                //         incomplete_from: today.toISOString().substr(0, 7)
                //     }
                // ]
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
            res.send({
                result: result,
                version: APP_VERSION,
                started: APP_STARTED
            })
        }
    })
})



router.get('/test', function() {
    throw new Error('böö')
})



module.exports = router
