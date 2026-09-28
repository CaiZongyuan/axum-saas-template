# Walkthrough: Deterministic performance gates

This chapter answers "how does this template keep performance from silently regressing". The template does not run stopwatches: wall-clock time jitters on shared CI machines, and a load-test report cannot be a gate for every commit. [Spec §17](../saas-template-architecture-spec.md) instead writes performance as a **[performance contract](../../CONTEXT.md)** — how many rows one operation may write, how many database round-trips it may take, how large a payload it may return, how heavy the build output may be — and has every CI verify by rows, counts and bytes. These numbers either pass or fail; never "it depends". Load, saturation and soak are reporting work for later milestones, not gates in this version.

## 1. The budget contract: two test lists

The budgets are pinned in integration tests that go through exactly the same public HTTP interfaces as every other behavior test:

| File                                                              | Ownership                                                                                     | What it pins                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [perf_registration.rs](../../apps/api/tests/perf_registration.rs) | Core (still enforced after example removal)                                                   | A `201` registration writes exactly 1 user + 1 credential + 1 active membership + 1 `identity.register` audit; sessions are a separate contract counted separately; 0 jobs, 0 notifications; a duplicate registration returns 409 and writes nothing                                                                                                          |
| [perf_documents.rs](../../apps/api/tests/perf_documents.rs)       | Example (registered in the [ownership manifest](../../examples/knowledge-base/manifest.json)) | Document list round-trips do not grow with data volume (cap 4, no N+1); list payloads ≤256 KiB and never carry bodies; create = +1 document +1 audit, with first personal-library preparation happening exactly once (even under concurrency); an export request = 1 export + 1 job + 1 audit + 1 intent row, and an idempotent replay produces no duplicates |

Every test is a row-count assertion, not a timing assertion: `SELECT count(*)` asks the database directly "what did this operation actually write". Rejection paths have budgets too — a duplicate registration writes zero rows, an export replay produces no duplicate side effects.

Round-trip counts are not estimated. sqlx emits every executed statement as a `sqlx::query` event, and the tests install a subscriber that counts events for an exact number. One pitfall worth recording: tracing's interest cache is finalized the first time a callsite fires, so in parallel tests a callsite that fires first can be cached as "never", silencing the whole process afterwards — the tests therefore install a **global** subscriber (unconditionally reporting `Interest::sometimes`) and count by thread id to bypass the cache.

## 2. The bundle gate

The bundle gate [perf-bundle.mjs](../../scripts/perf-bundle.mjs) is the first half of `just perf-ci`: it really runs `vite build`, measures every chunk's gzip size, and compares against the [deterministic budgets](../../CONTEXT.md) in [baselines.json](../../scripts/perf/baselines.json) — initial bundle ≤400 KiB gzip, async chunks ≤500 KiB, and `markdown` must be a lazy chunk. The report lands in `.scratch/perf/bundle-report.json`; anything over budget fails with every violation listed. The "initial set" is taken from index.html's `<script>` tags **plus modulepreload links** — chunks statically imported by the entry may not disguise themselves as async chunks to hide in the more lenient half of the budget.

Current measurements: initial 174.4 KiB (`index.js`), lazy 46.7 KiB (`markdown-content.js`). The budgets keep roughly double headroom — they do not skim the ground at today's sizes.

## 3. Baseline adjustment: how budgets change

Budgets are human-set and will be adjusted, but there is exactly one legitimate path: **measurement evidence and rationale in the same PR**. Raising a budget in the same change that introduced the regression to let the gate pass is precisely what this rule forbids — the point of a gate is that the regression gets seen and discussed. Steps:

1. Take complete before/after measurements with `just perf` (budget tests + bundle + query-plan report).
2. Change both the budget values and the `firstMeasured` records in baselines.json, stating where the new numbers come from.
3. Show the comparison in the PR description: old budget, old measurement, new budget, new measurement.

## 4. The query-plan report: evidence, not a gate

The second half of `just perf-ci` is [perf-query-plans.mjs](../../scripts/perf-query-plans.mjs): in a disposable database it seeds 10 / 1,000 / 100,000 rows, runs `EXPLAIN ANALYZE` for the two list shapes, and writes what the planner actually did into `.scratch/perf/query-plans.json`. The SQL mirrors `list_documents` (a keep-in-sync comment marks it in the script); the report **only records, never fails** — spec §17.2 says it plainly: not every Seq Scan is wrong. One reading note: psql inlines parameters as literals, so the planner's choices may differ slightly from sqlx's prepared-statement path — this report is about shapes and magnitudes, not a replay of the production path.

The first baseline honestly records a counter-intuitive fact (local measurements; they drift with machine and data distribution — the point of a baseline is a comparable starting point, not a promise of these milliseconds):

| Tier         | Personal list       | Per-library list     |
| ------------ | ------------------- | -------------------- |
| 10 rows      | 0.1 ms, 1 Seq Scan  | 0.23 ms, 1 Seq Scan  |
| 1,000 rows   | 0.74 ms, 1 Seq Scan | 0.27 ms, 0 Seq Scans |
| 100,000 rows | 56.6 ms, 1 Seq Scan | 0.27 ms, 0 Seq Scans |

The per-library list uses the index throughout (Incremental Sort + Nested Loop + Index Only Scan) with a flat cost. At 100,000 rows the planner picks Seq Scan + top-N sort for the personal list: with a single-user `'%'` pattern it considers that fastest, and even 100,000 rows take about 57 ms — this version records it as-is, neither fixing nor blocking; when that number becomes worth acting on, a PR carrying the report decides. That is exactly the division of labor between a report and a gate.

## 5. Where it runs, and what survives example removal

```bash
just perf      # Prints the command index and baseline pointer, then runs the full deterministic evidence: budget tests + bundle gate + query-plan report
just perf-ci   # Bundle gate + query-plan report; included in just check (the main gate of spec §21 covers perf-ci)
```

The budget tests run with `just test`'s backend suite; `just check` calls `just perf-ci`, so the main gate covers every deterministic performance budget. CI has no separate perf step — once `just check` passes, `.scratch/perf/` is uploaded as a 7-day `perf-report` artifact for reviewers to browse.

Ownership after example removal: the registration budget is Core and stays pinned by `just check`; the document budgets and the seeded query shapes leave with the example; the query-plan script says so honestly and exits, pointing you at the same skeleton to EXPLAIN your own business's hot queries (see [removing the example](./23-example-removal.md)). When writing budgets for a new business, reuse the same shapes — row-count assertions, statement counts, byte caps — the performance contract's structure needs no reinvention.
