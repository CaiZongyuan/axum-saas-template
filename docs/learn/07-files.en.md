# 07 Add ticket uploads, verification and downloads

Starting state: lesson 06's protected Ticket, Session, `TICKET_ID` and version. Advance to `files` and add ticket/file associations. RustFS holds bytes while the ticket business owns resource authorization.

## Install the file checkpoint

Stop the copy's development processes, run from the original root and restart the copy:

```bash
node scripts/tutorial-course.mjs --stage files --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

The copy adds `crates/app/src/modules/tickets/attachments.rs`, attachment relationship migrations/ownership and Router/OpenAPI wiring. Settings constructs FileService for the ticket Router without sending S3 secrets to clients. Keep using `source .course.env`, course Cookies and CSRF in the request terminal.

## Create an upload with a real digest

At the copy root create small text and its UploadInput:

```bash
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const bytes = Buffer.from('Ticket attachment\n');
writeFileSync('.scratch/course-http/attachment.txt', bytes);
writeFileSync('.scratch/course-http/upload-input.json', JSON.stringify({
  file_name: 'attachment.txt',
  content_type: 'text/plain',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: ticket-attachment" -H "Content-Type: application/json" \
  --data-binary @.scratch/course-http/upload-input.json \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/uploads" \
  > .scratch/course-http/upload.json
```

Expect 201 with upload_id, state and an optional upload capability. A fresh pending capability includes url/method/headers/expires_at. Replay preserves upload identity; after completion upload may be null, so do not PUT again.

Tickets authorizes before using Files::start and recording association/replay in its transaction:

<<< ../../examples/tutorial-tickets/attachments.rs#upload-register

## Transfer bytes, then complete explicitly

Use every signed header without printing the full URL:

```bash
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/upload.json', 'utf8')).upload;
if (!capability) throw new Error('Upload is already complete; skip the staging transfer');
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
  body: readFileSync('.scratch/course-http/attachment.txt'),
});
if (!response.ok) throw new Error('Staging upload failed');
NODE
export UPLOAD_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/upload.json','utf8')).upload_id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -X POST "$BASE_URL/api/v1/tickets/$TICKET_ID/uploads/$UPLOAD_ID/complete" \
  > .scratch/course-http/file.json
export FILE_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/file.json','utf8')).id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments"
```

Completion returns 200/FileInfo and the list contains `FILE_ID`. A successful PUT alone does not publish a pending upload to the business list.

Completion plans a candidate in a short transaction, verifies/copies outside the transaction, then rechecks Session, active Membership and ticket access in a new transaction before publishing Files and the business association:

<<< ../../examples/tutorial-tickets/attachments.rs#file-completion

PostgreSQL rollback cannot undo object I/O. Failed candidates require cleanup registration; only a published association counts as an attachment.

## Verify bytes and denial

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments/$FILE_ID/download" \
  > .scratch/course-http/download.json
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/download.json', 'utf8'));
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error('Attachment download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== capability.file.size ||
    createHash('sha256').update(bytes).digest('hex') !== capability.file.sha256)
  throw new Error('Attachment bytes differ from published metadata');
console.log('Attachment bytes verified');
NODE
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments/$FILE_ID/download"
```

Authorized download returns a 200 capability and real bytes match published metadata. Lesson 04's other Member gets 404. Short-lived URLs are bearer capabilities, excluded from commits/logs; each new download request reauthorizes.

Complete source is [attachments.rs](../../examples/tutorial-tickets/attachments.rs) and the [Files public interface](../../crates/app/src/modules/files/mod.rs). Missing objects, digest mismatch or Session invalidation during verification must not publish. Recover through valid upload state or a new upload.

Previous: [Retries and versions](06-retries-versions.md). Next: [Generate a JSON snapshot in the background](08-jobs.md).
