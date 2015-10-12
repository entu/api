var mysql  = require('mysql')
var async  = require('async')
var op     = require('object-path')
var random = require('randomstring')


// Get connection to current domain database
exports.db = db = function(domain, callback) {
    async.waterfall([
        function(callback) {
            mysql.createConnection({
                host     : APP_MYSQL_HOST,
                database : APP_MYSQL_DATABASE,
                user     : APP_MYSQL_USER,
                password : APP_MYSQL_PASSWORD
            }).query(`
                SELECT
                    MAX(db_host) AS db_host,
                    MAX(db_database) AS db_database,
                    MAX(db_password) AS db_password,
                    MAX(db_user) AS db_user
                FROM (
                    SELECT
                        IF(property_definition.dataproperty = 'database-host', property.value_string, NULL) AS db_host,
                        IF(property_definition.dataproperty = 'database-name', property.value_string, NULL) AS db_database,
                        IF(property_definition.dataproperty = 'database-password', property.value_string, NULL) AS db_password,
                        IF(property_definition.dataproperty = 'database-user', property.value_string, NULL) AS db_user
                    FROM entity, property, property_definition
                    WHERE property.entity_id = entity.id
                    AND property_definition.keyname = property.property_definition_keyname
                    AND entity.is_deleted = 0
                    AND property.is_deleted = 0
                    AND property_definition.is_deleted = 0
                    AND property_definition.dataproperty IN ('database-host', 'database-name', 'database-password', 'database-port', 'database-user')
                    AND entity.id = (
                        SELECT entity_id
                        FROM property, property_definition
                        WHERE property_definition.keyname = property.property_definition_keyname
                        AND property.is_deleted = 0
                        AND property_definition.is_deleted = 0
                        AND property_definition.dataproperty = 'domain'
                        AND property.value_string = '` + domain + `'
                    )
                ) AS x
                LIMIT 1;
            `, callback)
        },
        function(rows, fields, callback) {
            if(rows.length < 1) return callback(new Error('Domain "' + domain + '" is not configured!'))

            callback(null, mysql.createConnection({
                host     : op.get(rows, '0.db_host'),
                database : op.get(rows, '0.db_database'),
                user     : op.get(rows, '0.db_user'),
                password : op.get(rows, '0.db_password')
            }))
        },
    ], function(err, connection) {
        if (err) return callback(err)

        callback(null, connection)
    })
}



// Create user session
exports.session_start = function(params, callback) {
    if(!params.domain) return callback(new Error('No doamain'))
    if(!params.user) return callback(new Error('No user'))

    var session = {
        provider: op.get(params, 'user.provider'),
        provider_id: op.get(params, 'user.id'),
        name: op.get(params, 'user.name'),
        email: op.get(params, 'user.email'),
        picture: op.get(params, 'user.picture'),
        language: 'et',
        ip: op.get(params, 'request.ip'),
        browser: op.get(params, 'request.headers.user-agent'),
        session_key: random.generate(64)
    }

    async.waterfall([
        function(callback) {
            db(params.domain, callback)
        },
        function(connection, callback) {
            connection.query('INSERT INTO session SET created=NOW(), ?', session, callback)
        },
    ], function(err, results) {
        if (err) return callback(err)
        params.response.cookie('session', session.session_key)
        callback(null, session.session_key)
    })
}
