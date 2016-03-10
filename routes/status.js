var _       = require('underscore')
var async   = require('async')
var mongo   = require('mongodb').MongoClient
var op      = require('object-path')
var router  = require('express').Router()



router.get('/requests', function(req, res) {
    var today = new Date();
    var lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);

    async.waterfall([
        function(callback) {
            dbConnection('entu', callback)
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
