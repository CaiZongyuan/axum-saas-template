# Append Audit in Your Business Transaction

Goal: commit mutations with successful audit and correlate HTTP/background work. Start with transactional use cases. Audit is durable fact; logs/traces are potentially lossy telemetry.

<!-- example:knowledge:reference-01:start -->

Complete reference: [transactional use cases](04-personal-documents.en.md).

<!-- example:knowledge:reference-01:end -->

## Minimal Public Call

[Audit](../../crates/app/src/modules/audit/mod.rs) exposes `append(connection, Event)`. Put this complete small function in your module. Call it after updating a ticket in the same transaction and before commit; propagate errors to roll the business back:

```rust
use crate::modules::audit;
use sqlx::PgConnection;

pub async fn record_ticket_update(
    connection: &mut PgConnection,
    actor_id: &str,
    ticket_id: &str,
    request_id: &str,
) -> Result<(), sqlx::Error> {
    audit::append(connection, audit::Event {
        actor_id,
        action: "tickets.update",
        resource_type: "tickets.ticket",
        resource_id: ticket_id,
        source: audit::Source::Request(request_id),
        subject_user_id: None,
    }).await
}
```

Your business defines action/resource names. Permission/version rejection cannot emit success Audit. Event has no arbitrary metadata map, only optional `subject_user_id`. Never copy titles, bodies, passwords, secrets, signed URLs or requests.

<!-- example:knowledge:reference-02:start -->

Complete reference: [Knowledge use cases](../../crates/app/src/modules/knowledge/application.rs).

<!-- example:knowledge:reference-02:end -->

## Record the Actual Source

| Source | Usage                                | Durable association                                               |
| ------ | ------------------------------------ | ----------------------------------------------------------------- |
| HTTP   | `Source::Request(request_id)`        | request_id/correlation_id identify the actual request             |
| Worker | `Source::Job { id, correlation_id }` | Actual Job and original business correlation; request_id is empty |

actor_id is the initiating User ID, never the Job ID. With real tracing, current span supplies trace_id; otherwise leave it empty instead of renaming request_id. See the Worker and [telemetry guide](19-observability.en.md).

<!-- example:knowledge:reference-03:start -->

Complete reference: [Worker](../../crates/app/src/modules/knowledge/exports/worker.rs).

<!-- example:knowledge:reference-03:end -->

## Use Protected Queries

`GET /api/v1/audit-events` requires current Owner/Admin and holds the membership shared lock through the query. Exact filters are `action / resource_type / resource_id / actor_id / request_id / correlation_id / job_id`. Defaults are 50, maximum 100, UUIDv7 descending; cursors bind administrator and all filters.

Invalid IDs, long/NUL filters, invalid limits and mixed cursors return common 400. New requests fail after demotion and clients clear old rows. The API contains no business content and does not define perpetual retention; deployment owners choose backup/retention policy.

## Verify and Adapt

Run from the repository root:

```bash
node scripts/test-backend.mjs --test audit
```

<!-- example:knowledge:reference-04:start -->

```bash
node scripts/test-backend.mjs --test audit_knowledge --test exports
```

<!-- example:knowledge:reference-04:end -->

[Core HTTP checks](../../crates/app/tests/audit.rs) cover administrator filters/pagination/demotion. Business checks match response request_id to Audit, reject copied content and force Audit failure to observe rollback. Read your business result and corresponding action instead of only checking that append was called.

<!-- example:knowledge:reference-05:start -->

Complete reference: [Business checks](../../apps/api/tests/audit_knowledge.rs).

<!-- example:knowledge:reference-05:end -->

Choose stable actions/safe identifiers and append in the caller's transaction. Additional metadata needs defined fields, allowlists, migration and contract. Core owns audit/task management; your module owns business events/checks. Continue with [read-only API Keys](15-api-keys.en.md) or [telemetry correlation](19-observability.en.md).
