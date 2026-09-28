# Follow along: deleting resources and cleaning objects reliably

Start from the states in the [attachments](09-attachments.md) and [document exports](10-document-exports.md) chapters: start the API, Worker, Web, PostgreSQL and RustFS with `just dev`, sign in and prepare a saved document with an attachment. The development entry applies this chapter's 0011 file-cleanup and 0012 knowledge-base-deletion migrations.

With edit rights, the document detail offers "删除文档" (Delete document) and the attachment list offers "删除附件" (Delete attachment). Owners/Admins can delete a whole base from the knowledge base page. Every action shows a confirmation first; cancelling sends no delete request. There is no recycle bin, and a personal knowledge base is not silently rebuilt by the first-write flow.

Once confirmed, the backend immediately rejects reads and download-link minting under the new visibility and the interface refreshes the affected resources. RustFS's physical removal is done by the real Worker; already-issued short-lived URLs keep the TTL boundary declared in the attachments chapter.

## 1. Visibility, audit and the job commit together

[Attachment deletion](../../crates/app/src/modules/knowledge/attachments.rs) re-checks the current session, document edit rights and the attachment association, then deletes the business association, marks the Core File as deleting, registers the cleanup job and writes the Audit in one transaction. If the audit write fails, the attachment stays visible and no orphan cleanup job is left behind.

[Document and knowledge-base deletion](../../crates/app/src/modules/knowledge/deletion.rs) marks deletion in a short transaction while saving the Audit and the cleanup job together. Reads, lists, search, edits, upload completion and export authorization all exclude deleted resources. Larger bases and documents then register sub-resource cleanup in batches, so an HTTP request never walks every attachment or performs S3 network calls.

Deleting a whole base hides its documents, attachments and exports. The Worker hands the base's documents to document cleanup, which hands objects to Core Files; document bodies are eventually removed from the database. The knowledge base keeps its inaccessible deletion marker — in particular the unique personal-base relationship with its user — so automatic initialization cannot resurrect it. There is no restore path.

Creation idempotency records for documents and bases keep stable IDs and re-read the current resource on replay. Old-format records go through the same check, so a deleted document's cached body or base detail cannot be fetched back with an old create request.

## 2. Every object's location is recorded

[Core Files cleanup](../../crates/app/src/modules/files/cleanup.rs) owns the [object_cleanup table](../../migrations/0011_file_cleanup.sql) and registers locations by their immutable bucket/key. Staged objects, unadopted candidates and the final objects of deleted resources all enter the cleanup records; a currently ready object joins only after deletion.

Each pass registers/reads at most 100 targets. The Worker calls S3 Delete outside the transaction, then commits progress with a valid lease. An object that no longer exists still counts as success; after a partially finished attempt, the next one resumes from where it stopped. Locations are kept forever — a failed task never erases them.

Deletion tasks have a bounded budget of five attempts. Once exhausted, an administrator can investigate and retry under "后台任务" (Background jobs); periodic maintenance never keeps re-issuing budget to the same failed task. Cleanup jobs work from the confirmed deletion state, and a plain logout does not stop them from finishing.

## 3. Why one completed Delete is not the end

A PUT the browser already started, or a storage-side copy, may complete after the client timed out — even after the first cleanup pass. What RustFS currently reports cannot prove that every remote write has a single absolute end; that is why a key is never deleted once and forgotten.

Locations that finished their first deletion re-enter the re-check scope an hour later by default. A shared `files.rescan` job processes at most 100 due locations per pass, keeps the records and updates each next-check time; it is not one job per file per hour. The interval is the earliest possible schedule — actual progress also depends on the backlog.

Locations are never reused for new files: the server generates a distinct UUID key, so a ready object cannot overwrite one. A late legacy task only ever acts on the object it originally registered. The tests really make a staged object reappear after its first cleanup, then verify the re-check removes it; they also verify that legacy tasks and staging recycling leave later uploads' ready attachments untouched.

