# Business Deletion and Object Cleanup

Goal: stop authorizing access immediately after deletion, then reclaim bytes through durable work. Integrate [Files](09-attachments.en.md) and [Jobs](10-document-exports.en.md) first. Deletion changes persistent data; the Knowledge reference has no recycle bin.

## Commit Invisibility First

Knowledge deletion marks documents/bases deleted, appends Audit and enqueues cleanup in short transactions. Attachment deletion commits association removal, mark_deleting and Audit together. Audit failure leaves resources visible without orphan cleanup work.

<!-- example:knowledge:reference-01:start -->

Complete reference: [Knowledge deletion](../../crates/app/src/modules/knowledge/deletion.rs); [Attachment deletion](../../crates/app/src/modules/knowledge/attachments.rs).

<!-- example:knowledge:reference-01:end -->

Your reads/searches/updates/upload completion/export must check deleted state. Business Handlers clean large association sets in batches instead of traversing every file or calling S3 in HTTP. Personal bases retain tombstones/unique ownership so initialization cannot resurrect them. Creation replay rereads current visibility.

## Register Cleanup through Files

[Files cleanup](../../crates/app/src/modules/files/cleanup.rs) exposes:

```rust
pub async fn mark_deleting(
    connection: &mut PgConnection,
    id: &str,
    correlation_id: &str,
) -> Result<(), Error>;
```

This signature excerpt uses Files `Error`. Call it in your authorized deletion transaction. Core records immutable bucket/key cleanup positions and Jobs; your Handler need not reimplement an S3 deletion queue. Business association, file state, work and Audit commit together.

The [Worker entry](../../apps/worker/src/main.rs) registers `files::cleanup_handler`, `files::rescan_handler` and `files::cleanup_maintenance`. Register your association/expiry maintenance separately. `jobs::run_maintenance` runs independently with bounded database/enqueue work, without storage I/O or blocked renewal.

## Bound Work and Retain Positions

Each batch handles at most 100 targets. S3 Delete happens outside transactions, then valid leases commit progress; absent objects count as success. Recover from remaining positions after partial success. Five attempts require explicit administrator retry when exhausted; maintenance does not continually replenish budgets. Cleanup follows committed deletion regardless of logout.

Late PUT/COPY may finish after initial deletion, so positions remain recorded. Rescan defaults to one hour later, with shared `files.rescan` handling at most 100 due positions per batch. The interval is earliest scheduling, not guaranteed completion time. UUID keys are never reused and old cleanup cannot delete new ready files.

Core reclaims expired pending/rejected uploads, staging and unadopted candidates. Retention alone does not delete current ready artifacts. Your business must deny expired downloads, clear snapshots/references and call mark_deleting. See export maintenance.

<!-- example:knowledge:reference-02:start -->

Complete reference: [export maintenance](../../crates/app/src/modules/knowledge/exports/maintenance.rs).

<!-- example:knowledge:reference-02:end -->

## In-Flight Work and Verification

Upload/export publication rechecks resources after I/O; successful copying cannot resurrect deleted business data. Deleting an input attachment fails pending export rather than publishing missing bytes. New links stop immediately; old signed URLs retain their [TTL boundary](09-attachments.en.md).

Run from the repository root:

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test deletion --test attachments --test exports
```

<!-- example:knowledge:reference-03:end -->

Real HTTP/Worker checks cover immediate invisibility, RustFS deletion, Audit rollback, resurrection prevention, copy races, expiry and late-object rescan. Add association/query checks for your business while retaining Core cleanup. Continue with [notifications](13-export-notifications.en.md) and [audit](14-audit-history.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [Real HTTP/Worker checks](../../apps/api/tests/deletion.rs).

<!-- example:knowledge:reference-04:end -->
