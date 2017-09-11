# Entu API

## Authentication

### GET /auth/[facebook|google|live|twitter]
*Start user authentication*

| parameter | | |
| -- | -- | -- |
| next | optional | Url where user is redirected after successful auth.

If parameter *next* is set, user is redirected to this url with added parameter *session*. Parameter *session* contains session ID. Use /auth/{session ID} to get JWT tokens for other requests.

If next is not set user is redirected to /auth/{session ID}


### GET /auth/{session ID}
*Get JWT token after authentication*

Returns list of JWT tokens. Tokens are customer specific. Use this token in Bearer authorization header for all other requests.





## Entities

### GET /entity
*Get list of entities*

| parameter | | |
| -- | -- | -- |
| props | optional | Comma separated list of properties to get. If not set all properties are returned. |
| sort | optional | Comma separated list of properties to use for sorting. Use - (minus) sign before property name for descending sort. If not set sorts by _id. |
| limit | optional | How many entities to return. |
| skip | optional | How many entities to skip in result. |

### GET /entity/{_id}
*Get one entity*

| parameter | | |
| -- | -- | -- |
| props | optional | Comma separated list of properties to get. If not set all properties are returned. |

### DELETE /entity/{_id}
*Delete entity*





## Properties

### GET /property/{_id}
*Get property*

### DELETE /property/{_id}
*Delete property*
