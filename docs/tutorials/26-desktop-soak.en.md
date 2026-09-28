# Walkthrough: Desktop shell resource soak

The [previous chapter](./25-load-reports.md) observed server-side throughput, saturation and queue trends under load; this chapter turns the camera to the other end — the renderer process inside the [Electron shell](./20-electron-shell.md). What slows a desktop app down is rarely a single click; it is "open all day": DOM nodes accumulating, listeners piling up, memory creeping. The desktop soak uses the real shell and the real shared pages to answer one question: **what does the renderer's resource curve look like after an hour of cyclic use**. It obeys the same three rules as the load reports: only a disposable stack is stressed; output is produced on nightly runs and version releases and never enters an ordinary PR gate; growth observations only describe trends — **a single soak is never a leak verdict**.

## 1. A temporary stack, a clean shell

[desktop-soak.mjs](../../scripts/perf/desktop-soak.mjs) reuses the desktop smoke's disposable stack: test PostgreSQL, Redis, RustFS and Mailpit all come up as isolated containers, the API and web dev servers bind free ports, and everything is destroyed with the containers when done — your development data is never touched. Rate limiting on the stack is relaxed together with the Redis-degradation fallback: the browsing loop fires hundreds of session and list requests per minute, and the soak observes the renderer, not the limiter — the same reasoning as the [controlled load stack](./25-load-reports.md). [fixtures.mjs](../../scripts/perf/fixtures.mjs) seeds controlled data through the public HTTP interfaces (default 6 users × 8 documents, some with attachments).

The shell itself starts with a test user directory (`SAAS_DESKTOP_USER_DATA_DIR` pointing at a disposable one); signing in, browsing, uploading and downloading, opening and closing dialogs all go through the [real shared pages](./20-electron-shell.md) — the desktop soak injects no test stubs into the page, it simulates exactly a real user opening and closing things. After the knowledge-base example is removed there are no pages to walk, so the command explains honestly and exits before starting work (the same pattern as the load commands), while the report shaping and the practices recorded in this chapter keep working (see the removal boundary in §5).

## 2. Scenario and sampling: where the metrics come from

Every step of the loop is a real user action: open a document from the list → refresh the attachments panel → if it has attachments, click one download → upload this round's unique attachment, confirm it appears, then **delete it immediately** → open the "delete document" confirm dialog and cancel → sample → back to the list, next document. Upload, download and delete all take the real hash, progress and storage round-trips, but "upload then delete" keeps the dataset **flat** — the loop cannot keep feeding the page while observing "did the page grow", otherwise it measures its own increments instead of the shell's trend. The sample lands with the **document detail page lit and the dialog just closed** — the heaviest screen of the loop (Markdown preview, export panel and attachments panel all mounted).

| Metric           | How it is collected                                                                                               | How to read it                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `rendererRssKiB` | Working set of the renderer process in the main process's `app.getAppMetrics()` (Electron 44 reports it as `Tab`) | The process's real memory footprint               |
| `heapKiB`        | The renderer's `performance.memory.usedJSHeapSize`                                                                | JS heap; fluctuation with page switches is normal |
| `domNodes`       | `document.getElementsByTagName('*').length`                                                                       | Nodes mounted on the detail page                  |
| `listeners`      | **Net registrations** counted by an init script wrapping `EventTarget` (long-lived targets only)                  | A proxy for listener pressure                     |

