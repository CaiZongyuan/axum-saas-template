# Walkthrough: Tracing business operations through the audit trail

Start the app with `just dev` and sign in as an Owner or Admin. Create or edit a document, open "Audit trail" from the "Administration" group in the left navigation, type the ID from the document address into "Resource ID", type `knowledge.document.create` or `knowledge.document.update` into "Action", and click "Filter records". The page shows the actor, resource type, resource ID, request ID and correlation ID; you can load further records or refresh to the newest page. Filter conditions are written into the URL and survive a language or theme switch when you re-enter the page. The interface follows the "Appearance & language" setting; the page and its operations read Audit trail, Action, Resource ID, Filter records and Refresh audit.

Document bodies, document titles and attachment contents never appear in the audit trail. An administrator can find the write response's `x-request-id` in the browser network panel, enter it under "Request ID" for an exact match, and search the API's structured logs with the same value. Trace propagation arrives with the later observability chapter; without a real trace ID the field keeps its empty value.

A plain member has no global access when opening `/audit` or calling the audit API directly. An administrator degraded while the page is open receives the denial again on the next filter, pagination or refresh, and the old rows disappear.

## 1. Business and success audit commit together

[Core Audit](../../crates/app/src/modules/audit/mod.rs) exposes `Event` and `Source`; business modules pass an explicit action, resource type, resource ID and actor, then call `audit::append` inside their own transaction.

[Document creation and editing](../../crates/app/src/modules/knowledge/application.rs), [library grants](../../crates/app/src/modules/knowledge/grants.rs) and member management all follow the same pattern: verify current permissions, run the mutation, append the success audit, then commit. If the audit database operation fails, the business mutation never commits alone. Writes rejected by permissions, version conflicts or other rules must not leave a success audit behind either.

This is not serializing a whole request body into a log field. `Event` takes no arbitrary JSON or body input; metadata currently allows only `subject_user_id`, marking the user affected by a shared-resource operation. For example, a grant's resource is the library grant itself, the resource ID is the library ID, and the affected user is the member granted or revoked. The initial grant of a default personal library also records its target user.

Registration, member changes, library create/rename/delete, document changes, attachment completion/deletion, export request/completion and administrator job retries are all wired through the public audit capability. Registration passwords, sessions, signed links and business content never reach the audit.

## 2. HTTP and background jobs carry different sources

Ordinary HTTP writes use `Source::Request`: `request_id` and `correlation_id` both refer to this real request, and the user identity is stored in `actor_id`.

The [export worker](../../crates/app/src/modules/knowledge/exports/worker.rs) uses `Source::Job`: `job_id` is the job ID from the actual lease, `correlation_id` keeps the original export request's ID, and `request_id` is empty. The actor remains the user who requested the export — the job ID is never dressed up as a user ID, and the original request is never disguised as a fresh HTTP request from the worker.

You can first locate the export request and completion record by correlation ID, then query the concrete background operation by job ID and open "Background jobs" from the "Administration" group for batches, retries and error history. Until real tracing lands, `trace_id` stays empty; request_id is never renamed into a trace ID.

[Migration 0014](../../migrations/0014_audit_context.sql) completed derivable resource types and request correlations for historical records while preserving the original facts; old records without a reliable job/trace identity stay empty rather than being backfilled by guesswork.

## 3. Protected queries and pagination

`GET /api/v1/audit-events` first validates the current session, then locks and checks the effective Owner/Admin role through the organization's public capability. The role share lock is held until the query finishes, giving confirmed queries a defined ordering against concurrent degradations.

Exact filters are supported for `action / resource_type / resource_id / actor_id / request_id / correlation_id / job_id`. The default is 50 records, at most 100, newest first by audit UUIDv7; the API returns only the current page and the next cursor, never the whole table.

A cursor is bound to the current administrator and the full filter set — a cursor from another user or another filter set cannot slip into the current request. Invalid UUIDs, out-of-range limits, overlong values or filters containing NUL all return one uniform 400 error. The commonly filtered resource, action, actor and correlation fields have matching indexes.

[AuditView](../../packages/views/src/audit/audit-view.tsx) queries through the generated SDK and provides loading, empty results, error retries and pagination. Filters apply once the form is submitted and are written into the URL; refiltering or refreshing starts from the newest page again. When fetching fails or the permission is gone, stale cached rows are no longer shown.

## 4. Verify the real results

```bash
node scripts/test-backend.mjs --test audit --test audit_knowledge --test exports
pnpm exec vitest run apps/web/src/audit.test.tsx
just check
```

Core HTTP tests verify real registration audits, member denials, administrator filtering and pagination, and degraded-role rejections. Knowledge-base HTTP tests verify that document/grant responses carry matching request IDs, that metadata never copies content, and that an audit failure rolls back the document write and leaves no queryable success record; the real worker test cross-checks the export completion record against the job query result.

View tests operate the filter form, load further pages and simulate permission loss; after the full key journey run once:

```bash
node scripts/e2e.mjs tests/e2e/audit.spec.ts
```

The real browser creates a document, obtains actual resource and request IDs, then queries the matching record in the audit page; day-to-day development keeps using the faster HTTP/view checks.

## 5. Model your own business on this

Choose stable action names and resource types for your mutations and call `audit::append` in the same transaction. Foreground requests pass `Source::Request`, background completions pass a real `Source::Job`; avoid querying business tables inside Core or guessing resources by business name.

Record only the identifiers troubleshooting needs. When metadata must grow, define explicit, safe fields first and adjust the migration allowlist and the contract together; never open up the whole request, the body or an arbitrary metadata map.

The audit API, the shared view, Core migrations and the registration/member tests are not part of the knowledge-base example. This chapter, the knowledge-base business tests and the browser journey are registered in the [example ownership manifest](../../examples/knowledge-base/manifest.json); adjust them together when replacing the business, and the Core audit entry points keep working.
