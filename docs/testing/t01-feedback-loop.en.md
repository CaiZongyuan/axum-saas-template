# Running the current tests and feedback loop

T01's test subject is the first public full-stack request. The commands below are real checks, not empty gates parked for v1 features that do not exist yet.

## Backend

```bash
just test-backend
```

The script creates an isolated PostgreSQL container; SQLx tests run real migrations. The development database's data volume is never wiped by tests. Tests going through the Router verify liveness, readiness, public errors/request_id, OpenAPI, and the real database migration state. The startup configuration test runs the real API executable and checks that failures happen before listening and never leak credentials.

The migration test also holds the real PostgreSQL migration lock and then runs the migration command, verifying that it fails and exits within the configured deadline; HTTP tests use a database lock to verify queries do not wait forever.

## Frontend

```bash
just test-frontend
```

Vitest / Testing Library drives the real views; MSW replaces only HTTP. Coverage runs from loading through success, failure messages, request_id and retry after recovery, to the service not responding: loading ends and retry is offered; every test creates a fresh QueryClient.

## Dev-process cleanup

```bash
pnpm test:tooling
```

The test starts a real HTTP subprocess and lets it ignore SIGTERM. Even if the outer launcher exits first, stopping the development services must clean up the subprocess still holding the port. The test watches whether the service still responds, never counting internal signal invocations.

## Real browser

First-time Chromium preparation:

```bash
pnpm exec playwright install chromium
just e2e
```

E2E creates an isolated database on dynamic ports, compiles and runs the real API, starts the Web app and visits it through Chromium. It checks that responses come from the real interfaces, pauses its own database container to verify readiness fails while liveness survives, then restores it. Logs, failure screenshots and traces go into the test-artifacts directory.

## Main check

```bash
just check
```

It includes Rust fmt/clippy, frontend format/lint/typecheck, contract drift, boundary checks, process cleanup and backend/view tests, docs checks, and the web/docs builds. Daily checks never launch a browser; run `just e2e` after key journeys, and `just check-full` for full milestone acceptance. CI's manual entry can tick `run_e2e`; ordinary push/PR keeps the fast checks. Mobile is out of v1 scope (implementation ticket [#22](https://github.com/CaiZongyuan/axum-saas-template/issues/22) recorded as not planned; spec §15.2 stays as a design note); the shipped soak tests and business features each have their own checks — nothing idles, nothing pretends.

## Red → green during implementation

This ticket first observed, in order: unregistered routes returning 404, errors missing request_id, a missing 503 contract while the database was not ready, an unmigrated database falsely reporting ready, missing OpenAPI, a misconfigured setup still listening, and views without loading/failure feedback; then implemented each behavior one by one.

Later modules keep looping on the agreed public entry points, never substituting internal method-call counts or file existence for behavior.
