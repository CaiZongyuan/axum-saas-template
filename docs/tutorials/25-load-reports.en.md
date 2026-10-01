# Write load and capacity reports for your business

After deterministic budgets pass, use a Controlled Load Stack to observe throughput, latency, errors, connection pools, queues and process memory through real requests. Compare reports during nightly runs and releases; cross-machine wall-clock numbers are not ordinary PR gates.

You need Docker, the Rust release toolchain, installed pnpm dependencies and [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/). Run commands from the repository root without connecting to existing development or production databases. Current scenarios call the knowledge reference API; replace their data and requests to measure your own business.

## Run one controlled scenario

```bash
PERF_VUS=2 PERF_DURATION=20 just perf-load
```

The [runner](../../scripts/perf/run-scenario.mjs) uses the [controlled stack](../../scripts/perf/stack.mjs): Compose project `saas-perf`, dynamic free ports, project-scoped volumes and host release API/Worker binaries. It removes its volumes afterward. `PERF_STACK_KEEP=1` preserves the stack for diagnosis and prints cleanup instructions. Its fixed project name means two load commands must not run concurrently in the same environment.

Success writes `.scratch/perf/load-report.json` with environment, fixtures, k6 metrics and stack samples. Missing k6, dependency failures or excessive real errors in steady scenarios fail the command. Keep failure reports for diagnosis too.

The capacity stack widens Redis and local-fallback rate limits so default throttling does not mask capacity. Reports record the effective configuration and count 429/`rate_limit.exceeded` separately as expected throttles. Assess production rate limits in a separate, explicitly configured run.

## Write a scenario for your API

Create `scripts/perf/k6/readiness.js` to check an existing framework endpoint. This complete k6 file reuses the [public HTTP helpers](../../scripts/perf/k6/lib.js):

```js
import http from 'k6/http';
import { call, scenarioOptions, writeSummary } from './lib.js';

export const options = scenarioOptions({ vus: 2, duration: '20s' });

export default function () {
  call('readiness', 200, () => http.get(`${__ENV.PERF_BASE_URL}/health/ready`));
}

export const handleSummary = writeSummary({
  description: 'backend readiness under controlled load',
});
```

Add its file, concurrency, duration and seed policy to runner `SCENARIOS`:

```js
readiness: { file: 'readiness.js', seed: false, vus: 2, durationSecs: 20 },
```

```bash
node scripts/perf/run-scenario.mjs readiness
```

Expect `.scratch/perf/readiness-report.json`, 200 health responses and no business errors. Then model business scenarios on [load.js](../../scripts/perf/k6/load.js).

The runner supplies `PERF_BASE_URL` and `PERF_SUMMARY`; do not hard-code a production address. Replace readiness with implemented hot paths: authenticated lists, details, occasional writes, conflict recovery and task results. Reuse Origin, Session Cookie, CSRF and random idempotency keys. Explicitly recover expected conflicts instead of misclassifying them as capacity errors or ignoring them.

Current [fixtures.mjs](../../scripts/perf/fixtures.mjs) seeds accounts, documents and attachments through public APIs. Seed your business the same way and report user/resource counts, file sizes and actual successful creation counts. Direct SQL would bypass rules the scenario is meant to exercise.

## Choose scenarios and scale

| Command                | Observation                                                    | Current default                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------------- |
| `just perf-load`       | Read-heavy steady traffic                                      | 4 VU, 60 seconds                |
| `just perf-saturation` | Concurrency ladder and throughput transition                   | 1/4/8/16/32 VU, 20 seconds each |
| `just perf-trajectory` | Registration, writes, conflicts, files, Jobs and notifications | 2 VU, 60 seconds                |
| `just perf-soak`       | Long-running low-concurrency queue and memory trends           | 2 VU, 600 seconds               |

`PERF_SCALE=sm|md|lg` chooses the dataset tier. `PERF_USERS` and `PERF_DOCS_PER_USER` override current reference counts. `PERF_VUS` and `PERF_DURATION` (numeric seconds) control steady scenarios; `PERF_STEPS` and `PERF_STEP_SECS` control saturation. `PERF_SAMPLE_MS` defaults to 2000 milliseconds. Keep scale variables and report metadata aligned with your added business.

## Read reports and handle failure

Inspect `business_errors`, its 4xx/5xx split and expected throttles before comparing throughput and P50/P95/P99. Steady scenarios have an error-count ceiling; exceeding it describes a failed run. Saturation intentionally crosses capacity and does not fail because its top step returns errors. `plateauFromVUs` merely highlights the first step reaching 90% of the best throughput; it is not an SLA.

Every two seconds the stack samples database connections, queue depth by Job state and API/Worker RSS. Keep raw series, distinguish temporary backlog from persistent growth, and repeat with the same source, scale and machine. No growth in one short soak cannot prove absence of leaks.

Nightly configuration lives in [perf-nightly.yml](../../.github/workflows/perf-nightly.yml) and preserves report artifacts. Ordinary `just check` does not run these scenarios. After example removal, current commands explain and exit before startup. The controlled stack, sampling and [report shaping](../../scripts/perf/report.mjs) remain; update the runner's example precondition when wiring your business.

Next: return to [deployment](21-single-machine-production.md) for backend delivery; read [desktop resource soak](26-desktop-soak.md) when providing an Electron client.
