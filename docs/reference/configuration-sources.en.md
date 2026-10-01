# Variable Sources and Scope

Classify configuration by its reader. API and Worker variables and defaults belong in [Generated server configuration](site:reference/config.md), sourced from the [Rust configuration exporter](../../apps/api/src/bin/config-reference.rs). This page does not duplicate those defaults. Adding a server setting updates its owning `FIELDS`, reader and `.env.example`; documentation checks detect missing example keys.

## API and Worker

| Variable family                                            | Reader                                                                                                                           | Scope / boundary                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Database, binding, authentication, files and upload limits | [Settings / AuthSettings / FileLimits](../../crates/platform/src/config.rs)                                                      | Validated at startup; production APP_ORIGIN is the trusted browser origin, not an internal API container URL |
| Worker binding, leases, heartbeats and shutdown            | [WorkerPolicy / FIELDS](../../crates/app/src/modules/jobs/worker.rs)                                                             | Worker process; API and Worker share database and object storage settings                                    |
| Cache and rate limits                                      | [Cache](../../crates/platform/src/cache.rs), [RateLimiter](../../crates/app/src/modules/rate_limit/mod.rs)                       | Construct and share instances at API startup; policy determines Redis outage behavior                        |
| SMTP, mail encryption and password recovery                | [Mail settings](../../crates/platform/src/mail.rs), [PasswordReset](../../crates/app/src/modules/identity/password_reset/mod.rs) | API/Worker need matching key versions; deployment supplies production secrets                                |
| Telemetry queues, endpoints and timeouts                   | [TelemetrySettings](../../crates/platform/src/telemetry/settings.rs)                                                             | Bounded API/Worker exports; process EnvFilter reads `RUST_LOG`                                               |

<!-- example:knowledge:configuration-source:start -->

The knowledge reference domain owns `EXPORT_*`, read by [ExportPolicy](../../crates/app/src/modules/knowledge/exports/configuration.rs). Its manifest removes this configuration when the domain is removed. Define a separate policy for your ticket exports.
<!-- example:knowledge:configuration-source:end -->

## Local Development and Containers

| Variables                                                                                                   | Source                                                                                                                  | Purpose and limits                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT`, `RUSTFS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_HTTP_PORT` | [compose.yaml](../../compose.yaml), [.env.example](../../.env.example)                                                  | Development container credentials and host ports; not frontend configuration              |
| `WEB_PORT`, `VITE_API_PROXY`                                                                                | [Web Vite configuration](../../apps/web/vite.config.ts), [dev.mjs](../../scripts/dev.mjs)                               | Local binding / development proxy target; browsers cannot read database URLs through them |
| `TELEMETRY_HTTP_PORT`, `PROMETHEUS_PORT`, `LOKI_PORT`, `TEMPO_PORT`, `GRAFANA_PORT`                         | [Observability scripts](../../scripts/lib/observability.mjs), [Compose configuration](../../compose.observability.yaml) | Ports for optional local observability dependencies                                       |
| `CARGO_BUILD_JOBS`                                                                                          | [Development process helpers](../../scripts/lib/process.mjs), Cargo                                                     | Build concurrency; affects compilation resources rather than business runtime             |

`developmentEnv()` uses Node's dotenv parser and merges `.env.example` → untracked `.env` → process environment, with later values winning. When local mail capture is configured without an encryption key, the [development key helper](../../scripts/lib/development-mail-key.mjs) creates a protected machine-local file. Documentation builds never read it. Direct `cargo run` does not apply this merge; use the task runner.

Change only the corresponding `*_PORT` in `.env`. The development environment reader derives `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and its port, and also derives Redis/S3 endpoints, `APP_BIND`, `WORKER_BIND`, `APP_ORIGIN`, `VITE_API_PROXY`, the desktop origin and SMTP port. Explicit derived variables remain supported for external services; remove obsolete explicit endpoints from an older `.env` before expecting port changes to propagate. Host defaults use higher ports; container-internal ports retain their native values.

Both `just services-up` and `just dev` check host listeners and Docker published ports before startup, then verify actual bindings. `compose.yaml` has no fixed project name: the development entry derives the container, volume and network namespace from the directory name and a digest of its full path. After copying an existing project, allocate new `.env` ports; copies created by the scaffold already have independent ports.

## Browser and Desktop

| Variables                                                                         | Source                                                      | Scope                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `VITE_DOCS_URL`                                                                   | [Documentation entry settings](../../apps/web/src/main.tsx) | Public documentation URL compiled by Vite into the browser; use public addresses only |
| `SAAS_DESKTOP_ORIGIN`, `SAAS_DESKTOP_DOWNLOADS_DIR`, `SAAS_DESKTOP_USER_DATA_DIR` | [Electron main](../../apps/desktop/src/main.ts)             | Desktop page entry, download and user-data directories; API does not read them        |

Vite-prefixed values may enter public bundles. Database passwords, Session secrets, API Keys, SMTP passwords and mail encryption keys must never use `VITE_` names or appear in client source.

## Documentation Publication and Deployment

| Variables                                                           | Source                                                                                                                                | Purpose                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GITHUB_REPOSITORY`, `DOCS_BASE`                                    | [VitePress configuration](../../apps/docs/.vitepress/config.mts), [Built-link check](../../scripts/check-docs-build.mjs)              | Repository URL / deployment subpath; repository name determines the default base                             |
| `DOCS_SOURCE_REF`                                                   | [Documentation projector](../../scripts/lib/docs.mjs)                                                                                 | Source links and footer revision; defaults to Git HEAD. The footer does not prove every tutorial command ran |
| `ENV_FILE` plus production hostname, ports and database credentials | [Production environment example](../../deploy/production/env.production.example), [Production compose](../../compose.production.yaml) | Containers, HTTPS and protected deployment settings; documentation builds do not read them                   |

For an unknown variable, find its reader and category before consulting the appropriate example. Development ports and documentation publication variables do not belong in Rust Settings. See [Deployment](../tutorials/21-single-machine-production.md) for startup validation and HTTPS operations.
