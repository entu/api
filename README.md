## API
#### Account
- /account
    - [GET](#get-account)

#### Authentication
- /auth
    - [GET](#get-auth)
- /auth/[ facebook \| google \| microsoft ]
    - [GET](#get-auth-facebook--google--microsoft-)

#### Entity
- /entity
    - [GET](#get-entity)
    - [POST](#post-entity)
- /entity/{ \_id }
    - [GET](#get-entity-_id-)
    - [POST](#post-entity-_id-)
    - [DELETE](#delete-entity-_id-)

#### Property
- /property/{ \_id }
    - [GET](#get-property-_id-)
    - [DELETE](#delete-property-_id-)




## GET /account
Returns account info and usage statistics

#### Query parameters
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```shell
curl \
    -X GET \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer c3H8gHLk9hjf6323n8dPHzXb" \
    "https://api.entu.ee/account"
```

#### Example response
```json
{
    "account": "account1",
    "stats": {
        "entities": 531,
        "deletedEntities": 85,
        "properties": 7446,
        "deletedProperties": 1547,
        "files": 70,
        "filesSize": 16240263,
        "deletedFiles": 9,
        "deletedFilesSize": 1392158
    }
}
```




## GET /auth
Authenticates user by API key. API key must be sent in Bearer authorization header. Returns object with JWT tokens for accessing databases where user exists. Use this token (in Bearer authorization header) for /account,  /entity and /property requests.

#### Example request
```shell
curl \
    -X GET \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer nEkPYET5fYjJqktNz9yfLxPF" \
    "https://api.entu.ee/auth"
```

#### Example response
```json
{
    "account1": {
        "token": "hNGcQgaeKh7ptWF5FVPbfKgpR5ZHCzT5cbA4BQWtmWGkfdQHg5HLDMCB8GwKw8gG"
    },
    "account2": {
        "token": "7RnGfkM7fayzDx7F8E2f65aTuuE5P7PEmYHVYNngKbDVx92bk2FVZBkfFBAPgpsT"
    }
}
```




## GET /auth/[ facebook \| google \| microsoft ]
Redirects user to given authentication provider (facebook, google, microsoft). After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Temporary API key is added to url end. Use this key to get JWT tokens from [/auth](#get-auth).
- If next is not set returns temporary API key.

Use this temporary API key to get JWT tokens from [/auth](#get-auth). This key can be used only once.

#### Query parameters
- **next** - Url where user is redirected after successful auth.

#### Example response
```json
{
    "key": "yp5xhSMf6uRnpJ5QKAeQ2RDT"
}
```




## GET /entity
Get list of entities. To filter entities by property value. Use dot separated list of *property key*, *data type* and *operator* as query parameter(s). Operator is optional, but must be one of following:
- **gt** - Matches values that are greater than a specified value.
- **gte** - Matches values that are greater than or equal to a specified value.
- **lt** - Matches values that are less than a specified value.
- **lte** - Matches values that are less than or equal to a specified value.
- **ne** - Matches all values that are not equal to a specified value.
- **regex** - Provides regular expression capabilities for pattern matching strings in queries.
- **exists** - Value must be true or false. When value is true, returns entities that contain the property, including entities where the property value is *null*. If value is false, the query returns only the entities that do not contain the property.

#### Query (other) parameters
- **props** - Comma separated list of properties to get. If not set all properties are returned.
- **sort** - Comma separated list of properties to use for sorting. Use - (minus) sign before property name for descending sort. If not set sorts by \_id.
- **limit** - How many entities to return.
- **skip** - How many entities to skip in result.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.


#### Example request
```shell
curl \
    -X GET \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    "https://api.entu.ee/entity?forename.string=John&file.size.gte=1024&surname.string.regex=/^Apple/i&photo._id.exists=false&sort=-file.size&limit=12"
```

#### Example response
```json
{
    "count": 0,
    "entities": []
}
```




## POST /entity
Create new entity. Data must be sent as JSON. Returns created entity's \_id.

#### Parameters
- **type** - Entity type. It's mandatory parameter.
- **parent** - Parent entity's \_id. If set, new entity is created "under" this entity and all rights are copied from parent to new entity.

#### Example request
```shell
curl \
    -X POST \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    -H "Content-Type: application/json" \
    -d '{ "type": "book", "parent": "FCfzcHh3ZF35UTaBcwkxVUSa" }'
    "https://api.entu.ee/entity"
```

#### Example response
```json
{
    "_id": "bsskJkDWwQXHB8ut7vQvmWZ4"
}
```




## GET /entity/{ \_id }
Get one entity with given id.

#### Query parameters
- **props** - Comma separated list of properties to get. If not set all properties are returned.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```shell
curl \
    -X GET \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    "https://api.entu.ee/entity/59abac1bb5684200016be61e"
```

#### Example response
```json
{}
```




## POST /entity/{ \_id }
Add new properties to entity. Data must be sent as JSON list containing property object(s). Returns created properties \_ids. If *filename* and *size* is set returns upload *url* and *signedRequest* for file upload.

#### Property object parameters
- **type** - Property type. It's mandatory parameter. Must be alphanumeric. Can contain \_, but not begin with one.
- [ **string** \| **reference** \| **boolean** \| **integer** \| **decimal** \| **date** \| **datetime** \| **filename** \| **size** ] - Property value

#### Example request
```shell
curl \
    -X POST \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    -H "Content-Type: application/json" \
    -d '[{ "type": "title", "string": "Hobbit" }, { "type": "photo", "filename": "cover.jpg" "size": 1937 }]'
    "https://api.entu.ee/entity/hAazguCezHwDfLe2geyKKpqj"
```

#### Example response
```json
[
    {
        "_id": "92eVbRk2xxFun2gXsxXaxWFk"
    },
    {
        "_id": "qXNdbysby2NHcgVDK3rrXUZk",
        "url": "https://entu-files.s3.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk",
        "signedRequest": "https://entu-files.s3-eu-west-1.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk?"
    }
]
```




## DELETE /entity/{ \_id }
Delete entity with given id.

#### Example request
```shell
curl \
    -X DELETE \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    "https://api.entu.ee/entity/59abac1bb5684200016be61e"
```

#### Example response
```json
{
    "deleted": true
}
```




## GET /property/{ \_id }
Get property with given id.

#### Query parameters
- **download** - If set and it's file property, redirects to file url.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```shell
curl \
    -X GET \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    "https://api.entu.ee/property/59abac1bb5684200016be445?download"
```

#### Example response
```json
{}
```




## DELETE /property/{ \_id }
Delete property with given id.

#### Example request
```shell
curl \
    -X DELETE \
    -H "Accept-Encoding: deflate" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
    "https://api.entu.ee/entity/59abac1bb5684200016be445"
```

#### Example response
```json
{
    "deleted": true
}
```
