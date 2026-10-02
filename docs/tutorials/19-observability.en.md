# Add Observability to Your Business

Goal: trace your HTTP request through Jobs, storage and audit without making telemetry a commit dependency. Start with a [public API](01-full-stack-request.en.md); background work uses [Jobs](10-document-exports.en.md), durable success uses [Audit](14-audit-history.en.md).

## Start Optional Telemetry Services

Run from the repository root:

```bash
just dev-observability
```

This starts normal development services plus Collector, Tempo, Loki, Prometheus and Grafana. Sign in as an Owner or Admin and open Settings → Monitoring (`/settings?section=monitoring`); open SaaS operations in [Grafana](http://127.0.0.1:13300) for detailed queries. The link uses the `.env.example` port; use the startup output when overriding ports. Anonymous read-only local Grafana access and loopback ports are not production authentication. Normal `just dev` omits this stack.

The [Compose overlay](../../compose.observability.yaml) and [Collector configuration](../../deploy/observability/collector.yaml) define actual services/data sources. Configure TELEMETRY_HTTP_PORT/TEMPO_PORT/LOKI_PORT/PROMETHEUS_PORT/GRAFANA_PORT for conflicts. Use `just observability-up / observability-validate / observability-down` independently; starting Collector does not enable export in existing processes. Restart applications or explicitly configure TELEMETRY_ENDPOINT/TELEMETRY_LOG_DIRECTORY.

## Check Runtime Status in Settings

Monitoring has Overview, Requests & performance, Background jobs, and Collection & alerts tabs with a last-15-minutes or last-hour selector. The question mark beside each metric explains its units and meaning on hover, keyboard focus, or click; the page keeps only essential guidance. P95 means 95% of requests complete within that duration, and server error rate counts only 5xx responses. Background jobs distinguish the current queue, execution attempts, and terminal failures: retries are not a count of failed jobs.

The application reads summaries through the administrator endpoint `GET /api/v1/system/monitoring?window_minutes=15`; the window also accepts `60`. Browsers do not connect to Prometheus. Request statistics exclude health checks and monitoring endpoints so automatic refresh cannot obscure business traffic. The current job queue is independent of metric collection and remains available without Prometheus.

Disabled collection, waiting for data, collecting, stale data, and query failures have distinct states; missing samples never display as zero errors or healthy. After startup, wait for at least two scrapes and make requests on business pages before returning to inspect trends. A Collector can still serve cached metrics, so API and Worker update the timestamp in `saas_telemetry_heartbeat_seconds{service=~"saas-api|saas-worker"}` on every export. This requires no user traffic; data without an update for over 180 seconds is stale.

Three deployment settings connect different endpoints:

| Setting                     | Purpose and local startup behavior                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONITORING_PROMETHEUS_URL` | Base URL used by API and Worker to query metrics; `just dev-observability` derives a host address from `PROMETHEUS_PORT`.                                                        |
| `MONITORING_WORKER_URL`     | Base URL used by API to check Worker readiness; development scripts derive a host address from `WORKER_PORT`. Production Compose uses the internal address `http://worker:3001`. |
| `MONITORING_GRAFANA_URL`    | Browser-facing link to detailed dashboards; `just dev-observability` derives a host address from `GRAFANA_PORT`.                                                                 |

Explicit addresses take priority over derived values. Prometheus and Worker accept HTTP(S) base addresses without paths, credentials, query parameters, or fragments. Grafana may have a path and requires HTTPS except on localhost/loopback, also without credentials, query parameters, or fragments. API and Worker read environment settings at startup, so restart both after changes. Saving on the page persists alert rules; it does not install or start monitoring services. In production, configure internal connections to the operator's collection/query services and authenticated browser access to Grafana. Prometheus and Worker do not need public ports.

## Configure In-App Alerts

Collection & alerts saves an error-rate threshold and duration. Alerts default to disabled, with a 1% threshold sustained for 5 minutes. Worker evaluates independently every 30 seconds, regardless of `JOB_MAINTENANCE_SECS`. It uses requests from the last 5 minutes and requires at least 100 requests to avoid low-traffic false positives from an isolated failure. A sustained breach sends an alert to currently active Owners/Admins; confirmed recovery sends a recovery notification. Rules are persisted and continue to run after the browser closes.

Send test notification sends only to the administrator performing the action. View result opens monitoring from their inbox. This checks in-app notification delivery, does not mean the threshold fired, and does not notify every member. Rule endpoints are `GET/PUT /api/v1/system/monitoring/alerts`; testing uses `POST /api/v1/system/monitoring/alerts/test`. Mutations and tests require a Session, administrator permission, and CSRF validation. This rule does not send email, SMS, or external notifications.

For a failure check, run `just observability-down` in another local development terminal. Monitoring should report collection or query failure instead of zero errors; missing or stale samples must not resolve an existing alert. Run `just observability-up` to restore services and wait for fresh samples before evaluating health. In-app alerts depend on Worker, the database, and inbox access. Availability checks outside the deployment must notify operators when the whole host or Worker stops.

## Reuse Public Wiring

[HTTP context](../../crates/app/src/http.rs) creates request IDs/spans, [Jobs enqueue](../../crates/app/src/modules/jobs/mod.rs) persists safe parent/correlation/actor, [Worker](../../crates/app/src/modules/jobs/worker.rs) creates an independent attempt span and the [storage adapter](../../crates/platform/src/object_storage.rs) records finite operations/outcomes. Your Domain need not depend on OTel.

Responses carry `x-request-id / x-trace-id` for Tempo/Loki correlation. HTTP spans can end before queued work starts; Worker restores W3C parent from the database. Restart/retry creates fresh spans rather than reusing IDs. traceparent is telemetry only, never authorization. Baggage/tracestate/raw URI/full headers are not persisted.

Add only necessary static events in your use case; call/field excerpt:

```rust
tracing::info!(action = "tickets.export.requested", "business request accepted");
```

Record at the actual success point and actor only after authorization. Exclude bodies, tokens, passwords, signed URLs and raw AWS/Redis errors. Keep route/kind/operation/outcome labels finite. User/Job/resource/trace IDs are correlation fields, never metric labels.

## Correlate with Durable Results

Replace the example value with your full trace ID:

```text
{service_name=~"saas-api|saas-worker"} |= "YOUR_TRACE_ID"
sum by (route, status) (rate(saas_http_requests_total[5m]))
sum by (kind, outcome) (rate(saas_jobs_attempts_total[5m]))
```

The first line is LogQL, the others PromQL. JSON context lives in span/spans and event fields in fields rather than all at top level. Rates need at least two scrapes; Histogram P95 interpolates buckets. A transient attempt is not terminal Job failure. Compare task batch/history, business result and Audit; an observed span does not prove commit.

## Telemetry Failure Cannot Backpressure Business

[Platform telemetry](../../crates/platform/src/telemetry/mod.rs) defaults to span queue 512, batch 64 and lossy log queue 1024; overflow drops observations. OTLP has a 1-second total budget without automatic retry. Collector has a memory limiter, finite queues and at most 10 seconds retry. Collector failure neither fails database readiness nor reexecutes business.

Empty TELEMETRY_ENDPOINT disables export; current support is local HTTP loopback/collector service name. Invalid parents start fresh traces; upstream unsampled traces may return IDs without exported records. Output accepts only controlled project saas_* targets, including TRACE level, without enabling third-party secret logs.

Shutdown drains business first, then closes providers finitely. Trace has 2 seconds, current metrics reader 5 seconds and logs a finite wait; data loss is allowed. Hourly app files retain at most 24 files, not an exact disk quota. Prometheus/Loki retention is asynchronous and development volume capacity needs monitoring. Define production budgets/retention explicitly.

## Verify Integration

```bash
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test monitoring --test monitoring_alerts --test jobs
```

[Public checks](../../crates/app/tests/telemetry.rs) capture real OTLP protobuf and drive HTTP/Worker/storage to verify parents, actors, audit and finite labels. [Outage](../../crates/app/tests/telemetry_outage.rs) and [shutdown](../../crates/app/tests/telemetry_shutdown.rs) prove blocked export still allows business, bounded backlog and exit.

[Monitoring HTTP checks](../../crates/app/tests/monitoring.rs) cover administrator permissions, collection states, and query summaries. [Alert checks](../../crates/app/tests/monitoring_alerts.rs) cover persisted rules, in-app test delivery, and sustained failures/recovery.

Provide matching HTTP/job-result and telemetry-query scenarios for your business. Continue with [production](21-single-machine-production.en.md).

<!-- example:knowledge:reference-01:start -->

For telemetry wiring changes, `node scripts/knowledge-observability-smoke.mjs` queries real Tempo/Loki/Prometheus/Grafana/Audit in isolation and retains safe IDs. This smoke belongs to the Knowledge reference. See [performance budgets](24-perf-gates.en.md) for capacity validation.

<!-- example:knowledge:reference-01:end -->
