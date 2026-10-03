# Dougong

**Build your SaaS backend with Rust and Axum, then connect shared Web and Desktop clients.**

Named after the _dougong_ (斗拱), the standardized bracket set of Chinese timber architecture — prefabricated parts that carry whatever roof you assemble on top. The template applies the same idea to SaaS: one reusable core, reference applications you can remove.

English · [简体中文](README.zh-CN.md)

[![CI](https://github.com/CaiZongyuan/axum-saas-template/actions/workflows/ci.yml/badge.svg)](https://github.com/CaiZongyuan/axum-saas-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Start with authentication, permissions, background jobs, file storage, and a shared Web/Desktop UI. Keep the reusable SaaS Core, follow the reference application through real business flows, then replace it with your own domain.

[Developer documentation](https://caizongyuan.github.io/axum-saas-template/en/docs/) · [Quick start](docs/getting-started/quickstart.en.md) · [Project structure](docs/architecture/project-structure.en.md) · [Capability coverage](docs/architecture/v1-coverage.en.md)

## Develop your own business

Start with [project structure](docs/architecture/project-structure.en.md), then [add a business module](docs/guides/develop-module.en.md). The guides show where code belongs, how to compose routes and OpenAPI, and how to verify the HTTP result. Your module owns its data and rules; it reuses Core identity, membership, audit, idempotency, files and jobs through public interfaces.

For a continuous path, [build a ticket SaaS backend](docs/learn/index.en.md): ten lessons and four runnable checkpoints take one module through persistence, authorization, transactions, attachments, Worker exports, tests and recovery.

Use the knowledge example to inspect a complete implementation. Connect clients after the backend contract works. Documentation and teaching code are maintained together in Chinese and English; see the [author guide](docs/guides/maintain-docs.en.md).

## Why this template

- **Core capabilities already connected.** Sessions, membership, files, jobs, audit, and notifications work through the same application and database.
- **A reference application you can remove.** An ownership manifest tracks example code, routes, dependencies, and tutorials. CI exercises removal and verifies that Core still works.
- **One API contract across clients.** Rust generates OpenAPI, TypeScript contracts, and the SDK. Web and Electron share views; checks catch contract drift.
- **Performance you can investigate.** Deterministic budgets check database work and payload sizes; reproducible load scenarios produce latency, throughput, and memory reports.
- **Learn from the implementation.** Tutorials connect user actions to source code, public interfaces, tests, and deployment steps.

The current deployment model serves **one Organization per deployment**, with multiple members and resource-level permissions. It fits products and internal tools deployed separately for each customer organization.

## What's included

| Capability     | Included behavior                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Identity       | Email/password registration, cookie sessions, CSRF protection, logout, password reset, and session revocation        |
| Access control | Organization roles, member administration, resource authorization, and scoped, revocable API keys                    |
| Reliable work  | PostgreSQL-backed jobs, leases, retries, attempt history, idempotent operations, and notifications                   |
| Files          | Private S3-compatible storage through RustFS, upload/download flows, and background object cleanup                   |
| Operations     | Audit history, request IDs, structured logs, tracing and metrics, Redis caching, and rate limiting                   |
| Clients        | React Web UI and an Electron shell sharing views, generated contracts, and an API SDK                                |
| Deployment     | Single-machine Docker Compose, Caddy HTTPS, database migrations, backups, and an isolated restore drill              |
| Verification   | Rust HTTP/integration tests, UI tests, browser journeys, module boundaries, contract checks, and performance budgets |

Built with **Rust, Axum, Tokio, Tower, SQLx, PostgreSQL, Redis, RustFS, React, TypeScript, TanStack Router/Query, Tailwind CSS, shadcn/ui, and Electron**.

## Quick start

<!-- scaffold:creator:start -->

Create a renamed, isolated project with `npx create-axum-saas my-app`; add `--no-examples` for a Core-only starting point. See [Create your project](docs/getting-started/create-project.en.md) for prerequisites, startup and the multiple-copy workflow.

<!-- scaffold:creator:end -->

Install Docker with Compose and the pinned toolchain: **Rust 1.96.0, Node 24.18.0, pnpm 11.17.0, and just 1.58.0**. Versions are recorded in [rust-toolchain.toml](rust-toolchain.toml), [.node-version](.node-version), and [.tool-versions](.tool-versions).

```bash
git clone https://github.com/CaiZongyuan/axum-saas-template.git
cd axum-saas-template
pnpm install --frozen-lockfile
just dev
```

Verify the backend in another terminal:

```bash
curl -i http://127.0.0.1:18000/health/ready
curl -i http://127.0.0.1:18000/api/v1/system/status
```

Expect HTTP 200 and an `x-request-id`. Open **[http://127.0.0.1:15400/register](http://127.0.0.1:15400/register)** for a development account. The first successful account is Owner, later accounts are Members, and passwords use 12–128 characters.

`just dev` starts PostgreSQL, Redis, RustFS, and Mailpit in Docker, applies migrations, initializes storage, then starts the API, Worker, and Web app on the host. Rust changes restart the API/Worker; the Web app supports hot reload.

To start the application with logs, traces, metrics, and the monitoring dashboard, stop any existing `just dev` process and run:

```bash
just dev-observability
```

Sign in as an Owner or Admin and open **Settings → Monitoring**, or visit [http://127.0.0.1:15400/settings?section=monitoring](http://127.0.0.1:15400/settings?section=monitoring). This starts the normal development app plus Collector, Prometheus, Loki, Tempo, and [Grafana](http://127.0.0.1:13300). Use the application to generate a few API requests and allow a few scrapes before inspecting metrics. Normal `just dev` does not start these monitoring services. See the [observability guide](docs/tutorials/19-observability.en.md) for collection settings and in-app alerts.

Development defaults come from [.env.example](.env.example). Copy it to an untracked `.env` to customize your setup.

| Local service                | Address                                 |
| ---------------------------- | --------------------------------------- |
| Web app                      | http://127.0.0.1:15400                  |
| API readiness                | http://127.0.0.1:18000/health/ready     |
| OpenAPI schema               | http://127.0.0.1:18000/api/openapi.json |
| Development email            | http://127.0.0.1:18025                  |
| Grafana (monitoring startup) | http://127.0.0.1:13300                  |

With `just dev` running, use `just desktop` to open the same application in Electron. `Ctrl+C` stops the host processes; `just services-down` stops the Docker services while preserving their data volumes.

<!-- example:knowledge:readme:start -->

## Learn through the knowledge base example

The included reference application supports personal and shared knowledge bases. It demonstrates how a business module uses Core:

1. Register and create a Markdown document in your personal knowledge base.
2. Edit, preview, search, and paginate documents; handle concurrent edit conflicts.
3. Grant Reader or Editor access to a shared knowledge base and verify revocation.
4. Upload attachments, download authorized files, and insert image references.
5. Request a ZIP export, follow the Worker job, and receive a notification.
6. Inspect audit history, then delete content and let background jobs clean up objects.

Start with [your first document](docs/tutorials/04-personal-documents.md), [resource permissions](docs/tutorials/07-library-grants.md), or [exports and jobs](docs/tutorials/10-document-exports.md).

<!-- example:knowledge:readme:end -->

## Make it your own

Core owns reusable SaaS capabilities. The reference application owns its business model, views, routes, and teaching materials. See the [module boundaries](docs/architecture/module-boundaries.md) for the dependency rules.

Preview example removal with:

```bash
just example-remove --dry-run
```

The [replacement guide](docs/tutorials/23-example-removal.md) walks through removal and adding your own module. Applying removal requires a clean Git working copy. It preserves migration history by default and leaves databases, object storage, and secrets untouched.

## Performance and validation

Performance contracts cover database round trips, rows written, response sizes, and frontend bundle sizes. They run with the normal checks. Load results are recorded separately for nightly and release analysis.

<!-- example:knowledge:performance:start -->

```bash
just perf-ci            # Bundle budgets and query-plan reports
just perf-load          # Steady mixed workload
just perf-saturation    # Increasing concurrency
just perf-trajectory    # Complete user journeys
just perf-soak          # Sustained workload and resource samples
```

Load commands require [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and start an isolated, disposable stack using release builds. The current scenarios use the knowledge base example. Reports include data size, throughput, P50/P95/P99, business errors, expected throttling, queue depth, database connection samples, and API/Worker RSS.

See [performance budgets](docs/tutorials/24-perf-gates.md) and [load reports](docs/tutorials/25-load-reports.md) for commands, conditions, and the initial measurements. Interpret each result with its workload and machine configuration when sizing a deployment.

<!-- example:knowledge:performance:end -->

```bash
just check              # Main checks, tests, builds, and documentation
just test-backend       # Backend tests with isolated services
just test-frontend      # Vitest and Testing Library
just e2e                # Real API and Chromium user journeys
just check-full         # Main checks plus browser E2E
```

Install Chromium once with `pnpm exec playwright install chromium` before running browser tests. Test infrastructure uses isolated resources; see the [testing guide](docs/testing/t01-feedback-loop.md).

## Project layout

```text
apps/          API, Worker, Web, Desktop, and documentation entry points
crates/        Application modules and shared platform infrastructure
packages/      Contracts, SDK, client core, UI, and shared views
migrations/    PostgreSQL schema history
examples/      Reference application ownership manifests
scripts/       Development, verification, performance, and deployment tools
docs/          Tutorials, architecture, decisions, and operational guides
```

## Documentation and deployment

The [developer documentation](https://caizongyuan.github.io/axum-saas-template/en/docs/) provides Chinese and English chapters with source revision links. Run `just docs` for the English local entry at http://127.0.0.1:5174/axum-saas-template/en/docs/.

- [Follow a request through the full stack](docs/tutorials/01-full-stack-request.md)
- [Deploy on a single machine](docs/tutorials/21-single-machine-production.md)
- [Back up and restore a deployment](docs/tutorials/22-backup-restore.md)
- [Review implemented capabilities](docs/architecture/v1-coverage.md)

When adding a feature, update its behavior, tests, and tutorial together. Use `just generate` to regenerate API contracts, `pnpm contracts:check` to check drift, and `just docs-build` to validate the documentation build.

## License

[MIT](LICENSE) — Copyright (c) 2026 Dougong contributors.
