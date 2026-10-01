# Boundaries for Core, Platform and your business

SaaS Core owns identity, Organization Memberships and shared capabilities. Your business module owns models, rules, tables, HTTP interfaces and Handlers. Platform adapts configuration and external systems. Application entries assemble them explicitly; Core and Platform do not depend back on business types.

Read [project structure](project-structure.md) first. This page explains capability ownership; begin implementation with [Add a business module](../guides/develop-module.md).

## Dependencies and request flow

```text
apps/api/src/lib.rs ──assembles──→ Core Router + business Router/OpenAPI
                                  │                 │
                                  │ public APIs ←───┘
                                  ↓
                      crates/platform (config, PG, S3, Redis, SMTP, telemetry)

apps/worker/src/main.rs ──assembles──→ Handler Registry + Jobs Worker
apps/web/src/app-examples.tsx ──assembles──→ Universal App Shell + business Views
```

Backend modules live in `crates/app/src/modules/<name>/`. A small module can start in `mod.rs`, splitting HTTP, Application and pure `domain.rs` as complexity warrants. Pure Domain does not import Axum, SQLx or infrastructure. Responsibilities define boundaries; every endpoint does not require Repository/Service layers.

| Owner                | Responsibility                                                                                       | Should not own                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Platform             | Settings, pools, migration execution, bounded Redis/S3/SMTP operations and Telemetry                 | Organization policy or business DTOs                       |
| Core modules         | Identity, Organization, Audit, Idempotency, Files, Jobs, Notifications, Mail, API Keys and RateLimit | Business-resource policies or tables                       |
| Your business        | Protocols, domain rules, resource authorization, transaction coordination, owned tables and Handlers | Other modules' private SQL                                 |
| Application assembly | Router/OpenAPI, scopes, Handlers and UI contributions                                                | Registration state implicitly read by all modules          |
| Client packages      | contracts → SDK → Views, with generic UI and platform-independent helpers                            | Duplicate DTOs or cached backend authorization conclusions |

`packages/core` contains platform-independent client helpers; it is distinct from Rust SaaS Core. `packages/ui` provides generic React DOM components.

## Minimal backend assembly interface

[crates/app/src/lib.rs](../../crates/app/src/lib.rs) exposes `compose_routes` and `compose_routes_with_options`. This complete function assembles Core only and belongs in an application adapter:

```rust
pub fn core_router(
    pool: sqlx::PgPool,
    auth: saas_platform::config::AuthSettings,
) -> axum::Router {
    saas_app::compose_routes(
        pool,
        auth,
        axum::Router::new(),
        saas_app::openapi(),
    )
}
```

Pass your Router and merged OpenAPI through the same interface when adding business code, without making Core import it. Production calls `configured_router`; tests also call `router_with_cache`. Register a module along both actual paths. Advanced assembly supplies scopes, Cache, RateLimiter and the password-reset service through `CoreOptions`.

## Collaboration and transaction ownership

Owned migrations and `module.json.tables` declare table ownership. Stable identifiers such as `saas_core.users(id)` may be referenced by database constraints; profile reads, active Membership checks and cross-module writes still use public interfaces.

| Capability            | Caller responsibility                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/Organization | Obtain identity, verify active Membership and apply business-resource authorization; critical writes can lock Memberships to stabilize authorization |
| Audit                 | Call `audit::append` inside your transaction and roll back business writes on failure                                                                |
| Idempotency           | Keep claim, business writes and complete in one transaction; fingerprint normalized input                                                            |
| Jobs/Notifications    | Enqueue and register notification intent in the request transaction; Jobs publishes atomically on terminal state                                     |
| Files                 | Authorize business resources first; Files owns object state, and network I/O is not PostgreSQL-atomic                                                |
| API Key/Cache         | Register implemented scopes, intersect credentials with current resource access and reauthorize before cache hits                                    |
| Telemetry             | Use tracing/public scopes; request/trace ids correlate events and never grant access                                                                 |

Organization roles differ from business-resource access. Owner/Admin/Member do not automatically replace your resource rules. Each deployment has one Organization; adding modules does not create a tenant boundary. See [ADR 0001](../adr/0001-single-organization-deployment.md).

Cache and rate limiting use bounded Platform Redis capabilities rather than arbitrary business commands. Identity owns reset validity and short-lived ciphertext; Jobs stores only reset ids. Credentials and signed URLs stay outside logs, Job payloads and caches. Domain holds no runtime OTel Context.

## Check boundaries and diagnose failures

```bash
pnpm boundaries:check
cargo check --locked --workspace
```

The [checker](../../scripts/check-boundaries.mjs) validates package imports, reverse Core dependencies, infrastructure in Domain, table ownership, ownership conflicts and registration markers. Temporarily register or access a private Core table from your business module; it should fail. Restore the code and run business HTTP/transaction tests.

SQL checks inspect source strings and registered table names; they cannot establish correctness for all dynamic SQL, quoted identifiers or aliases. Rust visibility, review and real database tests supplement them. For removable Reference Domains, register source, migrations, tutorials and tests and follow [removal](../tutorials/23-example-removal.md) in a temporary copy to prove Core still builds.

Tradeoffs and assembly responsibilities are in [ADR 0002](../adr/0002-executable-removable-reference.md) and [ADR 0003](../adr/0003-static-example-composition.md). Next: [Choose public behavior tests for your business](../testing/t01-feedback-loop.md).
