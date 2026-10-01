# Establish deterministic budgets for business endpoints

Express a Performance Contract as rows, database round trips and response bytes. Extra side effects, N+1 queries and large bodies in lists then become explicit failures as the business evolves. Cross-machine P95/P99 belongs in separate [load reports](25-load-reports.md).

This guide requires an HTTP-tested business, real PostgreSQL and installed dependencies. Run commands from the repository root; tests use isolated databases.

## Define budgets through real HTTP operations

Run the existing implementations:

```bash
node scripts/test-backend.mjs --test perf_registration --test perf_documents
```

| Public operation        | Current assertion                                                                                                   | Source                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Successful registration | 1 User, 1 Credential, 1 active Membership and 1 registration Audit; Session counted separately; no Job/Notification | [perf_registration.rs](../../apps/api/tests/perf_registration.rs) |
| Duplicate registration  | 409 without duplicate user or audit writes                                                                          | Same file                                                         |
| Document list           | At most 4 database round trips as data grows; at most 256 KiB, no body text                                         | [perf_documents.rs](../../apps/api/tests/perf_documents.rs)       |
| Creation or export      | Exact business, Audit, Job and notification-intent counts; replay adds no side effects                              | Same file                                                         |

Add `apps/api/tests/perf_<business>.rs` using the real Router and `#[sqlx::test(migrations = "../../migrations")]`. Make the HTTP operation, then compare row counts before and after it. Rejections and idempotent replay must add no writes. Seed small and large datasets for lists and compare round trips and response bytes rather than checking only an empty database.

Table counting is a dedicated performance observation interface. Ordinary behavior tests still verify public HTTP outcomes. Audit/Job counts describe the side-effect contract; business implementations must use their public APIs rather than their private tables.

## Count executed queries

The document budget counts real sqlx statements through `sqlx::query` tracing events. The full subscriber is in [perf_documents.rs](../../apps/api/tests/perf_documents.rs). It accounts for callsite interest caching and isolates counts by test thread. Preserve that isolation when reusing it instead of assigning all concurrent-test queries to one request.

If new business code moves queries into spawned tasks, first verify that the measurement includes that execution path. A passing count does not establish coverage of every dynamic query or runtime configuration.

## Client bundle budgets

A backend project needs this only when adding a Web client:

```bash
node scripts/perf-bundle.mjs
```

The tool builds Web and measures gzip bytes against [baselines.json](../../scripts/perf/baselines.json). Current limits are 400 KiB for the initial set and 500 KiB per asynchronous chunk; Markdown, design-system and icon catalog must remain lazy. The initial set includes both entry scripts and modulepreload dependencies. Reports go to `.scratch/perf/bundle-report.json`.

## Query plans provide diagnostic evidence

```bash
node scripts/perf-query-plans.mjs
```

The tool runs reference-business `EXPLAIN ANALYZE` queries in a disposable database at 10 / 1,000 / 100,000 rows and writes `.scratch/perf/query-plans.json`. Add equivalent seeding and plans for your hot queries, keeping SQL aligned with implementation. Plans and timing are reports: neither a Seq Scan nor an individual millisecond value is an automatic failure. Inlined literals can also produce different plans from sqlx prepared statements.

## Integrate checks and adjust baselines

```bash
just perf
just perf-ci
```

`just perf` runs existing budget tests, bundle gates and query-plan reports; add a new test name to its focused recipe. The full backend suite discovers new integration tests. `just check` covers deterministic budgets through `just test` and `perf-ci`, without implicitly running load or desktop soak scenarios.

On failure, inspect additional writes, N+1 queries, list projections and static imports. A justified budget change needs complete before/after measurements, reasoning and old/new thresholds in the same PR, with the baseline updated. Do not silently raise a limit in the change introducing the regression.

Registration budgets, bundle measurement and generic reporting belong to Core. Document budgets disappear with the knowledge example; its query-plan tool explains and exits when the example is absent. Register ownership and budgets for your own business. Passing reference checks cannot substitute for them.

Next: [Write controlled load scenarios for your hot paths](25-load-reports.md).