## 4. Expired data enters cleanup automatically

A [standalone maintenance loop](../../crates/app/src/modules/jobs/maintenance.rs) checks every 30 seconds by default, configured through `JOB_MAINTENANCE_SECS`. Maintenance only does bounded database work and enqueuing; storage I/O still happens inside jobs. It polls independently of the Worker, so one scheduling query waiting never pauses a running handler.

Core maintenance finds expired pending uploads, rejected uploads, unadopted candidates and staging write capabilities past their deadline. Expired/rejected uploads keep an explicit upload_expired / upload_rejected after cleanup, and the client recovers with a fresh upload resource.

[Export maintenance](../../crates/app/src/modules/knowledge/exports/maintenance.rs) clears snapshot bodies when they expire, registers file cleanup for the ZIP and keeps the expired summary. Users see that the result has expired instead of receiving a dangling new link.

`just dev` and `just worker` already assemble these real jobs and maintenance loops. Core Files, the maintenance loop and the Worker stay template capabilities; the document/base cleanup and export expiry rules are registered by the knowledge example.

## 5. Deletion meets in-flight operations

Upload completion re-checks the current document and knowledge base after the object I/O. Delete the document or base mid-copy and the bytes may have copied successfully, but no ready attachment can be published; the candidate location is already recorded and will still be cleaned up.

Exports also check the current source resources and snapshot files. Deleting an attachment inside a snapshot makes a not-yet-executed export fail explicitly — a ZIP missing files is never reported as success. After the source document or base is deleted, an already-generated export cannot mint new download links either.

The attachment API returns `can_upload` and `can_delete` separately: storage being off does not mean losing delete rights, and a new capability after a grant downgrade refreshes the document permissions, updating the delete buttons along the way.

The frontend [DeleteResource](../../packages/views/src/knowledge/delete-resource.tsx) reuses the confirmation and error feedback and calls the generated SDK. Deleting an attachment refreshes only the attachment and preview queries and never resets the Markdown being edited, so an unsaved draft survives; deleting a whole document or base leaves the page and refreshes the resource caches.

## 6. Verification

```bash
node scripts/test-backend.mjs --test deletion --test attachments --test exports
pnpm exec vitest run apps/web/src/deletion.test.tsx
just check
```

The real HTTP/PostgreSQL/RustFS tests cover immediate invisibility, actual object removal, audit rollback, Reader/Editor, wrong associations, personal-base deletion, non-resurrection of old idempotent responses, upload-completion races, export expiry and missing inputs, failure budgets/admin recovery, late-object re-checks and new-resource protection.

View tests verify confirmation and cancellation, read-only permissions, the personal-base hint, and that an unsaved body survives deleting an attachment. After completing the key journey:

```bash
node scripts/e2e.mjs tests/e2e/deletion.spec.ts
```

The browser uploads a real attachment, confirms deletion, verifies the API refuses new links, and waits for the real Worker to make the original object return 404; it then deletes the document and revisits the old address. Day-to-day development keeps using the faster HTTP/View checks instead of repeating the whole browser suite.

## 7. Making it your business

Keep Core Files' cleanup records, Files Handler, Jobs and the standalone maintenance loop. In your own business module implement "confirm permission → mark invisible → register Core file cleanup and Audit in the same transaction", then provide the Handler that removes the business association.

Along the [Worker assembly entry](../../apps/worker/src/main.rs) replace the knowledge base's `document_cleanup_handler`, `base_cleanup_handler` and `export_maintenance` registrations; the file-storage handler and Core maintenance registrations stay. On the frontend, compose the confirmation dialog and the generated SDK mutation inside your own view and maintain that resource's query invalidation rules. Finally update the [ownership manifest](../../examples/knowledge-base/manifest.json) so your business's migrations, HTTP/OpenAPI, Views, jobs and tutorials can be replaced together.
