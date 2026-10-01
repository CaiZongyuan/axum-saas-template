# Quick start: backend development

Start the API and dependencies, verify HTTP, PostgreSQL and migrations, then begin your own business module.

## 1. Prepare tools and a copy

Use the repository versions: Rust 1.96.0, Node 24.18.0, pnpm 11.17.0, just 1.58.0 and Docker / Compose for Linux containers. Sources are `rust-toolchain.toml`, `.node-version`, `package.json` and `.tool-versions`.

```bash
git clone https://github.com/CaiZongyuan/axum-saas-template.git
cd axum-saas-template
pnpm install --frozen-lockfile
just dev
```

Run from the repository root. The first run downloads dependencies and compiles Rust. The script starts PostgreSQL, Redis, RustFS and Mailpit, applies migrations and initializes storage, then runs API, Worker and Web.

Without `.env`, development defaults come from `.env.example`. Keep local overrides in `.env`. See the [configuration reference](site:reference/config.md).

## 2. Make a real request

Keep development running and execute in another terminal:

```bash
curl -i http://127.0.0.1:18000/health/live
curl -i http://127.0.0.1:18000/health/ready
curl -i http://127.0.0.1:18000/api/v1/system/status
```

Expect HTTP 200 and an `x-request-id` on every response. Status returns `status: "ok"`, `database: "connected"` and the actual `schema_version`, which changes with migrations.

Liveness proves the process is running; readiness validates dependencies and the full migration set. Starting the API does not migrate the database.

## 3. Observe failure and recovery

Use your own development environment. Stop PostgreSQL in another terminal:

```bash
just db-down
curl -i http://127.0.0.1:18000/health/ready
```

Readiness becomes 503 while liveness remains 200. Restore the database:

```bash
just services-up
curl -i http://127.0.0.1:18000/health/ready
```

Readiness should return 200. If connections work but migration history differs, run `just migrate` and check source/database versions.

## 4. Prepare authenticated requests

The default Web origin is `http://127.0.0.1:15400`. Create a development account at `/register`: the first successful account is Owner, later accounts are Members. Passwords use 12–128 characters.

Your protected HTTP endpoints reuse current Session, trusted Origin and CSRF. See [authentication and sessions](../tutorials/03-sessions.md). View development recovery mail in [Mailpit](http://127.0.0.1:18025).

<!-- example:knowledge:quickstart:start -->

The knowledge example provides complete [business writes](../tutorials/04-personal-documents.md), [resource authorization](../tutorials/07-library-grants.md) and [background exports](../tutorials/10-document-exports.md) to inspect while building your own business.

<!-- example:knowledge:quickstart:end -->

## 5. Enter the development loop

```bash
just generate
pnpm contracts:check
pnpm boundaries:check
```

Rust DTOs own the contract; SDK and types come from OpenAPI. Add your module, migrations, routes and tests together. Read [project structure](../architecture/project-structure.md), then [add a business module](../guides/develop-module.md).

Rust `.rs` / `.toml` changes restart API and Worker. After adding SQL migrations, run `just migrate` and restart development to refresh the migration set embedded in the binaries. Web uses HMR.

## Stop and troubleshoot

`Ctrl+C` stops host API/Worker/Web. `just services-down` stops dependencies and preserves volumes.

| Symptom                        | Check and recovery                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Docker dependencies not ready  | Check daemon, images and ports; restart development                                                 |
| Readiness is 503               | Check PostgreSQL, explicit migrations and source checksums                                          |
| API or Web port busy           | Change APP_PORT or WEB_PORT in .env; development scripts derive the endpoints                       |
| Database port changed          | Change POSTGRES_PORT in .env; DATABASE_URL is derived automatically                                 |
| Healthy without a port binding | Startup fails before migration; stop the reported owner and force-recreate while preserving volumes |
| Request fails                  | Use request_id to find API JSON logs and check the public error                                     |

Run `just docs` for local documentation at `http://127.0.0.1:5174/axum-saas-template/docs/`. The footer SHA identifies the build source; check out that commit to reproduce a specific version.
