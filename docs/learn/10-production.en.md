# 10 Deploy, observe and recover your ticket business

Starting state: the `jobs` checkpoint and lesson 09's public checks. Bring the same module to production and prove Tickets, files and queued tasks recover together, beyond a 200 health response.

You need a Docker host, reachable TLS domain, production configuration and reviewed source. Run at the course-copy root. Production creates persistent data and a public entrance; first read the [deployment guide](../tutorials/21-single-machine-production.md).

## Confirm business assembly

```bash
pnpm boundaries:check
cargo check --locked -p saas-api -p saas-worker
```

Both API Router paths and OpenAPI must include tickets. Worker must register the export Handler, Core file cleanup/maintenance and business export-expiry maintenance. The original default template has no tickets; building it does not produce course endpoints.

Save the copy's business changes into your own source revision. Course `.env`, Cookies and downloaded outputs are local development data, not production secret configuration.

## Build and migrate explicitly

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
just production-build
just production-up .env.production
```

Set the real DOMAIN, Origin and database/storage secrets. API/Worker share the mail encryption key when mail is enabled. Build embeds migrations containing ticket tables. Startup orders healthy dependencies, migrate, storage-init, API/Worker/Caddy. API startup must not implicitly fill the schema.

Set request-terminal `BASE_URL` / `ORIGIN` to this HTTPS entrance. Repeat lesson 02 registration/creation and lesson 07 upload/download to create production-drill data. Deploying source does not transfer development data into production volumes.

```bash
curl --fail "$BASE_URL/health/ready"
curl --fail -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

Expect readiness and Ticket reads to return 200 with the same authorization policy through TLS. Migration mismatch produces readiness 503; inspect image, source migrations and database, then migrate explicitly.

## Correlate requests, tasks and persisted facts

Retain request_id from creation/export and query Ticket, Core Job and Audit. tracing/Jobs/Audit wiring correlates requests with each Worker attempt, which has its own span after HTTP ends. Readable outputs and notifications establish commit; a trace alone cannot.

For local observation use `just dev-observability` in development and follow the [observability guide](../tutorials/19-observability.md) for logs, queues and storage. Domain needs no OTel dependency. Configure free observation ports if another profile already occupies them. Logs exclude bodies, Cookies, passwords and complete signed URLs; resource ids are not high-cardinality metric labels.

Redis/telemetry failure does not alter persisted Tickets. Exports can queue while Worker is stopped and resume claiming afterward. Tasks still honor leases, cancellation and publication-time authorization.

## Back up and restore independently

First run the ticket-specific local drill from the original template root:

```bash
pnpm tutorial:recovery:check
```

It requires local Docker and free ports 80/443. It creates an isolated course copy, image and two production Compose projects. Over localhost TLS it creates/updates tickets, uploads an attachment, queues an export with Worker stopped, and runs the real backup and independent restore commands. It compares restored fields/version, attachment bytes, JSON export and terminal notification. Cleanup removes its projects, volumes and private temporary data, retaining only a redacted report. This establishes local delivery and recovery; verify your public domain and production host with the steps below. See the [ticket recovery entry](../../scripts/check-tutorial-recovery.mjs).

Enter a Maintenance Window using the [backup guide](../tutorials/22-backup-restore.md), draining API before Worker:

```bash
just production-backup .env.production backups/ticket-course
just production-down .env.production
just production-restore backups/ticket-course .env.production
```

Verify PASS in backup/restore reports. Production volumes remain while the restore project gets a new network/volumes. Archives include business schemas and Files ready objects but no secrets. Prepare the matching image/protected configuration instead of forcing new migrations onto a historical restored database.

Read the same production `TICKET_ID` after restore and compare fields/version. Download the attachment as in lesson 07 and compare sha256. Exports queued before backup should complete with restored Worker. Pending uploads follow TTL; one-hour exports stop signing downloads and business maintenance reclaims them.

Framework `production-smoke` / `production-restore-drill` checks knowledge journeys by default, not ticket assertions. Record your recovery outcomes separately; health/inventory cannot replace a business journey. Traffic switching is explicit, and deleting production volumes is not a port-conflict solution.

Previous: [Public checks and SDK](09-verification.md). Continue with [capability guides](../getting-started/documentation.md) to add business rules and independent delivery checks.
