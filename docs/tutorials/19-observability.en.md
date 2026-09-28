# Walkthrough: Tracing an export request to the worker and RustFS

This chapter answers "where is my document export stuck, and why did it fail". Application state is still decided by PostgreSQL; traces, logs and metrics help locate problems but take no part in authorization, job claiming or business transactions.

## 1. Start the optional observability stack

```bash
just dev-observability
```

It starts the normal development stack plus five observability services: the Collector receives data, Tempo stores traces, Loki queries logs, Prometheus scrapes metrics, and Grafana provides dashboards and Explore. The plain `just dev` keeps the original lightweight stack.

Open [Grafana](http://127.0.0.1:3300) and enter **SaaS operations** from Dashboards. The local profile allows anonymous read-only viewing; all query/administration ports bind to loopback only — this is not a production login setup for the public internet. The API keeps port 3000 and Grafana uses 3300.

The [compose overlay](../../compose.observability.yaml) pins five image versions and digests; the [configuration directory](../../deploy/observability/collector.yaml) holds the real receivers, data sources, dashboards and persistent volumes. On port conflicts adjust `TELEMETRY_HTTP_PORT`, `TEMPO_PORT`, `LOKI_PORT`, `PROMETHEUS_PORT` and `GRAFANA_PORT` in `.env`. The development entry builds the local OTLP endpoint from these and verifies that the Collector actually accepts OTLP requests and the four backends are ready.

`just dev-observability` automatically uses `.runtime/telemetry` for the private JSON logs. The Collector mounts that directory read-only; to read the private directory created by the host user it runs as root inside the container, keeping only the `DAC_READ_SEARCH` capability, with a read-only root filesystem. It never mounts the Docker socket. Configuration and log volumes are read-only too, and read progress is kept in its own volume.

You can also start/stop the services separately:

```bash
just observability-up
just observability-validate
just observability-down
```

Starting the observability services alone does not make an already-running API start exporting; restart as `just dev-observability`, or start the app with `TELEMETRY_ENDPOINT` and `TELEMETRY_LOG_DIRECTORY` set explicitly. Stopping the observability services keeps their data volumes; stopping the development app keeps the observability services so you can keep querying.

## 2. Find a real export

Register and sign in, create a Markdown document, upload an attachment and click "Export current document". In the browser network panel find `POST /api/v1/knowledge/documents/{id}/exports` and note the response's `x-request-id` and `x-trace-id`. The former identifies this HTTP request; the latter correlates the whole execution chain this request produced.

In Grafana Explore choose Tempo and enter the trace ID. You will see:

1. `http.request`: the export request's route template, method, request_id and authenticated actor_id.
2. `job.attempt`: the worker's standalone execution span with job_id, attempt, the original request_id/actor_id, correlation_id and causation_id.
3. `storage.operation`: real RustFS adapter operations such as `download_to`, `put_file_if_absent` and `head`, with safe operation names and outcomes.

While the job is queued the HTTP span may end first; the worker restores the W3C parent from the database and continues the same trace. Process restarts, lease recoveries and automatic retries each create a new attempt span without reusing span IDs. The raw job payload never needs to enter an OTel object or an email secret.

Use an Owner/Admin in "Background jobs" from the "Administration" group to inspect the real persisted state by job_id. Querying "Audit trail" by correlation_id lines the request up with the worker's completion record inside the same trace. Observability showing that a span was sent never proves the business transaction committed; the job, export and audit APIs remain the source of truth.

## 3. From traces to logs and metrics

The Tempo data source offers correlated queries into Loki, and a trace_id in a Loki log line opens Tempo on click. Query directly:

```text
{service_name=~"saas-api|saas-worker"} |= "replace with your trace_id"
```

The default JSON logs keep context in `span` / `spans` and event fields in `fields`. For example the worker's `job attempt finished` carries the outcome and an optional static error_code; not every field is promoted to the JSON top level. Searching with the full trace ID shows API and worker together.

The dashboard's main PromQL is:

```text
sum by (route, status) (rate(saas_http_requests_total[5m]))
sum by (kind, outcome) (rate(saas_jobs_attempts_total[5m]))
histogram_quantile(0.95, sum by (le, operation) (rate(saas_storage_duration_seconds_bucket[5m])))
```

Latency is recorded in seconds, with explicit histogram buckets covering 1ms, 5ms, 10ms, 25ms and other milli/sub-second marks up to 300 seconds; P95 is an interpolated approximation within a bucket. A freshly started process needs at least two scrapes before rate works. Metrics use only method, route template, status class, registered kind, operation and a bounded outcome set; trace IDs, users, jobs, documents or object keys never become labels. Each metric stream is also capped at 128 series — past the cap, values fall into the SDK's overflow aggregation.

`saas.jobs.attempts` counts observed handler outcomes; `transient` does not mean the whole job finally failed. Retries, administrator-opened batches and forced cancellations must be judged against the persistent job history. Histograms record handler/storage call durations while business errors keep their existing error semantics.

## 4. Reproduce one explainable failure

Stop the worker in the development environment, request an export, sign out, then start the worker again. The session bound at request time has been revoked, so the export fails and the job keeps `knowledge.export_credential_revoked`. After signing back in you can still see your own export's failure state; retrying the old job never bypasses the original credential check — request a fresh export instead.

In Loki, use the trace ID to find the worker's failure event. Error codes explain why the request was rejected without recording session secrets, Markdown, attachment bodies or signed URLs. Storage errors record only bounded outcomes such as `not_found`, `unavailable` and `too_large`, never a formatted raw AWS SDK error.

If you only want to verify the whole wiring once, run:

```bash
node scripts/knowledge-observability-smoke.mjs
```

This milestone script uses its own PostgreSQL/RustFS, random ports, a dedicated compose project and a temporary log directory. It completes a real ZIP export with an attachment and compares the body, reproduces the revoked-session export failure, then queries the real Tempo, Loki, Prometheus, Grafana and the audit API. On success it saves only the safe correlation IDs and check names in `.scratch/t19-observability-evidence.json`, cleans up its own environment and never touches development data.

## 5. Why a failing collector cannot drag the business down

[Platform telemetry](../../crates/platform/src/telemetry/mod.rs) batches OTLP/HTTP protobuf on a dedicated thread. The default span queue holds at most 512 entries with batches of 64; when full, new telemetry is dropped. Each span's fields, events and links are also bounded, and the app fills only controlled, bounded fields. Logs use an independent lossy queue of 1,024 lines; a slow export may drop logs and never applies backpressure to HTTP/the worker.

Each OTLP request has a default total budget of 1 second with no exporter auto-retry; the collector itself has a memory limiter, bounded batches/send queues and a retry deadline of at most 10 seconds. During a failure traces/logs may be missing — this never affects the audit in the database. Normal requests never redo business work to make up telemetry.

With `TELEMETRY_ENDPOINT` empty no exporter is created; currently only loopback or the compose collector service name is supported, using local HTTP. An incoming `traceparent` is observability context only and never authorizes anything; baggage, tracestate, the full header set or raw URIs are never stored. An invalid parent starts a new trace; when upstream explicitly does not sample, responses may still carry valid IDs but Tempo holds no export data.

Configuration errors report field names only before listening; an unavailable collector is never a ready failure reason. Even with `RUST_LOG=trace`, the output layer accepts only this project's controlled `saas_*` targets, keeping third-party HTTP/storage debug output — with signed URLs or connection parameters — out of the logs.

Shutdown first completes the original HTTP/worker drain, then closes the observability provider on the blocking thread. Traces get at most 2 seconds to close; the fixed SDK 0.33 metrics reader waits at most 5 seconds and does not follow custom shutdown timeouts. The log writer has its own bounded exit wait, and the development script reserves an extra 10 seconds for observability. Timeouts may lose telemetry and never claim a remote receiver was cancelled.

## 6. Retention and resource boundaries

Application JSON files rotate hourly with at most 24 files per service; this is not a per-file byte cap or a precise 24-hour disk guarantee. The collector's file offsets live in their own volume so restarts never re-read all files from the beginning.

Development Prometheus uses 24h/512MB block retention, and Loki uses 24h retention with a compactor; these are asynchronous cleanups, not total disk quotas. Tempo uses that pinned version's local storage default retention. Development data volumes need periodic capacity checks; production log budgets and locations are configured at deployment and no unlimited retention promise is derived from this local profile.

The collector container is limited to 256 MiB with an internal memory limiter at 128 MiB — a comfortable single-machine teaching configuration. The other backends' sizing and production resource budgets should still be measured under real load.

## 7. Public tests and your own business

```bash
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test jobs
just check
```

The tests capture real OTLP protobuf and drive a real Axum/PostgreSQL/worker/RustFS, verifying parents, actors, persisted context, audit and metric labels; at TRACE level they check that secret samples never reach the output. The blocked-export test completes 1,024 consecutive HTTP requests and observes the bounded backlog; further tests cover collector 503 and silence against business readiness and bounded shutdown. Day-to-day development uses these faster interface tests, leaving the full profile smoke to observability changes and milestones.

Your own business only needs Core's authentication and job transaction interfaces, recording necessary static events with `tracing`; the domain never depends on OTel directly. Actors are logged only after authorization succeeds, business payloads and observability metadata stay separate, and every new metric first fixes its bounded label set.

Removing the knowledge base deletes this chapter and the export-specific smoke script; the generic telemetry wiring, Core HTTP/job/audit integration, the observability profile, dashboards, the configuration reference and the three Core integration tests remain. Replacing the business never means rebuilding an observability pipeline.
