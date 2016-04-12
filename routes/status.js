var _      = require('underscore')
var async  = require('async')
var op     = require('object-path')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/requests', function(req, res) {
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
            var seriesTotals = {}
            var seriesData = {}
            for (var i in result) {
                if(!result.hasOwnProperty(i)) { continue }

                var host = op.get(result[i], '_id.host').replace('.entu.ee', '')
                var date = op.get(result[i], '_id.date')
                var count = op.get(result[i], 'count')

                op.set(seriesTotals, date, op.get(seriesTotals, date, 0) + count)
                op.set(seriesData, [host, 'sum'], op.get(seriesData, [host, 'sum'], 0) + count)
                op.set(seriesData, [host, 'name'], host)
                op.push(seriesData, [host, 'data'], [date, count])
                op.set(seriesData, [host, 'incomplete_from'], today.toISOString().substr(0, 10))
            }

            seriesData = _.sortBy(_.values(seriesData), 'sum').reverse().slice(0, top)
            seriesData.unshift({
                name: '*',
                data: _.map(seriesTotals, function(num, key){
                    return [key, num]
                }),
                incomplete_from: today.toISOString().substr(0, 10)
            })

            for (var i in seriesData) {
                if(!seriesData.hasOwnProperty(i)) { continue }

                for (var n in seriesData[i].data) {
                    if(!seriesData[i].data.hasOwnProperty(n)) { continue }

                    seriesData[i].data[n][1] = (date === today.toISOString().substr(0, 10)) ? seriesData[i].data[n][1] / (today.getHours() * 60 + today.getMinutes()) : seriesData[i].data[n][1] / 1440
                    seriesData[i].data[n][1] = Math.round(seriesData[i].data[n][1] * 100) / 100
                }

            }

            var graphData = {
                x_axis: {
                    type: 'datetime'
                },
                series: seriesData
            }

            callback(null, graphData)
        },
    ], function(err, result) {
        if(err) { return next(err) }

        res.send(result)
    })
})



router.get('/test', function() {
    throw new Error('böö')
})



module.exports = router
