# Follow along: export documents with background jobs

Sign in, open a saved document and click "Export this document" under "Document exports". The page immediately shows "Queued", and once the Worker finishes, "Download ZIP" appears. Records are listed newest first; a new request returns to the first page with its progress, and the record survives a page refresh. A Reader can also export documents they are allowed to read. The ZIP contains `document.md` and an attachments directory, suitable for taking a single document offline.

This path splits a time-consuming action away from the HTTP request: the API persists the user's request, and the Worker completes it. Jobs live in PostgreSQL, so stopping the Worker never strands pending records in memory; this chapter needs no RabbitMQ.

## 1. Start it and actually use it

```bash
just dev
```

The development entry now starts PostgreSQL/RustFS, runs migrations and storage initialization, then starts the API, the Worker and the Web app. Rust source changes restart the API and the Worker; the web app uses HMR. The Worker's default health port is `127.0.0.1:3001`.

Create a Markdown document, upload a text attachment, then request an export. Download the ZIP and confirm both the body and the attachment are inside. To observe the waiting state you can start a Worker on its own with the command below; with only the API/Web running, requests still enqueue.

```bash
just worker
```

`just worker` loads the same `.env.example` / `.env` plus the process environment and starts one real Worker. Do not let it fight `just dev`'s Worker for the default health port; give the second process its own `WORKER_BIND`.

The Worker's `/health/live` says the process is alive; `/health/ready` also checks that the loop has started and the full migration history is present. `Ctrl+C` first stops claiming jobs, then gives the current job a bounded finish window; the database and object-storage volumes remain.

## 2. Persist a snapshot at request time

The [export API](../../crates/app/src/modules/knowledge/exports/mod.rs) verifies read access to the current document and saves, in one transaction:

- the export ID and requester;
- the document version, title, Markdown and the ready attachment list;
- stable references to the original credentials;
- the PostgreSQL job and the audit entry.

The job payload only carries `export_id`; it never copies bodies or storage URLs. The original session ID is used for re-verification later; passwords, the cookie secret and hashes never enter the job payload.

An Idempotency-Key identifies one export request. Retrying with the same key after a lost response returns the same export; editing the document meanwhile does not rewrite that snapshot. The next deliberate click after a successful request creates a new request, used to export a newer version. If the audit or another database write fails, the export, snapshot, job and idempotency record roll back together.

## 3. Core jobs and the knowledge-base handler

[Core Jobs](../../crates/app/src/modules/jobs/mod.rs) claim work with short `FOR UPDATE SKIP LOCKED` transactions, updating attempt count, executor, lease token and deadline before committing. The following network I/O and ZIP generation never hold the claim transaction.

The [Worker](../../crates/app/src/modules/jobs/worker.rs) only claims registered job types and advances its own lease renewal while processing. While a renewal waits on a row lock the business keeps running; a failed renewal first cancels the handler and releases its transaction, then records the failure, so the worker never waits on a lock it holds itself. A completion commit must still match the token and hold an unexpired lease. The knowledge-base [handler](../../crates/app/src/modules/knowledge/exports/worker.rs) owns its snapshot, permissions and business outcome; Core never queries knowledge tables.

The Worker re-checks the requester and the original credentials, the source document and its attachments when processing starts, when the candidate is created and at final publication. Signing out of the requesting session, deactivating the member, revoking a grant or losing an input after the request all prevent a downloadable success. A completed export stays accessible under current permissions even after the user signs in with a new session.

The base queue already separates transient from permanent errors, with budgeted backoff and reclaiming of expired leases. Continue with [job recovery and administrator retries](11-job-recovery.md) to verify crashes, stale executors, attempt history and admin retries.

## 4. Bounded memory and a safe ZIP

The [ZIP implementation](../../crates/app/src/modules/knowledge/exports/archive.rs) never keeps the whole ZIP or all attachments in memory:

1. It streams one S3 object sequentially into a `0700` temporary directory, counting and verifying SHA-256 as it goes;
2. a blocking thread writes the ZIP in chunks from the temporary input file, bounding the actual output length including ZIP headers and the central directory;
3. after the ZIP writer is closed, the final file is re-read to compute its checksum;
4. the file is uploaded with a conditional PUT over a file byte stream.

The ZIP's Stored mode does not compress, which keeps the design easy to follow and bounds CPU cost. Internal paths are `document.md` and `attachments/<File ID>.<safe extension>`; user file names never become directory paths and same-named attachments never collide.

Markdown is parsed first, and only `attachment:<UUID>` references that belong to the snapshot are rewritten inside Link/Image nodes to relative ZIP paths; the same string inside code or plain text stays text. When attachment references exist, re-serialization may normalize whitespace, escapes and reference-style links; the export guarantees the snapshot's semantics, not every formatting byte of the original Markdown. Unknown attachment references keep their original target — other files are never pulled in, and external URLs are never fetched.

