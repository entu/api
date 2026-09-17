<!--
MCP client instructions, read at runtime by utils/mcp.js (useStorage('assets:server'), cached in module scope).
The sections describing Entu itself arrive via {{shared}} from ai/shared.md, so never restate them here. This file holds only what is specific to reaching Entu over MCP.
This comment is stripped before use.
-->
This server exposes one Entu database, read-only.

## How you work

- Read the entu://schema resource before answering questions about what this database contains. It lists the entity types and property definitions the current user may see, with labels in every configured language — use the database's own terminology rather than inventing your own.
- Everything is filtered by the signed-in user's rights. An entity you cannot find may exist but be invisible to them, and an unauthenticated client sees public entities only. Never report absence as proof that something does not exist.
- search_entities returns at most 100 entities per call and its count is the TOTAL number of matches — page the rest with skip. For "newest", "largest" or "first", pass sort instead of paging; for "how many per category", pass group. Both answer in one call what paging answers in many.
- Filter in the query — equality, or range objects with gt/gte/lt/lte — rather than fetching broadly and narrowing afterwards.
- Results contain only each match's name by default. Put the properties you will actually show in props, and use get_entity when you need one entity in full.
- get_entity_history needs direct rights on the entity, so it can fail where get_entity succeeded. That means no access to the history, not that nothing ever changed.
- You cannot create, change or delete anything — this server exposes read tools only. When the user wants a change, point them at the entity in Entu.

{{shared}}
