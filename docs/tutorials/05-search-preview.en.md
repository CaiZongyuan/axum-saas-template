# Query Filters and Pagination Contracts

Goal: add bounded filters and stable pagination to your list API without exposing inaccessible resources. Start with [persistent business data](04-personal-documents.en.md) and a resource policy. Knowledge search is the reference implementation; Markdown preview is optional client functionality.

## From Protocol to Query

[DocumentsQuery](../../crates/app/src/modules/knowledge/mod.rs) defines `knowledge_base_id / q / limit / cursor`. Omitting the base ID selects only the personal base. `q` is trimmed, limited to 200 characters and rejects NUL; `limit` defaults to 50 with a maximum of 100. Lists return summaries and `next_cursor / has_more`, not bodies or whole-table totals.

This is the key shape of the [actual query](../../crates/app/src/modules/knowledge/application.rs); complete SQL also includes current authorization, deletion state and base scope:

```sql
AND ($3::timestamptz IS NULL OR (d.created_at, d.id) < ($3::timestamptz, $4::uuid))
AND d.title ILIKE $6
ORDER BY d.created_at DESC, d.id DESC
LIMIT $5
```

Escape LIKE `%`, `_` and backslash before binding the parameter. Thus `100%_` is a literal substring, not user-controlled wildcards. Authorization, filters and pagination belong in the database query; clients never receive private titles to filter themselves.

## A Cursor Is a Position

[Cursor](../../crates/app/src/modules/knowledge/pagination.rs) binds actor, base scope, ordering, normalized keyword digest and final position. Changing actor/scope/keyword restarts pagination. Every page reauthorizes; a cursor is neither a credential nor a cross-page database snapshot.

Fetch one extra row to determine the next page and keep lists bounded. Client Query keys include the same identity/scope/filter; the reference View retains at most ten pages. Invalid or mixed cursors return structured 400, never an unfiltered whole-table query.

## Verify Backend Results

Run from the repository root:

```bash
node scripts/test-backend.mjs --test knowledge
```

[HTTP checks](../../apps/api/tests/knowledge.rs) cover literal `%/_` search, ordering, identity isolation, bound filters and denied pagination after revocation. Your list should cover two pages without duplication, rejected old cursors after filter changes, absent inaccessible titles, maximum limit and invalid input.

## Optional Markdown Client

For preview use the [safe rendering reference](../../packages/views/src/knowledge/markdown-content.tsx): `react-markdown / remark-gfm / rehype-sanitize`, no raw HTML and preserved URL protocol filtering. The server does not fetch external links and external images do not load automatically. Attachments use [authorized references](09-attachments.en.md), never stored signed URLs.

Load preview on demand, separate drafts from saved resources and preserve input when rejecting over-budget preview/submission. Rendering does not replace backend authorization. Your search rules may differ, but change DTO, SQL, cursor and checks together. Continue with [versioned updates](06-edit-conflicts.en.md).
