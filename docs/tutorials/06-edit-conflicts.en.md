# Versioned Updates and Conflict Recovery

Goal: prevent silent overwrites of mutable resources and return a stable conflict code clients can recover from. Complete [business transactions](04-personal-documents.en.md) and [resource authorization](07-library-grants.en.md). Idempotent creation does not replace concurrency control.

## Put Expected Version in the Protocol

Knowledge's [update DTO and Handler](../../crates/app/src/modules/knowledge/mod.rs) accept `PUT /api/v1/knowledge/documents/{id}` with `title / markdown / version`. Version must be positive; Session, Origin and CSRF remain required.

The [use case](../../crates/app/src/modules/knowledge/application.rs) holds current Membership and base locks and checks access before a conditional update. Actual SQL excerpt:

```sql
UPDATE knowledge.documents
SET title = $1, markdown = $2, version = version + 1,
    updated_by = $3::uuid, updated_at = clock_timestamp()
WHERE id = $4::uuid AND knowledge_base_id = $5::uuid
  AND version = $6 AND deleted_at IS NULL
```

The full implementation returns the document and appends Audit. Two writers using the same expected version cannot both succeed. Do not SELECT a version in the Handler and then UPDATE unconditionally. Inaccessible resources return 404; Reader writes return 403; an authorized stale save returns `409 document.version_conflict`.

## Commit and Unknown Results

Body, version and Audit commit together. Audit failure rolls version back, permitting the original version after recovery. A response timeout may happen after commit. Do not blindly retry: read current version, compare content and choose the next action explicitly.

Your resource owns its version field, conditional update and conflict error; Core does not implement optimistic concurrency for every business. If commands also support idempotency, explain replay and expected-version semantics separately.

## Verify Two Writers

Run from the repository root:

```bash
node scripts/test-backend.mjs --test knowledge
```

[HTTP checks](../../apps/api/tests/knowledge.rs) coordinate two requests with real PostgreSQL locks, observe one success and one 409, then read the resulting body. They also cover denial and body/version rollback on Audit failure. Use equivalent public checks for your resource and assert stable codes rather than translated messages.

## Client Recovery

The [editor View](../../packages/views/src/knowledge/documents-view.tsx) separates draft/base version from server Query data. Background refresh cannot replace drafts or advance the base version. After 409, preserve input, fetch latest data and require explicit merge/keep or discard; neither choice automatically saves.

After 403/404, disable further saves and query current permission while preserving unsaved text. Previously displayed content cannot be remotely erased; later requests enforce current access. Continue with [resource authorization](07-library-grants.en.md), [membership locks](08-members.en.md) and the same commit discipline for [file publication](09-attachments.en.md).
