# Register Result Notifications in Business Transactions

Goal: connect terminal notifications and Core inbox to your background business. Enqueue with [Jobs](10-document-exports.en.md) and publish results in valid lease transactions first. Intent registration and visible messages are different stages.

## Register Public Notification Intent

[Notifications](../../crates/app/src/modules/notifications/mod.rs) exposes `on_job_outcome(connection, job_id, JobNotification)`. This complete small function belongs in your module. The caller has authorized and owns the business/enqueue transaction, passing its Job and result IDs:

```rust
use crate::modules::notifications::{self, JobNotification, NotificationTarget};
use sqlx::PgConnection;

pub async fn register_result_notice(
    connection: &mut PgConnection,
    job_id: &str,
    actor_id: &str,
    result_id: &str,
) -> Result<(), sqlx::Error> {
    let event_key = format!("tickets.export:{result_id}");
    notifications::on_job_outcome(connection, job_id, JobNotification {
        recipient_id: actor_id,
        event_key: &event_key,
        subject: "Ticket export",
        target: NotificationTarget {
            kind: "tickets.export".into(),
            resource_id: result_id.into(),
            context: Default::default(),
        },
    }).await
}
```

`tickets.export` is your event name, not a registered Core type. Commit registration with snapshot, Job, Audit and idempotency; inbox remains invisible at this point. Each Job currently has one recipient; event key/subject allow 1–200 characters and target JSON at most 4096 bytes.

<!-- example:knowledge:reference-01:start -->

Complete reference: [Knowledge requests](../../crates/app/src/modules/knowledge/exports/requests.rs).

<!-- example:knowledge:reference-01:end -->

Use generic subjects because they remain visible after revocation. Targets contain business identifiers, never private titles, bodies, credentials or download URLs. A target is a navigation hint, not authorization.

## Commit Terminal Messages with Results

Core publishes within `Lease::succeed`, terminal fail or crash-budget exhaustion transactions. retry_wait does not notify. Result, file, Audit, Job/history and notification commit together. Notification failure rolls database publication back; unadopted remote objects follow [cleanup rules](12-deletion-cleanup.en.md).

`publish_job_outcome` is `pub(crate)` and your Handler cannot call it directly. Returning Ok cannot replace `Lease::succeed`. Jobs without intent produce no messages.

The [unique constraint](../../migrations/0013_notifications.sql) is `(recipient_id, event_key, outcome)`. Repeated success/failure preserves ID/read_at. A failure followed by administrator retry success can produce one of each; retry neither duplicates reminders nor resets read state.

## Inbox and Business Targets

`GET /api/v1/notifications` defaults to 50, maximum 100, supports `unread_only` and identity/filter-bound cursors. Count/page share a snapshot. `POST /api/v1/notifications/{id}/read` requires Session, Origin and CSRF; repeated marking preserves the first timestamp. Administrators cannot read others' inboxes.

Your detail API reauthorizes. After source deletion/revocation, generic notifications remain readable while results are denied. Optional clients register `describeNotification / resolveNotificationTarget` in an example contribution. Unknown/removed types retain generic display and marking without navigation to missing pages.

<!-- example:knowledge:reference-02:start -->

Complete reference: [example contribution](../../packages/views/src/knowledge/app-example.tsx).

<!-- example:knowledge:reference-02:end -->

## Verify

Run from the repository root:

```bash
node scripts/test-backend.mjs --test notifications
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test exports
```

<!-- example:knowledge:reference-03:end -->

[Core checks](../../crates/app/tests/notifications.rs) cover recipient isolation, CSRF, terminal visibility, persistent read state and retry deduplication. Publication checks prove notification failure rolls results back. Check intent invisibility, drive real Worker, query inbox/result and reject a revoked target in your business. Continue with [Audit](14-audit-history.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [Publication checks](../../apps/api/tests/exports.rs).

<!-- example:knowledge:reference-04:end -->
