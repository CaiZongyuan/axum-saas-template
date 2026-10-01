# Integrate Files with Your Business

Goal: add private attachments using Core file lifecycle and the S3 adapter. Start API/PostgreSQL/RustFS through the [quickstart](../getting-started/quickstart.en.md) and define resource authorization. Your business owns resource/file associations; Files does not know document or ticket permissions.

<!-- example:knowledge:reference-01:start -->

Complete reference: [resource authorization](07-library-grants.en.md).

<!-- example:knowledge:reference-01:end -->

## Construction and Public Interfaces

[Files types/service](../../crates/app/src/modules/files/mod.rs) expose `FileService::from_settings(storage, limits)`; use `FileService::new(storage, bucket, policy)` for another adapter. `UploadInput` has `file_name / content_type / size / sha256`. Validate normalizes MIME/digest and checks budgets; start validates again.

| Stage           | Public method                            | Result                               |
| --------------- | ---------------------------------------- | ------------------------------------ |
| Register        | `start(connection, actor_id, input)`     | Upload with public `id`              |
| Replay          | `load(connection, id)`                   | Original Upload                      |
| Sign upload     | `upload_capability(upload)`              | URL, method, headers, expires_at     |
| Plan completion | `plan_completion(connection, id)`        | Ready / Attempt / Expired / Rejected |
| Verify          | `verify_candidate(attempt)`              | VerifiedCandidate                    |
| Abandon         | `abandon(connection, attempt, rejected)` | Candidate can be reclaimed           |
| Publish         | `publish(connection, verified)`          | Adopted / Existing / Expired         |
| Download        | `download(connection, id, inline)`       | DownloadCapability                   |

These are call shapes; source contains complete signatures/types. `CompletionAttempt / VerifiedCandidate` have private fields and must come from the service, never be constructed to bypass verification.

<!-- example:knowledge:reference-02:start -->

Complete reference: [Knowledge attachments](../../crates/app/src/modules/knowledge/attachments.rs).

<!-- example:knowledge:reference-02:end -->

## Complete Commit Boundaries

1. Short transaction A: validate Session, lock current Membership/resource and authorize; claim the idempotent command, start and insert association, complete with upload_id only, commit. Replay checks association and loads the Upload. Sign outside the transaction; do not persist short-lived URLs.
2. The client PUTs staging with returned method/headers. Upload success is still invisible in business attachment lists.
3. Short transaction B: reauthorize, verify association, plan_completion and commit the candidate record. Ready replay also checks published business association; Expired/Rejected are explicit failures.
4. Outside transactions, verify_candidate performs HEAD, source-ETag conditional COPY to a unique candidate and HEAD/full-byte/size/MIME/SHA-256 checks. Candidates cannot be overwritten; images/PDF also undergo signature checks.
5. Short transaction C: revalidate current credential, membership, resource/access/association and expiry; publish, publish business association, append Audit and commit. Abandon failed candidates while retaining durable cleanup records.

Reauthorize after external I/O; initial access does not guarantee publication access. Concurrent completion adopts one ready object and returns the same attachment to others. Audit failure rolls state/association back for recoverable completion. Timeout does not prove the remote write failed; record candidates before I/O.

## Downloads and Configuration

Defaults are 20 MiB per file, 900 seconds upload and 60 seconds download; actual values come from the [configuration reference](site:reference/config.md). Check association/current resource access before signing a ready file. `ready_info(connection, ids)` reads already-authorized IDs in bulk without doing business authorization.

Revocation/deletion stops new links; issued URLs may work until expiry and accepted transfers may continue. Store file IDs, not signed URLs. S3 credentials stay in API/Worker and Cookies never go to S3. Separate `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT`; sign the public origin rather than rewriting hostname/path afterward.

## Verify and Recover

Run from the repository root:

```bash
just bootstrap-storage
node scripts/test-storage.mjs
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test attachments
```

<!-- example:knowledge:reference-03:end -->

Real HTTP/storage checks cover staging invisibility, unique publication, size/type rejection, Audit rollback, associations and rejection after revocation/Session expiry/resource deletion during copying. Expired/rejected uploads need new resources; transient failures retry the original resource. Preserve these boundaries and register association migrations, Router, tests and ownership. Continue with [generated files and Jobs](10-document-exports.en.md) and [object cleanup](12-deletion-cleanup.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [Real HTTP/storage checks](../../apps/api/tests/attachments.rs).

<!-- example:knowledge:reference-04:end -->
