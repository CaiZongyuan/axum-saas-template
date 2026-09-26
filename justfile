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
    pnpm docs:check
    pnpm build
    pnpm docs:build

# Complete milestone validation, including real Chromium.
check-full: check
    just e2e

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

docs:
    pnpm docs:dev

docs-check:
    pnpm docs:check

docs-build:
    pnpm docs:build
