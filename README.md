# Entu API Documentation

## Account

### GET /account
Returns account info and usage statistics

#### Query parameters
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```http
GET /account HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer c3H8gHLk9hjf6323n8dPHzXb
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




## Authentication

### GET /auth
Authenticates user by API key. API key must be sent in Bearer authorization header. Returns array of objects containing JWT tokens for accessing databases where user exists. Use this token (in Bearer authorization header) for /account,  /entity and /property requests.

#### Query parameters
- **account** - Account key. If set, authentication is done only for this account.

#### Example request
```http
GET /auth HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer nEkPYET5fYjJqktNz9yfLxPF
```

#### Example response
```json
[
  {
    "_id": "3g5tee54fp36hssntqm4rasd",
    "account": "account1",
    "token": "hNGcQgaeKh7ptWF5FVPbfKgpR5ZHCzT5cbA4BQWtmWGkfdQHg5HLDMCB8GwKw8gG"
  },
  {
    "_id": "dpjhnc8zq6u33xtnz7u75ydf",
    "account": "account1",
    "token": "7RnGfkM7fayzDx7F8E2f65aTuuE5P7PEmYHVYNngKbDVx92bk2FVZBkfFBAPgpsT"
  }
]
```




### GET /auth/apple
Redirects user to Apple for authentication. After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Temporary API key is added to url end.
- If next is not set returns temporary API key.

Use this temporary API key to get JWT tokens from [/auth](#get-auth). This key can be used only once.

#### Query parameters
- **next** - Url where user is redirected after successful auth.

#### Example response
```json
{
  "key": "M2s8xKpwxG77JYxbx7xw4cS9"
}
```




### GET /auth/google
Redirects user to Google for authentication. After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Temporary API key is added to url end.
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




### GET /auth/lhv
Get form data for authentication with [LHV Bank link](https://www.lhv.ee/en/bank-link). Make a form (with all data from *signedRequest*) and POST it to given *url*. After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Temporary API key is added to url end.
- If next is not set returns temporary API key.

Use this temporary API key to get JWT tokens from [/auth](#get-auth). This key can be used only once.

#### Query parameters
- **next** - Url where user is redirected after successful auth.

#### Example request
```http
GET /auth/lhv?next=https://entu.app/auth/lhv/ HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
```

#### Example response
```json
{
  "url": "https://www.lhv.ee/banklink",
  "signedRequest": {
    "VK_SERVICE": "4011",
    "VK_VERSION": "008",
    "VK_SND_ID": "...",
    "VK_REPLY": "3012",
    "VK_RETURN": "https://api.entu.app/auth/lhv?next=",
    "VK_DATETIME": "2019-07-01T11:09:31Z",
    "VK_RID": "",
    "VK_MAC": "KxTYo4qb7RuGJQSO0UKxTYo4FL0BcHYAQxT8Qj//0YsXKp3YeRGJQSO0U5wGKlFxlg==",
    "VK_ENCODING": "UTF-8",
    "VK_LANG": "EST"
  }
}
```




## Entity

### GET /entity
Get list of entities. To filter entities by property value. Use dot separated list of *property key*, *data type* and *operator* as query parameter(s). Operator is optional, but must be one of following:
- **gt** - Matches values that are greater than a specified value.
- **gte** - Matches values that are greater than or equal to a specified value.
- **lt** - Matches values that are less than a specified value.
- **lte** - Matches values that are less than or equal to a specified value.
- **ne** - Matches all values that are not equal to a specified value.
- **regex** - Provides regular expression capabilities for pattern matching strings in queries.
- **exists** - Value must be true or false. When value is true, returns entities that contain the property, including entities where the property value is *null*. If value is false, the query returns only the entities that do not contain the property.

#### Query (other) parameters
- **q** - Search string. Will search only from searchable fields.
- **props** - Comma separated list of properties to get. If not set all properties are returned.
- **sort** - Comma separated list of properties to use for sorting. Use - (minus) sign before property name for descending sort. If not set sorts by \_id.
- **limit** - How many entities to return.
- **skip** - How many entities to skip in result.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```http
GET /entity?forename.string=John&file.size.gte=1024&surname.string.regex=/^Apple/i&photo._id.exists=false&sort=-file.size&limit=12 HTTP/1.1
Host: api.entu.app
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




