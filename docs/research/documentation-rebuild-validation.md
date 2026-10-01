# Documentation rebuild validation

Date: 2026-10-01. Scope: DOC02-DOC05, following the accepted [documentation v2](../plans/documentation-rebuild.md).

The fixed review base is `e2df5399c4b9da982ab8e043578a50a75c40f885` (DOC01, PR #121). These checks include the task's uncommitted documentation, course fixtures, generators, ownership edits and CI changes on `docs/backend-course`. Unrelated staged skill installation and AGENTS branch guidance are excluded from the delivery.

## Runnable backend course

`pnpm tutorial:check` verifies the first module's declaration, both actual API constructors and OpenAPI in a temporary source copy, without a database.

`pnpm tutorial:course:check` installs and upgrades the four complete checkpoints from current source:

| Checkpoint | Evidence |
| --- | --- |
| module | Real embedded migrations, readiness, both API entries, HTTP/OpenAPI, Worker compilation and Rust formatting |
| crud | The same entry checks plus six HTTP behaviors: persistence, invalid input, idempotent replay/conflict, concurrent updates, Audit rollback and private/deleted-resource authorization |
| files | CRUD plus actual RustFS upload, verified completion, download byte comparison and ticket deletion/object cleanup |
| jobs | Files plus request-time snapshot, terminal notice, revoked original Session, stale-lease fencing, failed-notification publication rollback/retry and expiry cleanup |

All checkpoints passed. The jobs copy also compiles the complete Chinese and English notification/Audit functions extracted from their Markdown at the documented `crate::modules` location. Default application and Worker registration are unchanged; tickets exists only in teaching copies and fixtures.

The course installer has eleven passing behavior checks for current source (including deletions), stable isolated addresses and secrets, upgrades, migration history, refusal to overwrite changed files, symlink copying, dangling-link refusal, formatting and public configuration output.

## Local production recovery

`pnpm tutorial:recovery:check` built the course's production image and used the existing production Compose, backup and independent restore commands over verified localhost TLS. It checked complete ticket fields/version, actual attachment bytes/SHA-256, an export queued while Worker was stopped, restored Worker JSON and the terminal success notification.

The persistent [safe report](documentation-recovery-evidence.json) records ten PASS checks, the image digest, receipt digest, public resource identifiers and PASS cleanup. Both owned Compose projects, volumes, the unique image and temporary private data were removed. This evidence covers the local Caddy CA production composition, not a public domain or an operator's production machine.

## Documentation And CI

- `pnpm docs:check`: 119 files; source links, snippets, locale pairs, navigation and generated references passed. The command registry checked 100 just, 70 pnpm and 96 Node calls.
- `pnpm docs:build`: 118 pages and 119 distinct internal targets, including localized anchors, passed under `/axum-saas-template/`.
- `just e2e-docs`: fifteen static-site journeys and the custom-base smoke passed. The complete ten-lesson path, current-page language switching, search, theme persistence and narrow keyboard navigation were covered.
- Visual comparison: sidebar x=0 and width=264 at 1920px; 320px English jobs page had no page overflow and its heading stayed within the reading gutter. The site retained the accepted v2 layout.
- Actual knowledge removal with `--trim-migrations`: 105 documentation files, 104 built pages and 105 internal targets passed. All four retained course stages passed their 27 entry/HTTP/storage/job checks, Worker compilation, formatting and the four inline Core guide compilations. The trimmed manifest, assembly, Compose, lockfile and site declaration stayed unchanged while current independent course sources were synchronized; no knowledge source or migration was restored.
- CI scope and aggregation: eight tests passed, including renamed paths, unknown paths, required failures/cancellations and unexpected skips. Ordinary documentation selects website checks; teaching code selects its backend checks; client paths select Electron. Shared dependencies and CI changes select all checks conservatively. Publication requires successful verify and a checked website artifact.

Command checking validates registered literal recipe/script names and Node paths. It does not execute documentation commands or validate every shell argument, dynamic expression or external executable. Full public-domain deployment remains an operator task.

## Delivery Checks

`VITEST_MAX_WORKERS=4 just check` passed: Rust fmt/clippy, formatting/lint/types, contracts, boundaries, tooling/backend/View behavior, deterministic performance checks, client build and documentation build. The local worker limit changes runner concurrency, not assertions or production behavior.

Initial unconstrained runs had a migration-pool timeout and frontend wait timeouts under concurrent builds. The migration test and complete backend suite subsequently passed; the frontend suite passed with four workers (247 passed, four intentional skips). An earlier course build reused the template target concurrently and hit stale module artifacts; the course now uses a separate target directory and all stages passed afterward. These first failures are retained here rather than represented as uninterrupted success.

The reduce-complexity pass kept explicit ownership, Core transactions, leases and complete stage snapshots. It consolidated course SQL setup, shared generated command facts, and guarded source extraction boundaries. Further abstractions were not justified. Independent Standards and Spec reviews found and resolved self-crate imports, generated Rust formatting, dangling-link protection, inaccurate CI prose, missing command checks and missing ticket recovery evidence. Final refreshes reported no remaining findings.

## Whole Rebuild Survey

The wider survey covers pre-DOC01 revision `0b53e60ef0f0991768399aec41a29b2bdd00ddaa`, DOC01's reviewed commit/merge (`9d93c5b` / `e2df5399`), and the DOC02-DOC05 worktree. It follows the current site model, locale renderer, first-module/course checks, real Core consumers, example manifest, command references and CI jobs.

| Candidate | Evidence And Recommendation |
| --- | --- |
| Merge checkpoint sources | Retain. CRUD and files copies deliberately omit later tables/handlers; their independent compiled behaviors are validated. A conditional teaching module would move complexity into the reader's starting code. |
| Merge source-copy checkers | Defer. The first-module checker owns a database-free check, while the course installer owns protected persistent upgrades and isolated configuration. A shared current-source-copy helper may reduce maintenance later, but replacing either lifecycle is not required for this delivery. |
| Hand-maintain reference facts | Reject. API, settings and commands already come from OpenAPI, Rust FIELDS and task/package definitions; a second reference catalog would duplicate authority. |
| Collapse ownership and assembly markers | Reject. The actual knowledge removal and retained course prove that those boundaries serve different lifecycles. |

No additional behavior-preserving change with a justified maintenance benefit was needed after the local simplification pass. Optional consolidation does not weaken the completed course, removal or recovery checks.
