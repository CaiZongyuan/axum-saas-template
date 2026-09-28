# Walkthrough: Deploying the knowledge base to single-machine production and verifying stop/start and degradation

This chapter answers "how does the template reach single-machine production". One Docker host, one Caddy TLS entry; the static web assets are served directly by Caddy, and the API, Worker, PostgreSQL, Redis and RustFS all stay on the internal network with no published ports. Database migrations and storage initialization are always explicit. The production composition is not a copy of the development [compose](../../compose.yaml): it has its own [composition file](../../compose.production.yaml), [image build](../../deploy/production/Dockerfile) and [entry configuration](../../deploy/production/Caddyfile), and tests lock in those differences.

## 1. Prepare the deployment environment and secrets

Copy the template and fill in the deployment environment file:

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
```

The minimum set to change: `DOMAIN` (the TLS domain; Caddy issues certificates automatically from it — public domains use ACME, localhost uses a local CA), `POSTGRES_PASSWORD`, and `S3_ACCESS_KEY`/`S3_SECRET_KEY`. Leaving `MAIL_SMTP_HOST` empty means mail is off (registration and writing are unaffected; only reset mail is not sent). Enabling SMTP also requires `MAIL_ENCRYPTION_KEY` (32-byte hex, identical for api and worker); even if SMTP becomes unreachable afterwards, registration and writing keep working and delivery jobs stay in the queue retrying under their leases. Leaving `TELEMETRY_ENDPOINT` empty means no OTLP reporting; an unreachable collector never blocks the business.

This file carries production secrets and is excluded by `.gitignore` and `.dockerignore` — it never enters an image or the repository. The services' `env_file` in the composition file reads the `ENV_FILE` environment variable, while `--env-file` only feeds interpolation — the [justfile](../../justfile) `production-*` recipes already pass `ENV_FILE` for you; when calling docker compose by hand you must carry it yourself. The semantics and validation rules of every key are in the [generated configuration reference](site:reference/config.md) or the comments inside `deploy/production/env.production.example`.

## 2. Build, start and migrate explicitly

```bash
just production-build                       # Build the web assets and app images (no env file needed)
just production-up ENV_FILE=.env.production # Dependencies → explicit migration → app
```

The `production-up` order is deliberate: first `--wait` until PostgreSQL/Redis/RustFS are healthy, then run `migrate` and `storage-init` in one-shot containers (the compose `ops` profile, invisible to a plain `up`), and only then start api, worker and caddy and wait for health. The API and the Worker never migrate silently: behavior tests start the binaries against an empty database and assert that `/health/ready` keeps returning `503` (`database.unavailable`/`worker.unavailable`), that the `public` schema still has zero tables after five seconds, and that the processes stay alive ([API side](../../apps/api/tests/migration.rs), [Worker side](../../apps/worker/tests/no_implicit_migration.rs)).

The image build is multi-stage: the Rust build stage mounts registry/target caches, the runtime is slim Debian with a non-root user and a read-only root filesystem (`read_only: true`, tmpfs `/tmp`), and base images are pinned by digest. `migrations/` is embedded at compile time by `sqlx::migrate!`, so it must stay inside the build context.

## 3. Verify the entry and the main journey

```bash
just production-smoke
```

The [smoke script](../../scripts/production-smoke.mjs) generates a fresh set of secrets, boots the complete production composition, and then goes through the real Caddy TLS chain: entry checks (`/health/live` 200, the landing page with HSTS and CSP, plain-HTTP redirect), the main journey (register an owner, write a document, upload an attachment and read it back), restart persistence, degraded behavior for Redis/RustFS/PostgreSQL failures, queued export recovery after a Worker outage, and graceful stops of both the API and the Worker. The whole journey deliberately runs in an environment where "mail is configured but SMTP is unreachable and the telemetry collector is down" — registration and writing stay usable throughout, which is exactly what the degradation matrix promises. Each phase failure raises with a `[phase-name]` prefix, and the script finishes with an automatic `down -v` cleanup.

Manual spot checks of the entry also work:

```bash
curl https://$DOMAIN/health/live
curl -I http://$DOMAIN/   # Expect 308 → https
```

Presigned object URLs work through the entry because the application signs with `S3_PUBLIC_ENDPOINT` (that is, `APP_ORIGIN`), and the [Caddyfile](../../deploy/production/Caddyfile) forwards `/<bucket>/*` verbatim to rustfs:9000 — path and Host unchanged — so the v4 signature stays valid.

## 4. Stop, restart and degradation rules

`docker compose restart api worker` (or stop/start) verifies one thing: the session cookie and the data survive container replacement, because state lives only in PostgreSQL and the object volumes. Stop timeouts in the composition file match the in-process budgets:

| Container | In-process stop budget                                                          | stop_grace_period |
| --------- | ------------------------------------------------------------------------------- | ----------------- |
| api       | 3s HTTP drain + 1s connection pool + bounded telemetry flush (≤15s total)       | 30s               |
| worker    | api budget + `JOB_SHUTDOWN_SECS` (default 10s) to finish held work (≤25s total) | 45s               |
| others    | No custom logic; the default stop is fine                                       | 10–30s            |

The smoke script measures this: api's stop must take clearly less than the 30s grace period (proof that it exited by itself instead of being killed), with `draining HTTP requests` in the logs; the same applies to the Worker, with `stopping worker claims and draining current work` in the logs.

Non-core dependency failures degrade according to the spec matrix, and the smoke covers every row:

| Failure                         | Behavior                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL stops                | `/health/ready` turns 503, business reads return a controlled 503 (with `request_id`), and recovery brings back 200 without a restart                                 |
| Redis stops                     | Cache falls back to the database, registration and writing continue; the readiness probe only looks at the database, so the container is not wrongly marked unhealthy |
| RustFS stops                    | Markdown stays readable in PostgreSQL; new upload PUTs fail and completion returns a controlled 503; retries succeed after recovery                                   |
| Mail configured but unreachable | Registration and writing unaffected; reset/verification mail jobs stay in the queue retrying under their leases                                                       |
| Telemetry collector unreachable | Business unaffected; batch exports are bounded and flush by their deadline at process stop                                                                            |

A Worker shutdown loses no work: export requests are accepted with `202` as usual, and the Worker claims and completes them from the database job table when it returns (the lease is protected by `JOB_LEASE_SECS`).

## 5. Upgrades and the maintenance window

An upgrade = new image + explicit migration, in a fixed order:

```bash
just production-down ENV_FILE=.env.production    # Or stop only api worker for a rolling window
git pull && just production-build
just production-migrate ENV_FILE=.env.production # Run the new migrations explicitly
just production-up ENV_FILE=.env.production
```

Failure handling falls out of the same command naturally: when the `migrate` one-shot container exits non-zero, `production-up` aborts before starting the application, the database stays at the last successful migration, the old containers are stopped and the new ones have not taken over — fix the problem (most often a missing key in the environment file or an unreachable database) and rerun `production-migrate`; already-applied migrations are not executed twice.

`docker compose up -d` only recreates services whose image or configuration changed; data volumes (PostgreSQL data, object storage, Caddy certificates) persist across upgrades. Never enter a container by hand to change data — for recovery, see [backup and isolated-environment restore drill](22-backup-restore.md).

## 6. Run this chapter's checks

```bash
node --test tests/tooling/production-compose.test.mjs   # Composition file and security properties
just production-smoke                                    # Real composition, full journey
just check
```

The [composition tests](../../tests/tooling/production-compose.test.mjs) verify the production composition's structural properties on every `just check`: only Caddy publishes ports, every long-running service has a health check and resource limits, the migration services hide in the `ops` profile and are depended on by nothing, no migrate in the API/Worker commands, read-only root filesystems, no real secrets in the env template, and `.dockerignore` excluding `.secrets` and `.env*`. What matters: migrations are explicit, there is exactly one entry, failures degrade along the matrix, and the grace periods match the stop budgets.
