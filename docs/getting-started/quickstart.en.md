# Quick start

Core provides email/password registration, login/logout, member management, password reset, session invalidation and a real service status probe, wired as **Web → generated SDK → Axum → PostgreSQL**.

## Prepare the tools

Use the versions pinned by the repository: Rust 1.96.0, Node 24.18.0, pnpm 11.17.0, just 1.58.0, plus a Docker / Compose setup that can run Linux containers. The versions are recorded in `rust-toolchain.toml`, `.node-version`, `package.json` and `.tool-versions`.

Every online page marks the "source version" in its footer — the repository commit this page was verified against. To reproduce this page exactly, check out that commit first:

```bash
git clone https://github.com/CaiZongyuan/axum-saas-template.git
cd axum-saas-template
git checkout <footer source version>   # e.g. git checkout 18710ff9b5ab
pnpm install --frozen-lockfile
just dev
```

`just dev` starts PostgreSQL/RustFS/Redis/Mailpit in Docker, runs migrations explicitly and initializes the private storage bucket, then starts the host API, Worker and Web. Web supports HMR; changing Rust sources restarts the API and the Worker. Without a `.env` file the local development settings from `.env.example` apply; copy it to `.env` first when you need to adjust anything.

Open the [registration page](http://127.0.0.1:5173/register), enter an email, a 12–128 character password and an optional display name; a successful registration signs you in. The first successful account becomes the organization Owner, later accounts become Members. Operators should register their own Owner account before handing the deployment to regular users; no invitation or email waiting is involved.

The [service status page](http://127.0.0.1:5173/system) shows "service ready", "PostgreSQL connected" and the current migration version; the migration history must match the current sources.

With an existing account, open the [login page](http://127.0.0.1:5173/login). The home page signs you out and invalidates the old session; see the [login and sessions tutorial](../tutorials/03-sessions.md).

Forgot-password requests can be filed from the login page; open the one-time link in [Mailpit](http://127.0.0.1:8025). See the [password reset tutorial](../tutorials/18-password-reset.md). The development mail key is stored automatically in the private `.secrets/development-mail-key` file and never enters version control.

Owners/Admins manage roles and activation from the organization members area on the home page; the last active Owner cannot be deactivated or demoted. See the [member management tutorial](../tutorials/08-members.md). The background jobs entry provides safety status, attempt history and limited retries for failed jobs.

Registration, login and ordinary requests are rate limited by default; the page shows a waiting hint once the limit is reached. See [rate limits and conservative fallback](../tutorials/17-rate-limits.md).

<!-- example:knowledge:quickstart:start -->

## Save your first document

After signing in, open "My documents" → "New document", enter a title and Markdown, then click "Save document". Ordinary members can start right away; a personal library and Editor grant are prepared automatically on first save. The body survives a detail-page refresh, and the list reopens the document.

Creating, safe preview, title search, pagination, access isolation and reliable retries are supported; [editing and conflict handling](../tutorials/06-edit-conflicts.md) and [uploading attachments, downloading and inserting image references](../tutorials/09-attachments.md) work too. Follow-along steps: [your first Markdown document](../tutorials/04-personal-documents.md) and [search and preview](../tutorials/05-search-preview.md).

Owners/Admins can create shared libraries from the "Knowledge bases" area, rename them, and grant or revoke Reader/Editor; granted members browse and write inside the library. See [shared knowledge bases and grants](../tutorials/07-library-grants.md).

Open a saved document and click "Export current document" to produce a ZIP of the body and attachments; the page shows progress and offers the download. See [document exports and background jobs](../tutorials/10-document-exports.md).

Where editing is allowed, documents or attachments can be deleted after confirmation; admins can delete whole libraries, and a background job cleans up the objects. See [deletion and reliable cleanup](../tutorials/12-deletion-cleanup.md).

Once an export finishes or finally fails, check the "Notifications" area on the home page, mark it read or open the export detail. See [export notifications and read state](../tutorials/13-export-notifications.md).

Owners/Admins can trace actual operations in "Audit records" by document id, action and request id. See the [administrator audit tutorial](../tutorials/14-audit-history.md).

Create read-only document credentials under "API Keys" and read documents you may access from scripts; see the [API key tutorial](../tutorials/15-api-keys.md).

Document details use the real Redis body cache while every read still verifies visibility and version against PostgreSQL; see [versioned cache and database fallback](../tutorials/16-versioned-cache.md).

To debug export problems, run `just dev-observability` and follow a request from the trace into the Worker, RustFS, logs and metrics; see the [observability tutorial](../tutorials/19-observability.md).

<!-- example:knowledge:quickstart:end -->

The API listens on `127.0.0.1:3000` by default:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:3000/api/v1/system/status
```

Every response carries an `x-request-id`. The status request actually reads the migration records from PostgreSQL; it is not hard-coded presentation data.

## Watch a failure scenario

Keep `just dev` running and temporarily stop the development database in another terminal:

```bash
just db-down
```

Click "Re-check" on the service status page again. The page shows a failure hint and a request id; `/health/ready` returns `503` while `/health/live` still returns `200`.

Bring the database back and re-check:

```bash
docker compose up -d --wait postgres
```

`Ctrl+C` stops the development API/Worker/Web; the database, RustFS and their volumes are kept. `just services-down` stops the four dependencies without deleting data; `just db-down` stops the database alone.

## Documentation and next steps

```bash
just docs
```

The local documentation entry is [http://127.0.0.1:5174/axum-saas-template/docs/](http://127.0.0.1:5174/axum-saas-template/docs/). The online site and the local site are rendered from the same Markdown sources.

After copying the template, follow [publish the documentation site](publish-docs.md) to enable your own GitHub Pages; later merges to `main` are checked and published by CI.

Continue with [your first full-stack request](../tutorials/01-full-stack-request.md), the [test feedback loop](../testing/t01-feedback-loop.md) and the [Core/example boundary](../architecture/module-boundaries.md). The full roadmap is recorded in the [architecture spec](../saas-template-architecture-spec.md).

## FAQ

- **The database connects but ready still fails**: run `just migrate`; the API never migrates automatically, and the applied migration set, success state and checksums must match the current sources.
- **Port already in use**: adjust `APP_BIND` / `VITE_API_PROXY` in `.env`; when changing the database port also adjust `POSTGRES_PORT` and `DATABASE_URL`, then restart the development entry.
- **Rust configuration error**: check the [generated configuration reference](site:reference/config.md). Errors never print database credentials.
- **Browser requests fail**: compare the request_id against the API's JSON logs; the page talks to the API through Vite's same-origin proxy, and the database URL never reaches the browser.
