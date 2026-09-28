# Boundaries between Core and the reference example

Core provides identity, sessions, membership, audit, idempotency, files, jobs, notifications, mail, API keys and general HTTP capabilities. The reference example plugs its own business in through the application entry; Core never depends back on it.

- **platform** owns configuration, connection pools, migration running, the optional Redis text cache and logging initialization, and depends on neither the application nor the knowledge-base type.
- **app**'s modules each own their use cases and tables; a pure `domain.rs` depends on neither HTTP nor the database.
- **API entry** assembles the Router/OpenAPI in `apps/api/src/lib.rs`; the generic builder accepts extra routes and contracts.
- **contracts / sdk** are generated from OpenAPI; the SDK's types use contracts.
- **core** holds platform-agnostic client helpers.
- **ui / views** provide generic React DOM components and shareable pages respectively.
- **Web entry** owns browser and Router wiring; shared views navigate through callbacks.

The [example ownership manifest](../../examples/knowledge-base/manifest.json) records business directories, migrations, tests, tutorials and the explicit assembly blocks. Register new features there as you add them; the removal tooling later operates on exactly what is registered, and Core's capabilities are never deleted along with a reference example.

```bash
pnpm boundaries:check
```

The current check verifies package import directions, direct references from Core to reference types, infrastructure imports inside pure domains, the SQL tables each module declares ownership of, and the assembly manifest. Every Rust module's `module.json` is the entry point for table ownership; modules cooperate only through public interfaces — for example, Audit appends records inside the caller's transaction.

The SQL check works from strings in the source and the registered table names; it cannot prove everything about dynamic SQL, quoted identifiers or symbol aliases — those still need review. Rust visibility plus real HTTP/database tests complete the verification. Actual example-removal acceptance is exercised by the removal tooling's corresponding task.

When you bring your own business, use the public identity, files and jobs capabilities; never make Core depend on the example through private tables or reverse imports. For the decisions behind this, see [the executable-removable-reference ADR](../adr/0002-executable-removable-reference.md).

Notifications owns job notification intents and the inbox; business code registers intents in the request transaction through public interfaces, and Jobs publishes notifications in the terminal-state transaction. Navigation targets are resolved by the app shell; Core views open them through callbacks; the target API always re-authorizes. Unknown targets never affect reading or marking as read.

API Keys manages generic credentials and their scopes. The application entry registers the scopes each module actually provides; business handlers obtain the current user through the public authentication capability, then perform their own resource authorization. Core's `profile:read` and key management survive example removal; one-time secrets never enter replays, queries or the mutation cache.

CoreOptions passes scope registration and the shared cache at the application assembly point. The cache only handles budgeted Redis I/O and in-process metering; Knowledge owns its own database authorization, body versions and keys; Core never stores or reuses business permission decisions.

RateLimit classifies requests in Core, maintains the bounded local fallback and the fixed policy metering; the Platform WindowCounter performs the limited Redis atomic operations. Cache and counters share a private transport implementation, each holding its own capacity and timeout budgets; business modules never send arbitrary Redis commands directly.

Identity owns reset validity, hashing, the short-lived cipher table and the mail handler; Mail provides bounded encryption/decryption and delivery capability, and Platform wraps SMTP. Jobs stores only the reset ID and owns leases and retries. Core's password-reset page, tutorial and browser tests are independent of knowledge-base ownership and survive example removal.

Platform Telemetry wraps the optional OTel exporter, W3C propagation, bounded metering and the lossy JSON log sink. Application uses tracing with public scopes; HTTP records the actor at authentication success points, Jobs saves observation metadata in the same transaction, the Worker starts a new attempt span from the persisted parent, and Audit records the currently valid trace ID. The domain never depends on OTel, and business payloads never carry runtime context.

`just dev-observability` starts the generic Collector/Prometheus/Loki/Tempo/Grafana profile alongside the normal development entry; `just observability-down` stops only the observability services and keeps their volumes. Core's configuration reference, HTTP/job/storage metering, audit correlation, dashboards and protocol/failure tests all survive example removal. Trace IDs are never used for authorization, and sampling or telemetry-export failures never change business state. Raw request contents, credentials, signed URLs and third-party transport debug output never enter the observability pipeline.
