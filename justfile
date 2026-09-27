set shell := ["bash", "-euo", "pipefail", "-c"]

# List the commands actually implemented in this revision.
default:
    @just --list

# PostgreSQL/RustFS/Redis/Mailpit in Docker, API reload and Web HMR on the host.
dev:
    node scripts/dev.mjs

services-down:
    docker compose stop postgres rustfs redis mailpit

db-down:
    docker compose stop postgres

migrate:
    node scripts/migrate.mjs

worker:
    node scripts/worker.mjs

bootstrap-storage:
    node scripts/bootstrap-storage.mjs

# Remove the knowledge example from a clean working copy, as registered in
# examples/knowledge-base/manifest.json (see docs/tutorials/23-example-removal.md).
example-remove *ARGS:
    node scripts/example-remove.mjs {{ARGS}}

# Core-only gate for a copy after the example was removed: compile, public
# behavior, contracts, boundaries, web and docs. lint/format stay part of
# `just check` — the removal contract gates the shippable product, not the
# dev loop.
check-core:
    cargo fmt --all -- --check
    cargo clippy --locked --workspace --all-targets -- -D warnings
    just test-backend
    pnpm contracts:check
    pnpm boundaries:check
    pnpm typecheck
    pnpm test:frontend
    pnpm build
    pnpm docs:check

generate:
    pnpm generate

check:
    cargo fmt --all -- --check
    cargo clippy --locked --workspace --all-targets -- -D warnings
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm contracts:check
    pnpm boundaries:check
    just test
    just perf-ci
    pnpm docs:check
    pnpm build
    pnpm docs:build

# Complete milestone validation, including real Chromium.
check-full: check
    just e2e

# Electron shell GUI smoke against the real stack (also used by the CI job).
desktop-smoke:
    node scripts/desktop-smoke.mjs

# Launch the Electron shell against a running dev web entry (just dev).
desktop:
    node scripts/desktop.mjs

test:
    pnpm test:tooling
    just test-backend
    just test-frontend

test-backend:
    node scripts/test-backend.mjs

test-frontend:
    pnpm test:frontend

e2e:
    pnpm test:e2e

# The performance entry point of spec §21: print the command index and the
# committed baselines, then run the deterministic evidence. No load,
# saturation or soak belongs here — those are the later report tickets and
# never run implicitly.
perf:
    @echo "== just perf: deterministic performance gates (spec §17) =="
    @echo "Budgets + first baselines: scripts/perf/baselines.json"
    @echo "Reports: .scratch/perf/bundle-report.json, .scratch/perf/query-plans.json"
    @echo "1/2 budget contract tests (registration + documents)"
    node scripts/test-backend.mjs --test perf_registration --test perf_documents
    @echo "2/2 bundle gate + query-plan report"
    just perf-ci

# The bundle gate and the query-plan report — part of `just check`, so the
# main gate covers perf-ci per spec §21. CI uploads the reports as an
# artifact; the budget tests run with the backend suite inside `just test`.
perf-ci:
    node scripts/perf-bundle.mjs
    node scripts/perf-query-plans.mjs

docs:
    pnpm docs:dev

docs-check:
    pnpm docs:check

docs-build:
    pnpm docs:build

# Optional local logs, traces, and metrics with the normal runnable application.
dev-observability:
    node scripts/dev.mjs --observability

observability-up:
    node scripts/observability.mjs up

observability-down:
    node scripts/observability.mjs down

observability-validate:
    node scripts/observability.mjs validate

# Single-machine production stack. ENV_FILE points at the operator's
# untracked environment file; see docs/tutorials/21.
production-build:
    pnpm --filter @saas/web build
    docker build -f deploy/production/Dockerfile -t axum-saas-production:local .

production-migrate ENV_FILE=".env.production":
    ENV_FILE={{ENV_FILE}} docker compose -f compose.production.yaml --env-file {{ENV_FILE}} --profile ops run --rm migrate
    ENV_FILE={{ENV_FILE}} docker compose -f compose.production.yaml --env-file {{ENV_FILE}} --profile ops run --rm storage-init

production-up ENV_FILE=".env.production":
    ENV_FILE={{ENV_FILE}} docker compose -f compose.production.yaml --env-file {{ENV_FILE}} up -d --wait postgres redis rustfs
    just production-migrate {{ENV_FILE}}
    ENV_FILE={{ENV_FILE}} docker compose -f compose.production.yaml --env-file {{ENV_FILE}} up -d --wait --wait-timeout 180 api worker caddy

production-down ENV_FILE=".env.production":
    ENV_FILE={{ENV_FILE}} docker compose -f compose.production.yaml --env-file {{ENV_FILE}} down

production-smoke:
    node scripts/production-smoke.mjs

production-backup ENV_FILE=".env.production" ARCHIVE=`printf 'backups/%s' "$(date +%Y%m%d-%H%M%S)"`:
    node scripts/production-backup.mjs --env-file {{ENV_FILE}} --archive {{ARCHIVE}}

production-restore ARCHIVE ENV_FILE=".env.production":
    node scripts/production-restore.mjs --env-file {{ENV_FILE}} --archive {{ARCHIVE}}

production-restore-drill:
    node scripts/production-restore-drill.mjs
