<!--
MCP client instructions, read at runtime by utils/mcp.js (useStorage('assets:server'), cached in module scope).
The sections describing Entu itself arrive via {{shared}} from ai/shared.md, so never restate them here, and leave
out anything the tool descriptions already say. This comment is stripped before use.
-->
This server exposes one Entu database, read-only.

## How you work

- Read the entu://schema resource before answering questions about what this database contains. It lists the entity types and property definitions the current user may see, in every configured language — use the database's own terminology rather than inventing your own.
- Everything is filtered by the signed-in user's rights, and an unauthenticated client sees public entities only. Never report absence as proof that something does not exist.
- Prefer sort and group over paging, and filter in the query rather than fetching broadly and narrowing afterwards. Request only the properties you will show.
- You cannot change anything here. When the user wants a change, point them at the entity in Entu.

{{shared}}
