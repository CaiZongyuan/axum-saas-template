# Project structure

Put your business in a Rust Application module and connect it through the API and Worker entry points. Find these locations before writing your first endpoint.

## Backend map

```text
apps/
  api/src/main.rs        HTTP process: configuration, pool and lifecycle
  api/src/lib.rs         API composition: Router, OpenAPI, module options
  worker/src/main.rs     Handlers, maintenance and health checks
crates/
  app/src/http.rs        RequestId, public errors and extractors
  app/src/modules/      SaaS Core and specific business modules
  platform/src/         Database, storage, mail, Redis and telemetry
migrations/             Explicit SQL migrations
apps/api/tests/         Composed application HTTP behavior
crates/app/tests/       Core public capabilities and domain rules
examples/               Example ownership and teaching source
packages/contracts/     Protocol generated from Rust OpenAPI
packages/sdk/           Generated client and small transport setup
```

The [README](../../README.md) covers the complete client, deployment and documentation layout. This page focuses on backend development.

## Where a new feature belongs

| Goal                | Location                               | Responsibility                                             |
| ------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Add ticket business | `crates/app/src/modules/tickets/`      | Entities, rules, use cases, HTTP and public interfaces     |
| Declare the module  | `crates/app/src/modules/mod.rs`        | Rust module entry                                          |
| Add tables          | `migrations/` and module `module.json` | SQL migrations and table ownership                         |
| Compose the API     | `apps/api/src/lib.rs`                  | Business Router, OpenAPI and supported scopes              |
| Add background work | `apps/worker/src/main.rs`              | Business Handler and maintenance registration              |
| Verify behavior     | `apps/api/tests/`                      | Requests, responses, permissions, persistence and failures |
| Connect clients     | `packages/contracts/`, `packages/sdk/` | Generated protocol and methods                             |

`tickets` is the business you will add. The default template already registers the knowledge example; both can share SaaS Core.

## Request responsibilities

```text
HTTP request
  → composed application Router
  → module HTTP boundary: DTO, extractor, error mapping
  → Application: authorization, transaction, public capabilities
  → Domain rules and SQLx queries
  → PostgreSQL / Platform adapters
```

The [Core composer](../../crates/app/src/lib.rs) accepts an extra Router and a combined OpenAPI document. The [API entry](../../apps/api/src/lib.rs) selects the registered businesses. Core and Platform do not import a specific business.

A small module can implement one use case in `mod.rs`. Split out `domain.rs` and `application.rs` when rules and orchestration grow: Domain contains pure rules, Application owns transactions, and the HTTP boundary owns the protocol.

## Framework and business ownership

SaaS Core provides identity, membership, sessions, audit, idempotency, jobs, files, notifications, mail and shared HTTP capabilities. Your module defines its resources and rules and calls public interfaces within its own transaction.

For example, audit `append` accepts the caller's connection, so a business write and its audit commit together. Uploads and mail delivery involve I/O outside the database and need explicit publication, jobs and recovery.

```bash
pnpm boundaries:check
```

The check verifies package dependencies, table ownership, infrastructure imports in pure Domain code and example manifests. Real HTTP tests verify permission and transaction behavior. See [Core and business boundaries](module-boundaries.md).

## Next step

[Add a business module](../guides/develop-module.md): create a complete Rust file, register Router and OpenAPI, and verify the result over HTTP.
