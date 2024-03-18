# Entu API Documentation

## Authentication

### GET /auth
Authenticates user by API key. API key must be sent in Bearer authorization header. Returns array of objects containing JWT tokens for accessing databases where user exists. Use this token (in Bearer authorization header) for /account,  /entity and /property requests.

#### Query parameters
- **account** - Account key. Oprional. If set, authentication is done only for this account.

#### Example request
```http
GET /api/auth HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer nEkPYET5fYjJqktNz9yfLxPF
```

#### Example response
```json
{
  "accounts": [
    {
      "_id": "account1",
      "name": "account1",
      "user": {
        "_id": "npfwb8fv4ku7tzpq5yjarncc",
        "name": "User 1"
      }
    },
    {
      "_id": "account2",
      "name": "account2",
      "user": {
        "_id": "sgkjlrq2evnmc3awmgnhfbb9",
        "name": "User 2"
      }
    }
  ],
  "token": "hNGcQgaeKh7ptWF5FVPbfKgpR5ZHCzT5cbA4BQWtmWGkfdQHg5HLDMCB8GwKw8gG"
}
```




### GET /auth/{ provider }
Redirects user to OAuth.ee for authentication. After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Temporary API key is added to url end.
- If next is not set returns temporary API key.

Use this temporary API key to get JWT tokens from [/auth](#get-auth). This key can be used only once.

#### Path parameters
- **provider** - Authentication provider - apple, google, smart-id, mobile-id or id-card.

#### Query parameters
- **next** - Url where user is redirected after successful auth.

#### Example response
```json
{
  "key": "M2s8xKpwxG77JYxbx7xw4cS9"
}
```




## Account

### GET /{ account }
Returns account info and usage statistics

#### Path parameters
- **account** - Account key.

#### Example request
```http
GET /api/account1 HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer c3H8gHLk9hjf6323n8dPHzXb
```

#### Example response
```json
{
  "entities": 531,
  "deletedEntities": 85,
  "properties": 7446,
  "deletedProperties": 1547,
  "files": 70,
  "filesSize": 16240263,
  "deletedFiles": 9,
  "deletedFilesSize": 1392158
}
```




## Entity

### GET /{ account }/entity
Get list of entities.

#### Path parameters
- **account** - Account key.

#### Query parameters
- **q** - Search string. Will search only from searchable fields.
- **props** - Comma separated list of properties to get. If not set all properties are returned (except on group request).
- **group** - Comma separated list of properties to group by. If set, then parameters limit and skip are ignored. Will return only group's count and properties set in props parameter.
- **sort** - Comma separated list of properties to use for sorting. Use - (minus) sign before property name for descending sort. If not set sorts by \_id.
- **limit** - How many entities to return.
- **skip** - How many entities to skip in result.

To filter entities by property value. Use dot separated list of *property key*, *data type* and *operator* as query parameter(s). Operator is optional, but must be one of following:
- **gt** - Matches values that are greater than a specified value.
- **gte** - Matches values that are greater than or equal to a specified value.
- **lt** - Matches values that are less than a specified value.
- **lte** - Matches values that are less than or equal to a specified value.
- **ne** - Matches all values that are not equal to a specified value.
- **regex** - Provides regular expression capabilities for pattern matching strings in queries.
- **exists** - Value must be true or false. When value is true, returns entities that contain the property, including entities where the property value is *null*. If value is false, the query returns only the entities that do not contain the property.

#### Example request
```http
GET /api/account1/entity?forename.string=John&file.size.gte=1024&surname.string.regex=/^Apple/i&photo._id.exists=false&sort=-file.size&limit=12 HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{
  "count": 0,
  "entities": []
}
```




### POST /{ account }/entity
Create new entity. Data must be sent as JSON list containing property object(s).

Returns created entity \_id and added properties.

For file upload, add *filename*, *filesize* and *filetype* to property parameters. Response contains *upload* object with info (url, method and headers) where to upload file (as request body).

#### Path parameters
- **account** - Account key.

#### Property object parameters
- **type** - Property type. It's mandatory parameter. Must be alphanumeric. Can contain \_, but not begin with one (except [system properties](#system-properties)).
- [ **string** \| **number** \| **boolean** \| **reference** \| **date** \| **datetime** \| **filename** \| **filesize** \| **filetype** ] - Property value.
- **language** - Optional. Language code for multilingual properties.

#### Example request
```http
POST /api/account1/entity HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
Content-Type: application/json; charset=utf-8
Content-Length: 151

[
  { "type": "_type", "string": "book" },
  { "type": "title", "string": "Hobbit" },
  { "type": "photo", "filename": "cover.jpg", "filesize": 1937, "filetype": "image/jpeg" }
]
```

#### Example response
```json
{
  "_id": "bsskJkDWwQXHB8ut7vQvmWZ4",
  "properties": [
    {
      "_id": "92eVbRk2xx44n2gXsxXaxQcd",
      "type": "_type",
      "string": "book"
    },
    {
      "_id": "92eVbRk2xxFun2gXsxXaxWFk",
      "type": "title",
      "string": "Hobbit"
    },
    {
      "_id": "qXNdbysby2NHcgVDK3rrXUZk",
      "type": "photo",
      "filename": "cover.jpg",
      "filesize": 1937,
      "upload": {
        "url": "https://entu-files.s3-eu-west-1.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk?",
        "method": "PUT",
        "headers": {}
      }
    }
  ]
}
```




### GET /{ account }/entity/{ \_id }
Get one entity with given id.

#### Path parameters
- **account** - Account key.
- **_id** - Entity _id.

#### Query parameters
- **props** - Comma separated list of properties to get. If not set all properties are returned.

#### Example request
```http
GET /api/account1/entity/59abac1bb5684200016be61e HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{}
```




### POST /{ account }/entity/{ \_id }
Add new properties to existing entity. Data must be sent as JSON list containing property object(s).

Returns added properties.

For file upload, add *filename*, *filesize* and *filetype* to property parameters. Response contains *upload* object with info (url, method and headers) where to upload file (as request body).

#### Path parameters
- **account** - Account key.
- **_id** - Entity _id.

#### Property object parameters
- **_id** - Optional. If set, then property with given _id will be replaced by the new property.
- **type** - Property type. It's mandatory parameter. Must be alphanumeric. Can contain \_, but not begin with one (except [system properties](#system-properties)).
- [ **string** \| **number** \| **boolean** \| **reference** \| **date** \| **datetime** \| **filename** \| **filesize** \| **filetype** ] - Property value.
- **language** - Optional. Language code for multilingual properties.

#### Example request
```http
POST /api/account1/entity/hAazguCezHwDfLe2geyKKpqj HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
Content-Type: application/json; charset=utf-8
Content-Length: 164

[
  { "_id": "65bcf278e0ef82d4b91f40d7", "type": "title", "string": "Hobbit", "language": "EN" },
  { "type": "photo", "filename": "cover.jpg", "filesize": 1937 }
]
```

#### Example response
```json
{
  "_id": "bsskJkDWwQXHB8ut7vQvmWZ4",
  "properties": [
    {
      "_id": "92eVbRk2xxFun2gXsxXaxWFk",
      "type": "title",
      "string": "Hobbit"
    },
    {
      "_id": "qXNdbysby2NHcgVDK3rrXUZk",
      "type": "photo",
      "filename": "cover.jpg",
      "filesize": 1937,
      "upload": {
        "url": "https://entu-files.s3-eu-west-1.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk?",
        "method": "PUT",
        "headers": {}
      }
    }
  ]
}
```




### DELETE /{ account }/entity/{ \_id }
Delete entity with given id.

#### Path parameters
- **account** - Account key.
- **_id** - Entity _id.

#### Example request
```http
DELETE /api/account1/entity/59abac1bb5684200016be61e HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{
  "deleted": true
}
```




### GET /{ account }/entity/{ \_id }/history
Get entity history (changelog).

#### Path parameters
- **account** - Account key.
- **_id** - Entity _id.

#### Example request
```http
GET /api/account1/entity/59abac1bb5684200016be61e/history HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{}
```




## Property

### GET /{ account }/property/{ \_id }
Get property with given id.

#### Path parameters
- **account** - Account key.
- **_id** - Property _id.

#### Query parameters
- **download** - If set and it's file property, redirects to file url.

#### Example request
```http
GET /api/account1/property/5b9648dd2e5c91011f9a42b5 HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{}
```




### DELETE /{ account }/property/{ \_id }
Delete property with given id.

#### Path parameters
- **account** - Account key.
- **_id** - Property _id.

#### Example request
```http
DELETE /api/account1/property/5b9648dd2e5c9100459a4157 HTTP/1.1
Host: entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{
  "deleted": true
}
```




## System properties

Entu system properties begin with \_. Those properties are:
- **_type** - Reference to entity's type.
- **_parent** - Reference to parent entity.
- **_public** - If set to *true*, entity (only it's public properties) is visible without authentication.
- **_viewer** - Reference to who can view this entity.
- **_expander** - Reference to who can add new entitys under this entity.
- **_editor** - Reference to who can change this entity's properties (except rights!).
- **_owner** - Reference to who can do anything with this entity (view, change, delete and manage rights).
- **_inheritrights** - Inherits rights from the parent entity. Entity-specific rights override inherited rights.

