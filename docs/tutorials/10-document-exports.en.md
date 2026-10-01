# Business Snapshots, Jobs and Generated Files

Goal: move expensive work from HTTP to Worker and publish results reliably. Integrate authorization, [Files](09-attachments.en.md) and transactions first. Knowledge export is a complete real ZIP implementation; your business owns snapshots, Handler and artifact lifetime.

<!-- example:knowledge:reference-01:start -->

Complete reference: [authorization](07-library-grants.en.md); [transactions](04-personal-documents.en.md).

<!-- example:knowledge:reference-01:end -->

## Freeze Facts in the Request Transaction

The Knowledge request use case reauthorizes, verifies the initiating Session, saves request-time title/body/version and ready attachment identities, enqueues, registers notification intent, appends Audit and completes idempotency in one transaction. Later edits do not change this snapshot.

<!-- example:knowledge:reference-02:start -->

Complete reference: [Knowledge request use case](../../crates/app/src/modules/knowledge/exports/requests.rs).

<!-- example:knowledge:reference-02:end -->

[Jobs](../../crates/app/src/modules/jobs/mod.rs) public interface excerpt:

```rust
pub async fn enqueue(connection: &mut PgConnection, job: NewJob<'_>)
    -> Result<String, sqlx::Error>;
```

`NewJob` has `kind / schema_version / max_attempts / payload / correlation_id`. Payload contains a business record ID, not bodies, Cookies, signed URLs or secrets. Rollback makes the Job invisible. Your business chooses a finite attempt budget; the database allows 1–20.

Capture the current valid Session ID reference with `identity::background_credential(connection, auth, headers, user_id)`. `CredentialRef::Session { id }` is not secret/hash and API Key background credentials are unsupported. Call `credential_is_current` during execution and publication to check revocation/expiration without renewal. Logging out the original Session fails old work; logging in again does not restore eligibility.

## Implement and Register a Handler

The [public Handler contract](../../crates/app/src/modules/jobs/worker.rs) is:

```rust
#[async_trait::async_trait]
pub trait Handler: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn run(&self, lease: &Lease) -> Result<(), JobError>;
}
```

Validate kind/schema/payload, load your snapshot and current identity/access, then perform bounded generation outside transactions. Register `Arc<dyn Handler>` at the [Worker assembly point](../../apps/worker/src/main.rs), keeping kinds unique. Worker claims registered types only. `Worker::new(pool, handlers, policy)` is public and `run_once` suits controlled checks; true means work was executed, not that the business succeeded.

Returning Ok from `run` does not automatically succeed the Job. The final short transaction first holds the fence with `lease.lock_current(&mut tx)`, rechecks business conditions, publishes files/results, appends Audit, calls `lease.succeed(&mut tx)` and commits. Job, attempt/batch, result and notification commit together; stale Workers cannot publish.

## Generate Downloadable Files with Files

Use [Files](../../crates/app/src/modules/files/mod.rs) in this order:

1. `snapshots(connection, ids)` gets immutable ready identities already authorized by your business. Missing inputs fail; never accept arbitrary FileSnapshot from HTTP.
2. Generate in a private temporary directory with bounded entries, input/output bytes, time and concurrency. Close output and compute actual size/SHA-256.
3. A short transaction calls `prepare_generated(connection, actor_id, input, max_bytes, retention_secs)` and commits the unique candidate.
4. Outside transactions, `write_generated(attempt, path)` conditionally uploads immutable bytes, verifies size/MIME/upload-id and returns VerifiedCandidate.
5. In the fenced publication transaction above, call `publish` and associate the business result.

`write_generated` trusts the server's real digest rather than repeating client-upload full READ/signature checks. The caller must finish and freeze the file. Use streaming `download_snapshot` with verification when including attachment bytes; attachment metadata JSON is not an offline ZIP.

## Bounded Work and Expiration

Complete generation/publication and ZIP packaging use temporary files, chunked input and conditional PUT. Knowledge defaults to 100 attachments, 256 MiB input, 272 MiB output, 120 seconds total and one packager per process. Values come from [generated configuration](site:reference/config.md), not universal Core business limits.

<!-- example:knowledge:reference-03:start -->

Complete reference: [generation/publication](../../crates/app/src/modules/knowledge/exports/worker.rs); [ZIP packaging](../../crates/app/src/modules/knowledge/exports/archive.rs).

<!-- example:knowledge:reference-03:end -->

ZIP paths use controlled IDs instead of user filenames as directories. Only snapshot Markdown attachment links are rewritten; external links are not fetched. Started blocking packaging cannot be forcibly aborted; its thread retains directory/permit until it exits. SIGKILL can leave temporary directories.

Knowledge results expire after 24 hours by default, stop signing and use business maintenance to clear snapshots/mark files deleting. Files retention alone does not remove current ready artifacts; implement your own expiry rules. Result access rechecks visitor, requester and source access; issued URLs retain the [download TTL boundary](09-attachments.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [business maintenance](../../crates/app/src/modules/knowledge/exports/maintenance.rs).

<!-- example:knowledge:reference-04:end -->

## Verify and Continue

Run from the repository root:

```bash
node scripts/test-backend.mjs --test jobs
node scripts/test-storage.mjs generated_files
```

<!-- example:knowledge:reference-05:start -->

```bash
node scripts/test-backend.mjs --test exports
```

<!-- example:knowledge:reference-05:end -->

Public HTTP/Worker checks cover request snapshots, real ZIP bytes, revoked credentials, stale leases, Audit/notification rollback, expiry and input budgets. Your Handler should verify request transaction, execution, result reading and rejection of one late old executor. Continue with [recovery/budgets](11-job-recovery.en.md), [cleanup](12-deletion-cleanup.en.md) and [notification intent](13-export-notifications.en.md).

<!-- example:knowledge:reference-06:start -->

Complete reference: [Public HTTP/Worker checks](../../apps/api/tests/exports.rs).

<!-- example:knowledge:reference-06:end -->
