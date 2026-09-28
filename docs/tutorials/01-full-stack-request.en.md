# Walkthrough: The first full-stack request

The goal is to understand which public interfaces a real request passes through and how to verify it. First run the current version following the [quick start](../getting-started/quickstart.md); there is no need to rewrite modules that already exist under the same name.

## 1. Start from the migration

[Core's first migration](../../migrations/0001_core.sql) establishes the namespace; SQLx records the migration version. `just migrate` is an explicit step — starting the API never modifies the database schema.

```bash
just migrate
```

If you start against an empty, unmigrated database, readiness must return `503`. This shows that "the process is running" and "the process can take business requests" are two different things.

## 2. The API entry only assembles capabilities

The [API entry](../../apps/api/src/main.rs) reads validated configuration, creates the connection pool, initializes tracing, and then merges the Core and reference-application routers/OpenAPI through the [application assembly point](../../apps/api/src/lib.rs). Core accepts extra routes and contracts and never imports the reference application in return.

<<< ../../apps/api/src/main.rs

The [system module](../../crates/app/src/modules/system/mod.rs) reads the real migration state and returns the status DTO. The [shared HTTP plumbing](../../crates/app/src/http.rs) adds request_id and the unified error structure.

Waiting always has a bound: the status query waits at most 2 seconds, including time to acquire a connection from the pool; migrations wait at most 30 seconds by default, adjustable through `MIGRATION_TIMEOUT_SECS`. When the API stops, in-flight HTTP requests get at most 3 seconds to finish, followed by at most 1 second to close the connection pool, so shutdown never waits forever.

## 3. Generate the contract and SDK from Rust

OpenAPI paths, response types and error types come directly from Rust. Run:

```bash
just generate
pnpm contracts:check
```

The generator puts the DTOs into contracts and the client into the SDK; the SDK's types bridge back to contracts, with no second hand-written copy of the DTOs.

<<< ../../packages/sdk/src/index.ts

The SDK aborts an unresponsive request after 5 seconds by default and preserves the caller's ability to cancel actively. Errors returned by the backend carry a request_id; a network timeout may have no server response at all, so a page must never invent a server-side request id.

You can also open `/api/openapi.json` on the running API, or read the [generated API reference](site:reference/api.md) on this site.

## 4. The web entry only consumes the public SDK

The [browser entry](../../apps/web/src/main.tsx) creates the QueryClient, the same-origin API client and the router. The [shared status view](../../packages/views/src/system/status-view.tsx) calls the generated SDK through TanStack Query and renders loading, success and error.

The frontend stores no PostgreSQL configuration, never assembles DTOs by itself, and does not copy the same server resources into a second state container. The Electron shell later reuses this very view.

## 5. Verify through the same entry points

```bash
just test-backend
just test-frontend
just e2e
```

Backend tests use a real database and the real router; view tests use MSW only at the HTTP boundary; the E2E suite starts an isolated database, the real API and a browser, and even pauses the database to observe failure and recovery.

For the exact test locations and observation points, see the [testing notes](../testing/t01-feedback-loop.md).

## What to change for your own business

Replace the system status query with your own public use case: define the model/migration, register the use case and the HTTP/OpenAPI surface, then regenerate the SDK and wire up a view. The connection pool, error handling, request_id, development entry points and the check pipeline are reusable; your entities and rules stay inside your own modules.

This chapter demonstrates how the current source is wired. The authentication and business chapters follow the same chain, and every capability ships with both a tutorial and tests.
