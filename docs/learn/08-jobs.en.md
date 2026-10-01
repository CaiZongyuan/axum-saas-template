# 08 Generate ticket JSON snapshots with Worker and notifications

Starting state: the same Ticket and ready attachment. Advance to `jobs`, freeze ticket/attachment metadata at request time and generate JSON up to 64 KiB in the background. It contains no attachment bytes and is neither a ZIP nor a full backup.

## Install the task checkpoint

Stop course development, run from the original root and restart the copy:

```bash
node scripts/tutorial-course.mjs --stage jobs --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

The copy adds `crates/app/src/modules/tickets/exports.rs`, export records/migrations and OpenAPI, then explicitly registers the Handler and business-expiry maintenance in `apps/worker/src/main.rs`. Keep `.course.env`, Cookies, CSRF and ticket id in the request terminal.

## Save snapshot, Job and notification intent atomically

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: ticket-export-1" -H "Content-Type: application/json" \
  --data '{}' "$BASE_URL/api/v1/tickets/$TICKET_ID/exports" \
  > .scratch/course-http/export.json
export EXPORT_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/export.json','utf8')).id")
```

Expect 202 with id/job_id/status/expires_at. Work may start quickly; acceptance is not proof that a file exists.

The request transaction includes authorization, snapshot, `jobs::enqueue`, `notifications::on_job_outcome`, Audit and replay:

<<< ../../examples/tutorial-tickets/exports.rs#enqueue-export

Job payload stores only export_id. The owned export table holds the snapshot and initiating Session identifier, not Session secrets or signed URLs. Notifications remain intents until success/final failure; retry_wait produces no inbox entry. The current public notification contract supports one recipient per Job.

## Execution and publication are separate boundaries

<<< ../../examples/tutorial-tickets/exports.rs#export-handler

The Handler validates kind/schema_version/payload, computes real JSON size and SHA-256 within bounded generation, and uses Files::prepare_generated/write_generated for an immutable candidate. Reject outputs above 64 KiB instead of trusting client-declared size/hash.

Publication holds the current Lease and rechecks the original Session, active Membership, ticket access and file identity before committing export, Files, Audit, Job succeed and terminal notification:

<<< ../../examples/tutorial-tickets/exports.rs#export-publication

Returning `Ok(())` does not automatically succeed. A stale Worker cannot overwrite a new lease's result. Transient failure can retry within budget; permanent authorization failure publishes nothing. A new Session cannot replace an expired/revoked initiating Session to revive queued work.

## Wait for terminal state and read real output

Export public variables in the request terminal, then poll with a deadline:

```bash
export BASE_URL TICKET_ID EXPORT_ID
node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const endpoint = `${process.env.BASE_URL}/api/v1/tickets/${process.env.TICKET_ID}/exports/${process.env.EXPORT_ID}`;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  const response = spawnSync('curl', [
    '--fail-with-body', '-sS', '-b', '.scratch/course-http/cookies', endpoint,
  ], { encoding: 'utf8', timeout: 5000 });
  if (response.status !== 0) throw new Error('Export status request failed');
  const result = JSON.parse(response.stdout);
  if (result.status === 'succeeded') {
    console.log('Export succeeded');
    process.exit(0);
  }
  if (['failed', 'expired'].includes(result.status))
    throw new Error('Export reached an unavailable terminal state');
  await setTimeout(1000);
}
throw new Error('Export did not finish before the deadline');
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/exports/$EXPORT_ID/download" \
  > .scratch/course-http/export-download.json
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/export-download.json', 'utf8'));
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error('Export download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 64 * 1024) throw new Error('Export exceeds its budget');
const snapshot = JSON.parse(bytes.toString('utf8'));
if (snapshot.ticket.id !== process.env.TICKET_ID || !Array.isArray(snapshot.attachments))
  throw new Error('Export snapshot differs from the requested business');
writeFileSync('.scratch/course-http/ticket-export.json', bytes);
console.log('Ticket snapshot verified');
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/notifications"
```

Expect request-time ticket and attachments metadata. Later ticket edits do not alter the snapshot. Core notification carries the terminal outcome, correlated through its target resource id and task record. Subject uses generic text without exposing ticket content.

## Check denial and business retention

Lesson 04's other Member must get 404 for export download:

```bash
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/exports/$EXPORT_ID/download"
```

Business retention is one hour. After expiry, deny new download signing and run owned Maintenance to schedule Files cleanup and release snapshot/file references. Core ready-file expires_at does not implement business reclamation automatically. Initiator invalidation, lost leases and notification failures are exercised by [course integration checks](../../crates/app/tests/tutorial_course.rs).

Previous: [Attachment publication](07-files.md). Next: [Public checks and generated SDK](09-verification.md).
