# Follow along: uploading attachments, referencing images and downloading

`just dev` now starts PostgreSQL and RustFS, runs database migrations, and initializes browser CORS for a dedicated private bucket. The first run pulls pinned image versions; the API/Web keep the original development feedback loop.

Save a document, pick a file under "附件" (Attachments) and click "上传附件" (Upload attachment). The page shows preparing, upload progress and verification states; the attachment enters the list only after verification passes. Each row carries a file-type icon: the image and document icons come from a vendored Material Symbols subset (with its license file, removed together with the knowledge example), while general action icons remain Lucide. Clicking download returns the original bytes; images can be referenced from the edit page via "插入引用" (Insert reference), viewed by switching to the preview, then saved explicitly. The design system's "场景" (Scenes) tab includes "附件图标与上传状态" (Attachment icons and upload states), which demos these file icons and the upload lifecycle feedback offline on demo data without creating real files.

The defaults are a 20 MiB per-file limit, a 15-minute upload session and 60-second download links. The actual values come from the [generated configuration reference](site:reference/config.md); changing the frontend hint alone does nothing.

## 1. The browser receives a limited capability

The [web file adapter](../../apps/web/src/knowledge-files.ts) reads the File, computes SHA-256, reports XHR upload progress and performs the actual download. The app's cookies are used only for its own API and are omitted for S3 transfers. A single byte transfer gets at most 120 seconds (including reading the response body); after a timeout the retry action recovers, and leaving the page cancels the transfer.

An upload request sends the file name, MIME type, size and checksum. The server verifies document edit rights, generates a staging key, records the upload and its business association, and returns the URL, method, required headers and deadline. The frontend cannot choose the bucket or key and never sees the storage admin credentials. The original file name is a display value only; it is never used as an object path.

The [ObjectStorage adapter](../../crates/platform/src/object_storage.rs) uses the standard S3 API with pinned RustFS 1.0.0 and AWS SDK 1.149.0. Internal operation endpoints and the public signing endpoint are separate: requests are signed against the public address, and the hostname or path is never rewritten afterwards. Signatures bind the content type, checksum header and upload identity; Content-Encoding is fixed to identity so downloads never change the bytes through content decoding. The browser-controlled Content-Length is not part of the returned headers.

The dedicated bucket is private by default. Initialization creates it only when HEAD confirms a 404, never treating 403 as absence; the idempotent initialization uses bounded standard retries that cover the observed concurrent CreateBucket `503 SlowDown`. Conditional copies keep a single attempt; timeouts are handled through candidate records.

## 2. Uploaded to storage does not mean published

[Core Files](../../crates/app/src/modules/files/mod.rs) owns file state and candidate object records; the [knowledge attachment use case](../../crates/app/src/modules/knowledge/attachments.rs) owns the document association and base-level authorization. Core never reads the Document or Grant tables.

Completion runs in three phases:

1. A short transaction re-verifies document edit rights, registers the unique candidate key first, then commits.
2. Outside the transaction, the staged object's ETag is read and conditionally copied to the exclusive candidate key; the candidate's actual length, MIME/upload identity, full bytes and SHA-256 are then checked.
3. The current credentials, document existence, Grant, upload state and deadline are verified again; then the single ready object is selected atomically, the attachment associated and the Audit written.

The candidate copy conditions on both the source ETag and `If-None-Match: *` on the target. After publication nothing writes to that key again; an old upload URL only ever acts on the staged object. When two completion requests race, one candidate wins and the other requests resolve to the same attachment.

Images and PDFs get an extra file-identity check; other types are verified on download against the declared MIME and the full bytes. This template does no general document parsing or malware scanning, and uploaded HTML is never executed as a trusted application page.

## 3. Retries and failures

Creating an upload resource uses an Idempotency-Key and records a stable upload_id. Short-lived URLs are regenerated on each re-authorization, with deadlines inside the upload session. Network failures can retry the same resource; an expired or rejected upload says so explicitly and restarts from a new resource.

Size/type mismatches never publish; revocation, an expired auth session or a vanished source document also block the final commit. When the audit write fails, the ready state and the attachment association roll back together, and completion can be retried afterwards.

Every candidate has a durable record before any I/O. A copy timeout may already have succeeded remotely; failed candidates and their staging locations are never forgotten, and the later cleanup chapter handles expired, rejected and deleted objects. A single Delete or SDK timeout is never proof that "no late object can appear".

## 4. Short-lived downloads and Markdown references

Only ready attachments still associated with a visible document can mint new download links. Readers can download, Editors can upload; after revocation no new links can be requested, but already-issued links may stay valid until they expire, and transfers already accepted may finish. That is the explicit permission boundary of this direct-download model.

Downloads default to attachment disposition, no-store and safe file-name encoding. The web adapter verifies the length and saves the payload as a binary file; the temporary Blob URL is released afterwards.

Markdown stores `attachment:<attachment ID>` — never a presigned URL or a permanent public address. The [Markdown attachment renderer](../../packages/views/src/knowledge/attachment-markdown.tsx) validates the reference format, then requests an access capability from the API for the current document and member. Only common bitmaps that pass the checks render inline; other attachments get a download action, and arbitrary remote images still never load automatically.

## 5. From the local configuration to your deployment

The local `.env.example` ships development-only RustFS credentials. The key settings are:

- `S3_ENDPOINT`: the internal S3 root used by the API/Worker; when unset the file capability turns off while text and auth keep working.
- `S3_PUBLIC_ENDPOINT`: the separate S3 origin the browser can reach; production uses HTTPS and does not mount it under a path-rewriting subdirectory.
- `S3_BUCKET / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY`: the dedicated bucket and explicit server-side credentials.
- `FILE_MAX_BYTES / UPLOAD_SESSION_SECS / DOWNLOAD_URL_SECS`: the actual upload and signing boundaries.

```bash
just bootstrap-storage
```

The initialization command loads `.env.example` / `.env` and the process environment like `just dev`, and configures the dedicated bucket's CORS through the application settings. The RustFS data and log named volumes must be writable by UID/GID 10001; `/health/ready` decides readiness. `Ctrl+C` stops the API/Web and keeps the data volumes.

## 6. Verifying the same path

```bash
node scripts/test-storage.mjs
node scripts/test-backend.mjs --test attachments
pnpm exec vitest run apps/web/src/attachments.test.tsx
just check
```

The storage tests connect to a real RustFS and cover deadlines and signing headers, bad checksums, byte reads, source/target copy conditions and concurrent initialization. The HTTP tests connect to a real database and storage and cover staging invisibility, unique publication, replay, deadlines, size/type, audit rollback, Reader/Editor, cross-document references, plus revocation/session-expiry/source-disappearance during the copy.

View tests drive the real page with WebCrypto and an HTTP boundary: upload progress, resource reuse after failure, the size limit, read-only access, reference insertion and safe image URLs, and every attachment row carrying a file-type icon with an accessible name. The design-system test walks the "附件图标与上传状态" (Attachment icons and upload states) scene: the icon gallery and the uploading, done and failed states on demo data. After finishing a key journey, run once:

```bash
node scripts/e2e.mjs tests/e2e/attachments.spec.ts
```

The browser uploads a real image, compares bytes after download, then saves an attachment reference and reloads the preview. The default feedback loop does not re-run the browser journey.

The [ownership manifest](../../examples/knowledge-base/manifest.json) ties attachment associations, business routes, Views, web wiring and the tutorials to the knowledge example; Core Files, the S3 adapter, the general configuration and the isolated test runners stay behind for your own business.
