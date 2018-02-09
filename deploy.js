'use strict'

console.log('Loading function')

const aws = require('aws-sdk')
const async = require('async')



exports.handler = (event, context, callback) => {
    const lambda = new aws.Lambda()

    const functions = process.env.FUNCTIONS.split(',')

    async.each(functions, (functionName, callback) => {
        var params = {
            FunctionName: functionName,
            S3Key: event.Records[0].s3.object.key,
            S3Bucket: event.Records[0].s3.bucket.name
        }

        lambda.updateFunctionCode(params, function(err, data) {
            if (err) { return callback(err) }

            console.log(`Updated ${functionName} code`)
        })
    }, (err) => {
        if (err) { return callback(err) }

        callback(null)
    })
}
