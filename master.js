var path     = require('path')
var cluster  = require('cluster')
var cpuCount = require('os').cpus().length



cluster.setupMaster({
    exec: path.join(__dirname, 'worker.js'),
})

// Create a worker for each CPU
for (var i = 0; i < cpuCount; i += 1) {
    cluster.fork()
}

// Listen for new workers
cluster.on('online', function(worker) {
    console.log(new Date().toString() + ' worker ' + worker.id + ' started')
})

// Listen for dying workers nad replace the dead worker, we're not sentimental
cluster.on('exit', function(worker) {
    console.log(new Date().toString() + ' worker ' + worker.id + ' died')
    cluster.fork()
})
