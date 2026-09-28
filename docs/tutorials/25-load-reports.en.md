# Walkthrough: Load, saturation and soak reports

The [performance contract](../../CONTEXT.md) of the [previous chapter](./24-perf-gates.md) governs deterministic budgets: round-trips, rows, bytes — verified by every CI run. This chapter adds the other half of [spec §17.3](../saas-template-architecture-spec.md) — wall-clock behavior: what ordinary load looks like, where the saturation point appears under concurrency, and whether the queue and memory stay stable over a long run. Such numbers jitter across machines by nature, so the template sets three rules for them: **load only ever hits a controlled stack, never your existing database**; **reports are produced on nightly runs and version releases, never inside an ordinary PR gate**; **throttling is not an error** — `429` with `rate_limit.exceeded` is a documented backpressure contract, reported as a separate "expected throttles" category, presented apart from real business errors.

## 1. The controlled load stack: stress the temporary stack, not your data

Every load command first brings up a fresh [controlled load stack](../../CONTEXT.md) via [stack.mjs](../../scripts/perf/stack.mjs): the repository's own development compose file, but started under the isolated project name `saas-perf`, with every service assigned a free port on the spot and volumes isolated per project — your development stack (project `axum-saas-template`) and any production deployment cannot be touched, not even sharing a data directory. The API and Worker run as release builds from the host, because capacity readings should measure the product itself. When the command ends (success or failure) it runs `down -v`, destroying the stack with its volumes; the stack never exists in a "finished run, data left behind" state. For post-mortems, `PERF_STACK_KEEP=1` keeps it and the script prints the destroy command.

Rate limiting on the stack is relaxed to a million requests per minute — a capacity reading should measure the application, not the local defaults (20 registrations per minute would drown the seeding loop). The local fallback quota used when Redis degrades is relaxed too: under load the Redis counter occasionally misses the budget and the limiter falls back to the local per-peer bucket; with the default 120/minute fallback the whole window would become a 429 storm instead of a capacity reading. The scenario code still classifies and counts 429s per request, so if you ever restore real limits and rerun, the report stays honest.

## 2. Data and scenarios: everything through public interfaces

[fixtures.mjs](../../scripts/perf/fixtures.mjs) seeds the dataset at a configurable scale entirely through the public HTTP interfaces — registration, document creation, attachment upload — never writing the database directly. The scale tier and the actual seeded counts go into the report's fixtures metadata, so every number can be traced to "measured on this much data".

| Scenario     | File                                                    | What it does                                                                                                                                                                            | Default tier  |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `load`       | [k6/load.js](../../scripts/perf/k6/load.js)             | Ordinary load: a signed-in read-heavy mix (list / read document / occasional create), constant concurrency                                                                              | 4 VU × 60s    |
| `saturation` | [k6/saturation.js](../../scripts/perf/k6/saturation.js) | A read-only mix driven up a fixed concurrency ladder by the runner, merged into a throughput-concurrency curve                                                                          | 1→32 VU × 20s |
| `trajectory` | [k6/trajectory.js](../../scripts/perf/k6/trajectory.js) | A real user journey: register → sign in → create → edit conflict (retry after 409) → attachment upload/download → export request → wait for the Worker → download export → notification | 2 VU × 60s    |
| `soak`       | [k6/soak.js](../../scripts/perf/k6/soak.js)             | A low-concurrency long run: edit, attachment and export-request loops, watching queue drain and memory trends                                                                           | 2 VU × 600s   |

Each VU signs in once on its first iteration and reuses the session; write requests carry random idempotency keys and are indistinguishable from any other client. When k6 is missing, the commands print install instructions and exit — they never pretend to have run; reports in the repository are produced with k6 v2.3.0.

## 3. What the report contains and how to read it

Every command writes `.scratch/perf/<scenario>-report.json` with four blocks:

- **k6 metrics**: throughput (req/s), P50/P95/P99 of `http_req_duration`, check failure rate, and the `expected_throttles` and `business_errors` counters — business errors split further into `business_error_4xx` / `business_error_5xx` columns: a 4xx wave is a regression, a 5xx wave is capacity degradation, tellable at a glance. Read steady-state reports business-errors-first — a run with business errors flooding the counters is not a reading, it is an incident record.
- **Reading the saturation point** (saturation report): throughput rises with concurrency until a tier where it stops growing and errors start appearing — the turning point of the curve is the saturation point. The report offers a `plateauFromVUs` hint (the smallest concurrency tier reaching 90% of the best tier's throughput); it is a reading aid and asserts nothing. Steady-state scenarios (load / trajectory / soak) carry the `business_errors` guard track that keeps error-flooding runs out of the readings; the saturation ladder deliberately crosses capacity, and errors at the top tiers are exactly the signal to observe — so it has no such track: errors are recorded as 4xx/5xx in the report instead of failing the command.
- **Stack samples**: taken every 2 seconds during the scenario — connection pool usage (`pg_stat_activity`), job queue depth (grouped by `saas_core.jobs` state), and api/worker process RSS — aggregated into min/avg/max, with the raw sample series kept. The soak's value lives on this timeline.
- **Environment metadata**: scale tier, VU count, duration, rate-limit configuration, fixtures facts — a report must carry its own reproduction conditions.

## 4. Where to run it and how to tune it

```bash
just perf-load        # Or perf-saturation / perf-trajectory / perf-soak
```

The only prerequisite is k6. Scale and duration are all adjusted through environment variables; the commands take no arguments:

| Variable                            | Default         | Purpose                                                    |
| ----------------------------------- | --------------- | ---------------------------------------------------------- |
| `PERF_SCALE`                        | `sm`            | Data scale tier (sm / md / lg)                             |
| `PERF_USERS` / `PERF_DOCS_PER_USER` | Set by tier     | Precise override of seeded counts                          |
| `PERF_VUS`                          | Set by scenario | Number of concurrent virtual users                         |
| `PERF_DURATION`                     | Set by scenario | Duration in seconds (saturation uses `PERF_STEP_SECS`)     |
| `PERF_STEPS`                        | `1,4,8,16,32`   | Concurrency tiers of the saturation ladder                 |
| `PERF_STEP_SECS`                    | `20`            | Seconds per saturation tier                                |
| `PERF_SAMPLE_MS`                    | `2000`          | Stack sampling interval (pool / queue / RSS, milliseconds) |
| `PERF_STACK_KEEP`                   | Unset           | Set to `1` to keep the stack for investigation             |

[perf-nightly.yml](../../.github/workflows/perf-nightly.yml) runs the full set nightly (and on manual trigger): installs k6 with checksum verification, runs load / the saturation ladder (shortened) / trajectory / a time-boxed soak, and keeps the reports as artifacts for 30 days. Ordinary PRs never run them — on PRs there is only the [previous chapter's deterministic gate](./24-perf-gates.md).

## 5. The first measurements and where things go after example removal

The first measurements are archived below (local x86_64 WSL2, default tier of 6 users × 8 documents; the numbers drift with machine, neighbor load and data distribution — the archive gives later readers a comparable starting point, not a promise on any machine):

| Scenario   | Config (default tier) | Throughput                          | P50 / P95 / P99                    | Business errors                             |
| ---------- | --------------------- | ----------------------------------- | ---------------------------------- | ------------------------------------------- |
| load       | 4 VU × 60s            | 308.1 req/s (18,480 requests)       | 10.5 / 28.3 / 38.1 ms              | 0                                           |
| saturation | 1→16 VU × 15s         | 131.9 → 270.9 → 270.2 → 177.4 req/s | p95: 10.3 → 23.5 → 54.8 → 155.2 ms | 23 and 29 at the 8 and 16 VU tiers, all 5xx |
| trajectory | 2 VU × 60s            | 46.3 req/s (164 complete journeys)  | p95 34.8 ms                        | 0                                           |
| soak       | 2 VU × 300s           | 9.4 req/s (2,832 requests)          | 20.5 / — / 24.0 ms                 | 0                                           |

Reading per §3: the saturation curve enters 90%+ of the best throughput (270.9 req/s) at the 4 VU tier, `plateauFromVUs=4`; pushing concurrency further drops throughput and stretches p95 nearly sixfold, with 5xx appearing at the 8/16 VU tiers — exactly the capacity-degradation signal this curve exists to observe, recorded as-is without a fail verdict. The soak's 151 samples are where the long-run value is: api process RSS stayed at 61.9–62.5 MiB throughout and worker at 17.0–17.3 MiB, pool usage stable at 3–7, the export queue peaked at 2 and drained instantly — five minutes show no sign of a leak or backlog. k6 v2.3.0; the full reports (raw sample series and environment metadata included) are written by the commands to `.scratch/perf/*-report.json` and never committed.

<!-- EVIDENCE-TABLE -->

The example-removal boundary is the same line as the [performance gates](./24-perf-gates.md): the four scenarios and fixtures ride on the knowledge-base example's endpoints, and after example removal `just perf-load` and friends explain honestly and exit before starting work. The scenario scripts and fixtures stay in the repository as skeleton templates, but what is genuinely business-agnostic and keeps working after removal are the [controlled load stack](../../scripts/perf/stack.mjs), the sampler and the report structure ([report.mjs](../../scripts/perf/report.mjs)). When modeling your own business: swap the scenarios for your hot-path endpoints and the fixtures for your domain data, and keep the "throttles listed separately, saturation only recorded" rules exactly as they are.

One written decision about microbenchmarks: this ticket evaluated attaching Criterion to the export rendering (the workspace's only pure-compute hotspot). It is not on the hot path — exports are asynchronous jobs — while Criterion would enter the compile cost of every `clippy --all-targets`. The conclusion was not to introduce it; the load evidence the spec asks for comes from the scenario reports, and should a genuine hot-path pure function appear, the same section's process covers adding one.

## 6. Run this chapter's checks

```bash
just perf-load        # Any load command completing verifies this chapter's chain
just check            # The main gate contains no load scenarios — by design
```

The post-removal behavior is accepted by the [removal tooling tests](../../tests/tooling/example-remove.test.mjs) and the removal CI; the load commands' honest exit follows the same pattern as `production-smoke`.
