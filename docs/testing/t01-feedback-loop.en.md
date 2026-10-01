# Test your backend and keep a useful feedback loop

Observe ordinary use cases through Axum HTTP, task/storage consistency through public capabilities, and complex pure rules through Domain tests. Run one failing behavior, then implement its complete path. File existence and private method calls cannot substitute for outcomes.

You need Rust, Node/pnpm, Docker and installed dependencies. Run commands from the repository root. Tooling creates test dependencies without using development or production databases.

## Give a new module an executable HTTP check

Create `apps/api/tests/my_business.rs` and first verify real migrations and assembly:

```rust
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "../../migrations")]
async fn migrations_make_the_application_ready(pool: PgPool) {
    let app = saas_api::router(pool, Default::default());
    let response = app
        .oneshot(
            Request::get("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
}
```

```bash
node scripts/test-backend.mjs --test my_business
```

Success establishes real migrations, Router and request context. Replace this initial smoke with public business requests: create and read matching fields; reject unauthorized writes and read unchanged state/version; replay one idempotent request without duplicate results. Missing route assembly should produce 404, and invalid requests should return structured errors with request_id.

A complete checked module example is [tutorial_module.rs](../../apps/api/tests/tutorial_module.rs) with `pnpm tutorial:check`. It verifies declarations, both Router paths and OpenAPI in a temporary source copy without existing databases.

## Choose sufficient observation interfaces

| Risk                                                             | Interface and real dependencies                      | Observable result                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| Identity, resource access, CRUD, conflicts, idempotency          | Axum Router + isolated PostgreSQL                    | Response and subsequent public reads                |
| Audit/Job transactions, leases, file publication, cache fallback | Public Application/Adapter + PostgreSQL/Redis/RustFS | Rollback, terminal state, object bytes and recovery |
| Last Owner and complex state transitions                         | Domain without infrastructure                        | Full rule boundaries                                |
| Web forms and failure feedback                                   | Views + Testing Library; MSW replaces HTTP only      | Input, visible feedback and preserved drafts        |
| Cookie/CSRF, SDK and real-page composition                       | A few real-browser journeys                          | Complete wiring and critical outcomes               |

Run the full backend suite:

```bash
just test-backend
```

[test-services.mjs](../../scripts/lib/test-services.mjs) creates isolated PostgreSQL, RustFS, Redis and Mailpit, supplies dynamic configuration and cleans them in reverse order. `#[sqlx::test]` applies real migrations. Concurrent transactions need real multiple connections, not a single-connection rollback fixture. Failure tests pause and clean up only resources they created.

[Migration checks](../../apps/api/tests/migration.rs) verify uninitialized readiness and bounded migration locks/queries; [Jobs checks](../../apps/api/tests/jobs.rs) cover claiming and recovery. Reuse these public interfaces with assertions for your own successes, denials and rollbacks.

## Daily integrated checks

```bash
just check
```

This includes Rust fmt/clippy, frontend formatting/lint/typecheck, contract drift, boundaries, tooling/backend/View tests, deterministic budgets and Web/documentation builds. New endpoints update generated contracts, SDK, tutorials and ownership together. Low-risk content changes can start with `pnpm docs:check` and `pnpm docs:build`; these do not establish business-state correctness.

When adding clients, use focused checks:

```bash
just test-frontend
pnpm test:tooling
```

View tests create a fresh QueryClient each time. MSW does not mock your hooks or state. Tool tests cover engineering contracts such as real subprocess shutdown and released ports.

## When to use browsers or desktop checks

```bash
pnpm exec playwright install chromium
just e2e
```

`just e2e` starts an isolated real application stack for critical Web journeys, browser regressions or milestones. A few journeys prove Cookie/CSRF, SDK, pages and backend wiring; complete role/failure matrices stay in faster backend tests. `just check-full` combines the main gate with application E2E.

`just e2e-docs` builds and browses only the static site, verifying navigation, language, theme, reading layout and deployment base without application services. A desktop browser viewport differs from Electron shell testing. Content/command edits normally need no Electron run; `just desktop-smoke` and resource soak apply when providing or changing a desktop client.

## Failures, records and next steps

Preserve first failures and redacted request/job ids. Locate response, transaction or process faults before rerunning. Coordinate races explicitly and bound waits. Authentication artifacts must not retain credentials, raw action parameters, page snapshots or complete signed URLs; follow the [testing strategy](strategy.md).

Record the tested commit and uncommitted scope: compilation, HTTP, docs builds and browser checks each establish different responsibilities. Once required checks pass, unchanged journeys need not be repeated after every push/merge.

Next: [Deploy a backend that has passed business tests](../tutorials/21-single-machine-production.md).
