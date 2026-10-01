# Deploy your SaaS backend

Commit business modules, migrations and Worker Handlers in one source revision, then release them with the production stack. The current model serves one Organization per deployment. Internal resources still require authorization, and multiple business modules are not separate tenants. A shared deployment for several organizations requires a new data ownership design; see the [single-organization ADR](../adr/0001-single-organization-deployment.md).

This guide requires Docker Compose, the Rust/Node/pnpm toolchain, a reachable TLS domain and business code verified through HTTP. Run commands from the repository root. They create or update persistent production database and object volumes.

## Configure and build

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
just production-build
```

Set `DOMAIN`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` in the [environment template](../../deploy/production/env.production.example). Both `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` must point to the public HTTPS entrance. Generate deployment secrets yourself; keep the environment file outside Git and the image. Types, defaults and validation are in the [configuration reference](site:reference/config.md).

When enabling mail, API and Worker must share `MAIL_ENCRYPTION_KEY` (32-byte hex). Without SMTP configuration, mail is disabled. The telemetry endpoint may be empty. An unavailable configured mail or telemetry destination does not block ordinary business requests.

The [Dockerfile](../../deploy/production/Dockerfile) builds API/Worker with embedded migrations; Caddy serves the Web build. Include your migration under `migrations/` in the build context and register your Handler at the [Worker assembly point](../../apps/worker/src/main.rs). Containers run as a non-root user with a read-only root filesystem and a temporary directory.

## Migrate explicitly, then start processes

```bash
just production-up .env.production
```

The environment file is a positional `just` argument; its default is `.env.production`. The recipe runs:

```text
PostgreSQL / Redis / RustFS healthy
  → one-shot migrate container
  → one-shot storage-init container
  → API / Worker / Caddy healthy
```

Migration and bucket initialization run explicitly in the `ops` profile. Starting API or Worker does not change the schema. Readiness fails if migrations are absent or the applied set/checksums differ from source. A failed migration stops the recipe before application startup. Fix the cause and rerun:

```bash
just production-migrate .env.production
just production-up .env.production
```

Only Caddy publishes 80/443 in the [production composition](../../compose.production.yaml). API, Worker, PostgreSQL, Redis and RustFS stay on the internal network. For manual Compose commands, `--env-file` supplies interpolation and the service `env_file` also needs `ENV_FILE`:

```bash
ENV_FILE=.env.production docker compose -f compose.production.yaml --env-file .env.production ps
```

## Verify your public contract

Set shell variable `DOMAIN` to the domain from the environment file, then check:

```bash
curl --fail "https://$DOMAIN/health/live"
curl --fail "https://$DOMAIN/health/ready"
curl -I "http://$DOMAIN/"
```

Expect 200 from both health endpoints and an HTTPS redirect from the plaintext entrance. Use your API to create, read and update a resource; verify data and Sessions survive a restart, and run a Worker task through its terminal state. Check denied access and version conflicts through the same HTTPS entrance. Health endpoints cannot prove business authorization.

Object URLs are signed against the public entrance. The [Caddyfile](../../deploy/production/Caddyfile) forwards bucket paths unchanged to RustFS; a proxy must not rewrite the signed Host or path. New business code uses this channel through Files.

## Failures and process lifecycle

| Failure                       | Contract to preserve                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL unavailable        | Readiness and database-dependent operations return controlled 503 errors with request_id; recovery needs no restart |
| Redis unavailable             | Cache falls back to PostgreSQL and rate limiting uses bounded conservative fallback; readiness remains independent  |
| RustFS unavailable            | Database content remains readable; uploads/completion fail predictably and can be retried after recovery            |
| Mail or telemetry unavailable | Business continues; Jobs retry mail and telemetry export/shutdown flush have deadlines                              |
| Worker stopped                | Requests can enqueue; PostgreSQL preserves tasks for later claims                                                   |

API shutdown drains HTTP requests. Worker shutdown stops new claims and drains current work.

| Process | Internal shutdown deadlines                                                                                                 | Compose grace period |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| API     | 3 seconds for HTTP drain, 1 second for pool closure, then bounded telemetry flush                                           | 30 seconds           |
| Worker  | Active work uses `JOB_SHUTDOWN_SECS` (default 10 seconds), health HTTP/pool get 1 second each, then bounded telemetry flush | 45 seconds           |

Trace shutdown gets at most 2 seconds; the metrics reader uses its SDK's 5-second shutdown wait. Production smoke and backup require API exit before 25 seconds and Worker before 40 seconds, with drain logs, below forced-kill grace periods. Increasing active-work deadlines also requires checking total budgets and Compose grace periods. Your Handler must honor cancellation, leases and exit deadlines so maintenance cannot wait indefinitely.

## Upgrade and recover

Create and verify an archive using the [backup guide](22-backup-restore.md), stop the old application, build the reviewed revision and migrate:

```bash
just production-down .env.production
just production-build
just production-up .env.production
```

`production-down` preserves volumes. If migration fails, keep the database and failure logs, fix the cause and retry. A new migration may already have committed; switching to an old image does not roll back the schema. Restore into an independent environment with the application revision corresponding to the archive.

Reproducible framework checks are:

```bash
node --test tests/tooling/production-compose.test.mjs
just production-smoke
```

`production-smoke` creates test secrets and a temporary production stack. It verifies the reference application, dependency failures, persistence and draining through real TLS, then removes its test volumes. It requires free ports 80/443 and cannot share an existing production entrance. Add a separate HTTPS journey for your own business.

Next: [Protect business data and verify independent recovery](22-backup-restore.md).
