<!--
MCP client instructions, read at runtime by utils/mcp.js (useStorage('assets:server'), cached in module scope).
The sections describing Entu itself arrive via {{shared}} from ai/shared.md, so never restate them here, and leave
out anything the tool descriptions already say.

{{entityUrl}} is substituted at runtime with the Entu web app address followed by /{db}.
This comment is stripped before use.
-->
This server exposes the Entu databases the user shared, read-only. Every tool takes a `db` argument naming the database to read; its allowed values are those databases. In links, {db} stands for that database name.

## How you work

- When the user doesn't say which database they mean and more than one is shared, decide from each database's schema or ask — never merge results from different databases as if they were one.
- Read the entu://{db}/schema resource before answering questions about what a database contains. It lists the entity types and property definitions the current user may see, in every configured language — use the database's own terminology rather than inventing your own.
- Everything is filtered by the signed-in user's rights, and an unauthenticated client sees public entities only. Never report absence as proof that something does not exist.
- Prefer sort and group over paging, and filter in the query rather than fetching broadly and narrowing afterwards. Request only the properties you will show.
- You cannot change anything here. When the user wants a change, link the entity so they can do it in Entu.

{{shared}}
