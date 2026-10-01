# Models, Business Transactions and Idempotency

Goal: implement “validate → authorize → save → audit → commit” in your module and protect user retries. Start with a [business Router](../guides/develop-module.en.md) and [Sessions](03-sessions.en.md). Knowledge is the complete reference here; its tables and rules belong to the reference business.

## Locate Responsibilities

| Responsibility | Knowledge reference                                                     | What your business defines                      |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Data ownership | [Business migration](../../migrations/0003_knowledge.sql)               | Your schema, tables, constraints and indexes    |
| Pure rules     | [domain.rs](../../crates/app/src/modules/knowledge/domain.rs)           | Normalization and business limits               |
| Use cases      | [application.rs](../../crates/app/src/modules/knowledge/application.rs) | Authorization, SQL, transactions and Core calls |
| Protocol       | [mod.rs](../../crates/app/src/modules/knowledge/mod.rs)                 | Requests/responses, Handlers, Router/OpenAPI    |

Reference limits are 1–200 title characters and at most 1 MiB UTF-8 Markdown, rejecting NUL. They are not universal SaaS entity limits. `BoundedJson<T>` handles HTTP JSON and reading budgets; your Domain still validates fields.

## Commit One Save

Knowledge creation locks current Membership and authorizes the locked target knowledge base. Personal initialization grants Editor only when actually creating the base, never restoring access to an existing revoked base. Base, Grant, Document, Audit and idempotency records commit together; PostgreSQL stores the body.

Your use case similarly owns the transaction from `pool.begin()` and passes the same connection to Core. Do not independently commit audit/jobs or perform object-storage network I/O inside this transaction.

## Integrate Public Idempotency

[Core Idempotency](../../crates/app/src/modules/idempotency/mod.rs) exposes:

```rust
pub fn fingerprint(payload: &impl Serialize) -> Result<Vec<u8>, Error>;
pub async fn claim(connection: &mut PgConnection, attempt: &Attempt<'_>)
    -> Result<Option<Value>, Error>;
pub async fn complete(connection: &mut PgConnection, attempt: &Attempt<'_>, response: Value)
    -> Result<(), Error>;
```

These are signature excerpts; `create` in `application.rs` is the complete call site. `Attempt` has `actor_id / scope / key / fingerprint`. Reauthorize first, fingerprint normalized input and claim: `Some` replays; `None` performs the mutation, Audit and complete before commit. Include operation and resource ID in scope so different targets cannot share commands.

Keys are 1–128 bytes of printable non-space ASCII. Changing payload for the same actor/scope/key returns Conflict. Records default to 24 hours, after which keys can be reused. Store stable IDs and reread current resource visibility during replay; do not return cached bodies after deletion or persist short-lived signed URLs.

## Verify and Recover

Run from the repository root; the runner creates isolated real dependencies:

```bash
node scripts/test-backend.mjs --test knowledge
```

[Public HTTP checks](../../apps/api/tests/knowledge.rs) create/read a document, verify one write per key, changed-input 409, access isolation, concurrent initialization and complete Audit rollback. Cover equivalent creation/read, retry and rollback paths in your API.

When responses are lost, preserve input/key for an explicit user retry; changed input gets a new key. The SDK does not automatically retry POST. Versioned updates are separate: continue with [concurrent changes](06-edit-conflicts.en.md) and [filters/pagination](05-search-preview.en.md) for reads.
