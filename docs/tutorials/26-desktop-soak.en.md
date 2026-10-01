# Verify resource trends for an optional desktop client

Desktop Soak is needed when you provide an Electron client. Backend documentation, HTTP contracts and the static documentation site do not depend on it. This guide observes RSS, JS heap, DOM nodes and listeners while a real shell repeatedly uses shared pages. Growth is report evidence; one soak cannot establish a leak.

Prerequisites are an [Electron shell](20-electron-shell.md) loading your Web pages, verified backend contracts, Docker, pnpm and a display or xvfb. Run commands from the repository root.

## Verify collection first

```bash
DESKTOP_SOAK_DURATION_SECS=25 just perf-desktop-soak
```

The current [runner](../../scripts/perf/desktop-soak.mjs) creates isolated PostgreSQL/Redis/RustFS/Mailpit, API/Web and a temporary user directory. It seeds knowledge data through HTTP and launches real Electron. It removes its own containers, volumes and user directory afterward without using development data.

Success writes `.scratch/perf/desktop-soak-report.json` with raw series, aggregates, growth observations, git SHA, desktop/Electron versions and sampling configuration. A short run establishes wiring and collection, not long-term stability.

## Adapt the cycle to your pages

The current [collection scenario](../../tests/desktop/soak.spec.ts) runs list, detail, attachment refresh/download/upload, deletion of the new attachment, opening/canceling a dialog, sampling and return to the list. For your business:

1. Seed fixed-size data through public APIs, then sign in and navigate through real pages.
2. Pick the heaviest repeatable screen for sampling, such as details after file and task panels load.
3. Clean up each cycle's additions so dataset growth cannot masquerade as resource growth.
4. Preserve real downloads, requests and component lifecycles; adapt selectors and business actions.
5. Register scenario/collector ownership so removing a business does not leave invalid entries.

## Measurement boundaries

| Metric           | Source                                                       | Limit                                                                                         |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `rendererRssKiB` | Renderer working set from main-process `app.getAppMetrics()` | Includes Chromium and allocator behavior; growth is not necessarily a JS leak                 |
| `heapKiB`        | `performance.memory.usedJSHeapSize`                          | GC causes fluctuations; unavailable values are null                                           |
| `domNodes`       | Current document's element count                             | Samples need comparable page state                                                            |
| `listeners`      | Net EventTarget registrations through a wrapper              | Long-lived targets only, such as window/document/body/root; not a complete listener inventory |

The counter deduplicates target, event type, capture phase and listener, and accounts for `once` and AbortSignal removal. The initialization script measures the client without changing production business code.

## Run longer, repeat and diagnose

```bash
DESKTOP_SOAK_DURATION_SECS=3600 just perf-desktop-soak
```

Defaults are a 300-second cycle, `DESKTOP_SOAK_WARMUP_SECS=15` and `DESKTOP_SOAK_SAMPLE_MS=2000`. `PERF_SCALE` controls current reference data size. Warmup lets initial hydration and lazy loading finish before steady sampling.

[Report shaping](../../scripts/perf/desktop-report.mjs) compares first/last-quartile medians. Growth above 25% produces `growthNotes` without changing exit status. Repeat with the same revision and scale to distinguish in-run allocation, GC and accumulation across runs; keep raw points and environment metadata. Startup or page assertion failures still fail the command and must be fixed before interpreting a curve.

```bash
node --test tests/tooling/desktop-soak-report.test.mjs
```

This deterministic report check is part of daily validation. Real GUI smoke and soak belong to client milestones and nightly runs; soak is outside ordinary PR `just check`. Knowledge removal deletes its current scenario and runner, leaving the original recipe pointing to a removed script. Generic report shaping remains. Rebuild your business runner and collection scenario, then update the recipe before running soak.

Next: [Contribute your pages to the application shell](27-add-example.md).