### POST /entity
Create new entity. Data must be sent as JSON list containing property object(s).

Returns created entity \_id and it's properties \_ids. If *filename* and *size* is set in property, returns upload *url* and *signedRequest* for file upload.

#### Property object parameters
- **type** - Property type. It's mandatory parameter. Must be alphanumeric. Can contain \_, but not begin with one (except [system properties](#system-properties)).
- [ **string** \| **reference** \| **boolean** \| **integer** \| **decimal** \| **date** \| **datetime** \| **filename** \| **size** ] - Property value

#### Example request
```http
POST /entity HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
Content-Type: application/json; charset=utf-8
Content-Length: 151

[
  { "type": "_type", "string": "book" },
  { "type": "title", "string": "Hobbit" },
  { "type": "photo", "filename": "cover.jpg" "size": 1937 }
]
```

#### Example response
```json
{
  "_id": "bsskJkDWwQXHB8ut7vQvmWZ4",
  "properties": [
    {
      "_id": "92eVbRk2xxFun2gXsxXaxWFk"
    },
    {
      "_id": "qXNdbysby2NHcgVDK3rrXUZk",
      "url": "https://entu-files.s3.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk",
      "signedRequest": "https://entu-files.s3-eu-west-1.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk?"
    }
  ]
}
```




### GET /entity/{ \_id }
Get one entity with given id.

#### Query parameters
- **props** - Comma separated list of properties to get. If not set all properties are returned.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```http
GET /entity/59abac1bb5684200016be61e HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{}
```




### POST /entity/{ \_id }
Add new properties to existing entity. Data must be sent as JSON list containing property object(s).

Returns created properties \_ids. If *filename* and *size* is set returns upload *url* and *signedRequest* for file upload.

#### Property object parameters
- **type** - Property type. It's mandatory parameter. Must be alphanumeric. Can contain \_, but not begin with one (except [system properties](#system-properties)).
- [ **string** \| **reference** \| **boolean** \| **integer** \| **decimal** \| **date** \| **datetime** \| **filename** \| **size** ] - Property value

#### Example request
```http
POST /entity/hAazguCezHwDfLe2geyKKpqj HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
Content-Type: application/json; charset=utf-8
Content-Length: 109

[
  { "type": "title", "string": "Hobbit" },
  { "type": "photo", "filename": "cover.jpg" "size": 1937 }
]
```

#### Example response
```json
{
  "_id": "bsskJkDWwQXHB8ut7vQvmWZ4",
  "properties": [
    {
      "_id": "92eVbRk2xxFun2gXsxXaxWFk"
    },
    {
      "_id": "qXNdbysby2NHcgVDK3rrXUZk",
      "url": "https://entu-files.s3.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk",
      "signedRequest": "https://entu-files.s3-eu-west-1.amazonaws.com/entu/qXNdbysby2NHcgVDK3rrXUZk?"
    }
  ]
}
```




### DELETE /entity/{ \_id }
Delete entity with given id.

#### Example request
```http
DELETE /entity/59abac1bb5684200016be61e HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{
  "deleted": true
}
```




## Property

### GET /property/{ \_id }
Get property with given id.

#### Query parameters
- **download** - If set and it's file property, redirects to file url.
- **account** - Account key. Required to get public info without authorization. Optional if Bearer authorization header is set.

#### Example request
```http
GET /property/5b9648dd2e5c91011f9a42b5 HTTP/1.1
Host: api.entu.app
Accept-Encoding: deflate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Example response
```json
{}
```




### DELETE /property/{ \_id }
Delete property with given id.

#### Example request
```http
DELETE /property/5b9648dd2e5c9100459a4157 HTTP/1.1
Host: api.entu.app
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
- **_type** - String containing object's type.
- **_parent** - Reference property to parent object.
- **_public** - If set to *true*, object (only it's public properties) is visible without authentication.

For rights management Entu uses following reference properties:
- **_viewer** - Who can view this object.
- **_expander** - Who can add new objects under this object.
- **_editor** - Who can change this object's properties (except rights!).
- **_owner** - Who can do anything with this object (view, change, delete and manage rights).