The listener count deserves expansion: it only counts **long-lived targets** — `window`, `document`, `body`, the root container — because listener leaks accumulate exactly there; registrations on short-lived targets (each request's AbortSignal, throwaway elements) are reclaimed together with their targets and would be pure noise on an identity counter, so they are excluded by construction. The wrapper deduplicates by "target + type + capture phase" (matching DOM semantics), `once` listeners are billed out after firing, and listeners registered with an `AbortSignal` are billed out when the signal aborts. It is a proxy for EventTarget API usage on long-lived targets, not an exhaustive audit — enough to see an "accumulating" trend, not to be read as a precise inventory.

The warmup (default 15 seconds, `DESKTOP_SOAK_WARMUP_SECS`) lets the first paint, hydration and route-level lazy chunks settle, so the series starts from steady state instead of a cold start. The report also records the warmup duration, sampling duration, sampling interval and the running versions (git SHA, desktop package version, Electron version).

## 3. Reading the report: time series and growth observations

Every command writes `.scratch/perf/desktop-soak-report.json`:

- **Raw time series**: all four metrics at every sample point are kept in full — when a trend looks suspicious, you can go back to the exact moment.
- **Aggregates**: min / avg / max per metric.
- **Growth observations** (`growthNotes`): the series is compared first versus last quartile, and an observation is recorded when a metric's last-quartile median exceeds the first-quartile median by 25%. The wording is "this run observed growth; rerun to confirm" — **rerunning is part of the process, not a pleasantry**: a single GC pause or one background task can fake a trend in one run, and only several consecutive runs growing in the same direction justify an issue.

A growth observation never changes the command's exit code — it is report material, not a gate.

## 4. Where to run it and how to tune it

```bash
just perf-desktop-soak
```

The prerequisites are only `pnpm install` (the shell's Electron binary downloads on first require; the command bootstraps it) and a display or xvfb. Stack, shell and data directory are all managed automatically, containers destroyed when done:

| Variable                     | Default | Purpose                                   |
| ---------------------------- | ------- | ----------------------------------------- |
| `DESKTOP_SOAK_DURATION_SECS` | `300`   | Loop duration (seconds, excluding warmup) |
| `DESKTOP_SOAK_WARMUP_SECS`   | `15`    | Warmup duration (seconds)                 |
| `DESKTOP_SOAK_SAMPLE_MS`     | `2000`  | Sampling interval (milliseconds)          |
| `PERF_SCALE`                 | `sm`    | Seeding scale tier (sm / md / lg)         |

[perf-nightly.yml](../../.github/workflows/perf-nightly.yml) runs the desktop soak with xvfb on nightly (and manual, release) triggers, keeping the report artifact for 30 days. Ordinary PRs never run it — on PRs there is only the [deterministic gate](./24-perf-gates.md).

## 5. The baseline measurements and where things go after example removal

The baseline is archived below (local x86_64 WSL2, default sm tier, 300-second loop, 2-second sampling; numbers drift with machine — the archive gives later readers a comparison point, not a promise on any machine):

| Metric           | min–max               | First-quartile median | Last-quartile median | Growth observation |
| ---------------- | --------------------- | --------------------- | -------------------- | ------------------ |
| `rendererRssKiB` | 256,772 – 461,248 KiB | 313,980               | 453,192              | +44.3%             |
| `heapKiB`        | 44,253 – 88,200 KiB   | 56,213                | 71,623               | +27.4%             |
| `domNodes`       | 61 – 74               | —                     | —                    | none               |
| `listeners`      | 293 – 295             | —                     | —                    | none               |

(Electron 44.4.5; environment as above.) Reading per §3: of this run's four metrics, listeners stayed pinned at 293–295 and DOM nodes round-tripped between 61 and 74 with page switches — these two flat curves are the direct evidence that "the loop is not accumulating anything". RSS and the JS heap triggered growth observations; look at the shapes: the heap oscillates between 44–88 MiB with GC rather than climbing monotonically; RSS ratchets slowly from about 250 MB to about 460 MB — the upload/download loop brings constant allocation noise, and without memory pressure the allocator does not rush to return physical pages. This shape **describes** this run's behavior but is not enough to **assert** any trend. Per the rules, the next step is a back-to-back rerun on the same machine: if every round starts near 250 MB, the climb is within-round allocation behavior; if the starting points rise round over round, cross-round accumulation would justify an issue. The full report (raw time series and run versions included) is written by the command to `.scratch/perf/desktop-soak-report.json` and never committed.

The removal boundary is the same line as the [load reports](./25-load-reports.md): the browsing scenario rides on the knowledge-base example's shared pages, and both the scenario and the collection code (`tests/desktop/soak.spec.ts`, `scripts/perf/desktop-soak.mjs`) are registered in the example ownership manifest, removed with the example, after which `just perf-desktop-soak` explains honestly and exits before starting work. What remains is twofold: the business-agnostic report shaping — the aggregation and growth observations of [desktop-report.mjs](../../scripts/perf/desktop-report.mjs), not in the manifest and working after removal — and the practices recorded in this chapter themselves: net listener counting over long-lived targets only, reading the renderer from the main process's `getAppMetrics()`, sampling on the heaviest screen, and no leak verdicts without a rerun. When modeling your own desktop app, rebuild your collection and scenario from these semantics.

## 6. Run this chapter's checks

```bash
DESKTOP_SOAK_DURATION_SECS=25 just perf-desktop-soak  # Accept the chain with a short loop first, then run the long one
just perf-desktop-soak          # Any soak run completing verifies this chapter's chain
just check                      # The main gate contains no desktop soak — by design
```

The deterministic parts of collection and reporting (aggregation, the growth-observation decision boundary) are accepted by `tests/tooling/desktop-soak-report.test.mjs` inside `just check`; the shell smoke (`just desktop-smoke`) guarantees the pages and selectors the soak drives really work in CI.
