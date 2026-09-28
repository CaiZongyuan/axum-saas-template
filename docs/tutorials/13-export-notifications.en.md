# Follow along: export result notifications and read state

Continuing from [document exports](10-document-exports.md): run `just dev`, sign in, save a Markdown document and request an export. Once the Worker finishes, open "Notifications" from the home page and see "Document export completed" plus the unread count. Clicking "View result" marks the notification read and opens that export's details, where the ZIP can be downloaded; going back to the notifications and refreshing, the read state persists.

If the job fails for good, you see "Document export failed". A transient failure entering its retry wait raises no notification; only after [job recovery](11-job-recovery.md) exhausts the budget or hits a permanent error does one arrive. The details query the current result, so if an administrator later recovers the task, the original failure notice still leads you to the latest successful state.

## 1. Register the intent first, publish the result later

The [export request](../../crates/app/src/modules/knowledge/exports/requests.rs) saves the snapshot, enqueues the job, calls Core `notifications::on_job_outcome`, then writes the audit entry and the idempotent response — all in the same PostgreSQL transaction. The registration records:

- the recipient: the user who requested the export;
- the event key: `knowledge.export:<export_id>`;
- a generic description: "文档导出" (document export). Private document titles, bodies or signed links are never copied here;
- the navigation target: type `knowledge.export`, the export ID, and the document ID in the context.

The intent is stored in Core's `job_notifications` and does not appear in the notification list yet. When the transaction rolls back, the job, snapshot, intent and audit entry are withdrawn together. Core does not read knowledge tables; even if the documents and export records are cleaned up later, the intent still allows the final failure notification to reach the original requester.

## 2. The result and the notification commit together

[Core Jobs](../../crates/app/src/modules/jobs/mod.rs) calls Notifications at three terminal points: a success committed under a valid lease, a failure reaching its terminal state, and a claim discovering that the previous execution crashed with its budget exhausted.

When a ZIP is published successfully, the file state, the export result, the audit entry, the job's terminal state and the in-app notification share one database transaction. If the notification insert fails, none of the other database outcomes may turn successful on their own; objects already uploaded but unadopted remain managed by the [cleanup mechanism](12-deletion-cleanup.md). Failure notifications commit together with the job/history state too, and never depend on a handler staying alive long enough to reach an error branch.

Jobs that registered no notification intent produce no notifications — background file cleanup, for example. In-app notifications here are only a database operation; the later mail chapter is where external delivery appears.

## 3. Why retries do not re-notify

The [notifications migration](../../migrations/0013_notifications.sql) keeps logical messages unique with `(recipient_id, event_key, outcome)`. Repeated executions meeting the same success or failure event keep the original message, including its ID, creation time and read time.

One export that fails first and succeeds after an explicit administrator retry can hold one failure notification and one success notification. Repeated failures do not pile up alerts, and repeated successes do not turn unread again. A new export request owns a new export ID and therefore produces an independent event.

## 4. The inbox belongs to the current user only

The [Core inbox](../../crates/app/src/modules/notifications/inbox.rs) provides the two interfaces from the generated contract:

- `GET /api/v1/notifications`: read newest first; 50 per page by default, 100 at most, with `unread_only=true` and the returned cursor to continue. The cursor binds to the current user and filter, and the unread total with that page share one database snapshot.
- `POST /api/v1/notifications/{id}/read`: requires the current session, Origin and CSRF; repeated calls keep the first `read_at`.

Queries and updates both address the current user as the recipient; even an administrator cannot read or modify someone else's inbox. Responses contain no job payloads, credentials or download capabilities. Reading a notification never grants access to its target resource.

The [shared NotificationsView](../../packages/views/src/notifications/notifications-view.tsx) calls the generated SDK and renders loading, empty lists, unread counts, failures, retries and paging; the page text, error messages and dates all come from the Core bilingual catalog and follow the interface language (UI09). Clicking "Refresh notifications" returns to the newest page; page state and the Query cache are isolated per identity.

## 5. Display and target resolution belong to the example

Both the display and the navigation target are owned by the knowledge example; Core only consumes the registered interface from the assembly point (docs/ui/design.md §4.1). The [example contribution](../../packages/views/src/knowledge/app-example.tsx) registers two things:

- `describeNotification` derives a title key at render time from the structured data (target type `knowledge.export` plus the outcome); the Core inbox localizes history records into "Document export completed/failed" accordingly — without matching the stored Chinese subject and without rewriting history. Switch the interface to English and the same existing notice immediately shows an English title.
- `resolveNotificationTarget` recognizes `knowledge.export`, checks the document/export IDs and hands the navigation callback to the Core view; clicking "View result" still goes through real authorization.

Unregistered or removed types keep the generic display — the original subject plus the outcome word — with only mark-as-read and the "the feature behind this notification is currently unavailable" feedback, never a jump to a page that does not exist; unknown extension subjects render as-is, safely.

The [export details view](../../packages/views/src/knowledge/export-detail-view.tsx) re-requests that export, and the backend checks the current session, result ownership and source-document read permission. After the source document is deleted or access revoked, the generic notification can still be read, but the result and new download links are out of reach. Expired results cannot be downloaded; already-issued links keep the TTL boundaries agreed in the attachments and exports chapters.

This is why removing the knowledge example from the template keeps the notification list, the read-state capability and the generic fallback display. The example manifest registers the export details view, the target-resolution and display mapping, the business tests and this chapter; the Core notifications migration, API, view and general HTTP tests remain.

## 6. Verification

```bash
node scripts/test-backend.mjs --test notifications --test exports
pnpm exec vitest run apps/web/src/notifications.test.tsx apps/web/src/export-notifications.test.tsx
just check
```

The HTTP/public-job tests verify recipient isolation, administrators cannot overreach, CSRF, persistent read state, cursor limits, failure budgets, invalidated leases, retry deduplication and the atomic rollback of notification faults with results. The real-RustFS export tests cover success/failure notifications, denial after the source resources are deleted, and publishing exactly one result after recovery.

The View tests reuse the existing interfaces: operating the request, states, mark-as-read and opening the target. `export-notifications.test.tsx` switches the same existing notice to English and verifies the structured display follows the interface language; the unknown-type case verifies the generic fallback and safe display. The design-system showroom demos the export states and the notification display contract in isolation on demo data.

After the whole key journey passes, run once:

```bash
node scripts/e2e.mjs tests/e2e/exports.spec.ts
```

The real browser registers, writes, uploads an attachment, exports and verifies the ZIP bytes, then opens the real notifications, enters the details and refreshes to confirm the read state. Regular development keeps using the faster interface and View tests.

## 7. Swap in your own business

In your business request transaction, call `jobs::enqueue` first, then register a stable business event key and recipient with `notifications::on_job_outcome`. Use a generic description and carry only business identifiers in the target; never copy anything that must not be displayed forever into the inbox.

In the Worker, keep the existing lease locking and the `Lease::succeed` transaction boundary; Core publishes the result notifications automatically, including terminal failures and crash-exhausted budgets. Finally, register your own `describeNotification` display mapping and `resolveNotificationTarget` resolution callback, the details page and its authorization API in the example contribution, and record the replaceable resources in the [ownership manifest](../../examples/knowledge-base/manifest.json). Notifications never needs to learn about your business tables.