At most one export per process holds the packaging resources. A total deadline covers download, ZIP and publication; blocking code checks cancellation per chunk. Once `spawn_blocking` has started it cannot be force-aborted, so the thread holds the temporary directory and the concurrency permit until it actually exits. Ordinary success/failure cleans up local files; SIGKILL or a filesystem failure may leave a temporary directory behind, and Drop must not be treated as a crash-cleanup guarantee. The temporary disk takes no part in backups; a failed job can be rebuilt from the database snapshot.

For the primary sources and exact crate versions see the [streaming research](../research/document-export-streaming.md) note.

## 5. Object writes and the database publication

Before the generated ZIP is written to RustFS, it is registered through [Core Files](../../crates/app/src/modules/files/mod.rs), which creates the File and a unique candidate location. The S3 conditional PUT uses `If-None-Match: *`, so an existing candidate can never be overwritten; after upload, the object's size, type and upload id are verified.

Finally the request is re-authorized and the lease validated, and one transaction adopts the ready file, links the export, writes the audit entry and marks the job succeeded. A timeout does not prove the remote write failed; unadopted candidates and pending files keep durable metadata that the later object-cleanup chapter reclaims.

Exports and snapshots are kept for 24 hours by default; expired queries show expired and no new links are issued. Downloads are restricted to the requester or an administrator, and both the current visitor and the original requester must still be able to read the source document. Existing short-lived links keep the TTL boundaries declared in the attachments tutorial; an export never becomes a permanently public URL. Physical deletion and expired-object cleanup are implemented in the deletion chapter.

## 6. Configuration and verification

The actual configuration comes from the [generated configuration reference](site:reference/config.md):

| Setting                               | Default   | Purpose                                 |
| ------------------------------------- | --------- | --------------------------------------- |
| `EXPORT_MAX_ATTACHMENTS`              | 100       | Caps the number of entries              |
| `EXPORT_MAX_INPUT_BYTES`              | 256 MiB   | Body plus attachments total             |
| `EXPORT_MAX_OUTPUT_BYTES`             | 272 MiB   | ZIP cap including directory and headers |
| `EXPORT_TIMEOUT_SECS`                 | 120 s     | Total budget for one execution          |
| `EXPORT_RETENTION_SECS`               | 24 h      | Export and snapshot lifetime            |
| `JOB_LEASE_SECS / JOB_HEARTBEAT_SECS` | 60 / 20 s | Job lease and renewals                  |
| `JOB_SHUTDOWN_SECS`                   | 10 s      | Worker shutdown wait                    |

Peak temporary disk usage is roughly input plus output caps, about 528 MiB per active export by default. Running out of disk fails that attempt; these caps are separate from the ordinary 20 MiB per-file attachment limit.

```bash
node scripts/test-backend.mjs --test exports --test jobs
node scripts/test-storage.mjs generated_files
pnpm exec vitest run apps/web/src/exports.test.tsx
just check
```

The HTTP/public-job tests verify publication across lease renewals, transaction release after a renewal timeout, visibility of new jobs beyond one page of history, idempotent snapshots, real ZIP/attachment bytes, session invalidation, audit rollback, permissions and expiry, missing objects and size limits. The storage adapter tests verify multi-part uploads and conditional writes; the View tests verify progress, request retry, failure, expiry and a denied download.

The request button, status badges (queued/running/retry_wait/succeeded/failed/expired), failure notes and expiry lines on the page all come from the shared bilingual catalog ([export-feedback](../../packages/views/src/knowledge/export-feedback.tsx)) and render fully in either interface language; the idempotency, permission, attachment-packaging and link-expiry semantics are unchanged. The design-system showroom demos these states in isolation on demo data (UI09); the inbox side continues in [export result notifications](13-export-notifications.md).

After this key journey passes, accept it in a real browser:

```bash
node scripts/e2e.mjs tests/e2e/exports.spec.ts
```

The browser uploads an attachment and requests an export, a real Worker produces the ZIP, an independent JS ZIP library unpacks and verifies body and attachment bytes, and a final refresh confirms the result can be visited again. Day-to-day development keeps using the fast HTTP/View feedback.

When you build your own business, mirror "enqueue in the business transaction → register a handler → commit the result within a valid lease"; do not copy the queue implementation. The [example ownership manifest](../../examples/knowledge-base/manifest.json) records the knowledge-base handlers, views, migrations, tests, configuration and tutorials; Core Jobs, Files, the Worker and the S3 adapters remain.
