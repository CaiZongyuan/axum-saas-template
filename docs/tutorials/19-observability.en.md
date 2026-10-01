# Add Observability to Your Business

Goal: trace your HTTP request through Jobs, storage and audit without making telemetry a commit dependency. Start with a [public API](01-full-stack-request.en.md); background work uses [Jobs](10-document-exports.en.md), durable success uses [Audit](14-audit-history.en.md).

## Start Optional Telemetry Services

Run from the repository root:

```bash
just dev-observability
```

This starts normal development services plus Collector, Tempo, Loki, Prometheus and Grafana. Open SaaS operations in [Grafana](http://127.0.0.1:3300). Anonymous read-only local access and loopback ports are not production authentication. Normal `just dev` omits this stack.

The [Compose overlay](../../compose.observability.yaml) and [Collector configuration](../../deploy/observability/collector.yaml) define actual services/data sources. Configure TELEMETRY_HTTP_PORT/TEMPO_PORT/LOKI_PORT/PROMETHEUS_PORT/GRAFANA_PORT for conflicts. Use `just observability-up / observability-validate / observability-down` independently; starting Collector does not enable export in existing processes. Restart applications or explicitly configure TELEMETRY_ENDPOINT/TELEMETRY_LOG_DIRECTORY.

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
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test jobs
```

[Public checks](../../crates/app/tests/telemetry.rs) capture real OTLP protobuf and drive HTTP/Worker/storage to verify parents, actors, audit and finite labels. [Outage](../../crates/app/tests/telemetry_outage.rs) and [shutdown](../../crates/app/tests/telemetry_shutdown.rs) prove blocked export still allows business, bounded backlog and exit.

Provide matching HTTP/job-result and telemetry-query scenarios for your business. Continue with [production](21-single-machine-production.en.md).

<!-- example:knowledge:reference-01:start -->

For telemetry wiring changes, `node scripts/knowledge-observability-smoke.mjs` queries real Tempo/Loki/Prometheus/Grafana/Audit in isolation and retains safe IDs. This smoke belongs to the Knowledge reference. See [performance budgets](24-perf-gates.en.md) for capacity validation.

<!-- example:knowledge:reference-01:end -->
