## General
All API calls return JSON object (except [social auth](#get-authfacebookgooglelivetwitter)).
- Successful request contains *result* with corresponding response.
- On error, *error* object is returned (instead of *result*) with *code* and *message* parameters.

#### Example response
```json
{
    "release": "7eae6de",
    "startDt": "2017-09-12T07:02:21.343Z",
    "ms": 28,
    "auth": true,
    "result": { }
}
```

#### Example error
```json
{
    "release": "c2bece3",
    "startDt": "2017-09-12T15:01:22.376Z",
    "ms": 1,
    "auth": true,
    "error": {
        "code": 500,
        "message": "Argument passed in must be a single String of 12 bytes or a string of 24 hex characters"
    }
}
```




## GET /auth/[facebook|google|live|twitter]
Redirects user to given authentication provider (facebook, google, live or twitter). After successful authentication:
- If query parameter *next* is set, user is redirected to given url. Query parameter *session* is added. Use this parameter to get JWT tokens from [/auth/{sessionId}](#get-authsessionid).
- If next is not set user is redirected to [/auth/{sessionId}](#get-authsessionid).

#### Query parameters
- **next** - url where user is redirected after successful auth.


## GET /auth/{sessionId}
Returns list of JWT tokens for accessing databases where user exists. Use this token (in Bearer authorization header) for all other requests.

#### Example request
```shell
curl \
    -X GET
    "https://api.entu.ee/auth/session/59abac1bb5684200016be4b8"
```




## GET /entity
Get list of entities. To filter entities by property value. Use dot separated list of *property key*, *data type* and *operator* as query parameter(s). Operator is optional, but must be one of following:
- **gt** - matches values that are greater than a specified value.
- **gte** - Matches values that are greater than or equal to a specified value.
- **lt** - Matches values that are less than a specified value.
- **lte** - Matches values that are less than or equal to a specified value.
- **ne** - Matches all values that are not equal to a specified value.
- **regex** - Provides regular expression capabilities for pattern matching strings in queries.
- **exists** - Value must be true or false. When value is true, returns entities that contain the property, including entities where the property value is *null*. If value is false, the query returns only the entities that do not contain the property.

#### Query (other) parameters
- **props** - comma separated list of properties to get. If not set all properties are returned.
- **sort** - comma separated list of properties to use for sorting. Use - (minus) sign before property name for descending sort. If not set sorts by \_id.
- **limit** - how many entities to return.
- **skip** - how many entities to skip in result.

#### Example request
```shell
curl \
    -X GET \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQ1NiIsInR5iOjE11NiIsInR5" \
    "https://api.entu.ee/entity?forename.string=John&file.size.gte=1024&surname.string.regex=/^Apple/i&photo._id.exists=false&sort=-file.size&limit=12"
```




## GET /entity/{_id}
Get one entity with given id.

#### Query parameters
- **props** - comma separated list of properties to get. If not set all properties are returned.

#### Example request
```shell
curl \
    -X GET \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQ1NiIsInR5iOjE11NiIsInR5" \
    "https://api.entu.ee/entity/59abac1bb5684200016be61e"
```


## DELETE /entity/{_id}
Delete entity with given id.

#### Example request
```shell
curl \
    -X DELETE \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQ1NiIsInR5iOjE11NiIsInR5" \
    "https://api.entu.ee/entity/59abac1bb5684200016be61e"
```




## GET /property/{_id}
Get property with given id.

#### Query parameters
- **download** - If set and it's file property, redirects to file url.

#### Example request
```shell
curl \
    -X GET \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQ1NiIsInR5iOjE11NiIsInR5" \
    "https://api.entu.ee/property/59abac1bb5684200016be445?download"
```


## DELETE /property/{_id}
Delete property with given id.

#### Example request
```shell
curl \
    -X DELETE \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQ1NiIsInR5iOjE11NiIsInR5" \
    "https://api.entu.ee/entity/59abac1bb5684200016be445"
```
