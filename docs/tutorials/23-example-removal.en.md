# Compose and remove reference examples

The template ships two reference examples: the knowledge base (a full business) and notes (a minimal example that exists only to prove the composition interface). This chapter answers "how does this template become my product": first see what an example owns, then preview a removal, delete **any one** example, or remove all the way down to zero — source, routes, migration registration, jobs and tutorial navigation disappear together, while Core (registration/login, members, file service, jobs, notifications, API keys, audit, mail, rate limiting, telemetry) stays intact and keeps being verified. For the frontend wiring and how the four app combinations run, see [Add a reference example](27-add-example.en.md); this chapter focuses on the removal side: tooling, protections and boundaries.

## 1. The ownership manifest: what an example actually owns

Each example registers five kinds of information in `examples/<id>/manifest.json`, and every kind is pinned by a checker. Take the [knowledge base](../../examples/knowledge-base/manifest.json) and [notes](../../examples/notes/manifest.json) manifests:

| Item                     | Content                                                                                         | Enforced by                               |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ownedPaths`             | Backend modules, views, migrations, tests, E2E and tutorial pages the example deletes wholesale | `pnpm boundaries:check`, manifest tests   |
| `registrationMarkers`    | `example:<prefix>:*:start/end` registration blocks in the assembly files                        | Same, must be intact pairs                |
| `compositionPoints`      | Files that must be edited (not deleted): API/Worker/Web/docs navigation                         | Existence check                           |
| `ownedDependencies`      | npm dependencies only this example uses (such as react-markdown)                                | Stripped from the package.json on removal |
| `ownedCargoDependencies` | Rust dependencies only this example uses (zip, pulldown-cmark)                                  | Stripped from the Cargo.toml on removal   |

Exclusivity is a hard constraint: two examples claiming the same `ownedPaths` entry, or the same exclusive dependency in the same manifest, is an ownership conflict the removal tool could never adjudicate, so verification fails right there and names both sides — and the removal command runs that same verification before touching a single byte. The reverse holds too: Core modules (including the later mail and telemetry modules) **never import an example**, and examples never reference each other — not even via the shared views barrel. `boundaries:check` scans import directions, table ownership inside SQL strings and cross-module view references file by file; shortcuts like writing an example into Identity fail at the checker. Every module's `module.json` declares its own tables (such as `knowledge.documents`), and every table appearing in a migration must have an owner.

## 2. Dry-run: see exactly what would happen first

```bash
just example-remove --dry-run                                  # removes the knowledge example by default
node scripts/example-remove.mjs --example notes --dry-run     # or remove notes
```

The [removal tool](../../scripts/example-remove.mjs) lists every path it would delete, every marker block it would strip, the tutorial pages that would leave the navigation, the dependencies it would prune and the regeneration commands to rerun afterwards — **without writing anything**. Pick the example explicitly with `--example <id>`; an unknown id fails immediately with the list of registered ids, never silently acting on "the closest match".

The protections are hard, and a refusal hands you a list instead of an overwrite: uncommitted changes are listed and the tool refuses to touch a byte; a registration marker block edited out of an intact start/end pair is refused with its location. The tool only operates on clean git working copies — the same care protects your customizations: commit or discard your changes first, or untangle the parts interwoven with the example.

## 3. Remove any one example, or all the way to zero

```bash
just example-remove                                       # remove knowledge → notes only
node scripts/example-remove.mjs --example notes          # remove notes → knowledge only
```

The tool executes exactly what the manifest describes: it deletes the owned paths, strips the marker blocks from the assembly points (routes and OpenAPI registration in `apps/api/src/lib.rs`, job registration in `apps/worker/src/main.rs`, web routes and view exports, tutorial navigation), removes the tutorial page from `docs/site.json`, prunes the example-exclusive dependencies, sets the manifest to `status: removed` (the manifest itself stays — scripts like desktop-smoke adapt by it), and finally regenerates the derived artifacts in place: `pnpm install`, `cargo update --workspace`, `pnpm generate` (OpenAPI/contracts/SDK) and the project docs references.

To remove several examples, run them **one at a time and commit the copy between removals** — the tool only edits clean copies, which is also how it protects you. Once every example is gone only Core remains and login lands on the universal home; when the example declaring the default entry is removed (the knowledge example's "My documents" today), the login landing falls back to the universal home just as naturally, with no entry left pointing at a deleted page. Every removal is accepted against the same gates:

```bash
just check-core    # fmt, clippy, backend tests, contracts drift, boundary checks
just docs-build    # the docs site build; dead links surface here
pnpm typecheck && pnpm test:frontend && pnpm --filter @saas/web build && pnpm boundaries:check
```

Migration history has two paths, and the tool defaults to the **conservative** one:

- **Projects whose migrations have run or shipped**: do nothing. The example-owned migrations stay exactly as they are, with the `_sqlx_migrations` history intact — removing source code never means deleting business data; the tables those migrations describe stay in the database until you handle them explicitly with a **new migration**. The retention path also registers these files under the manifest's `retainedMigrations`: their tables no longer have a code owner, so the table-ownership checker exempts exactly those historical files while the "every table must have an owner" rule keeps applying to everything else.
- **Brand-new projects (no database yet)**: `just example-remove --trim-migrations` cuts the example migrations out so a fresh empty database initializes from the Core migrations alone. Trimming is only legitimate for copies that never applied these migrations; the CI removal acceptance takes this path and verifies it against a real empty database.

## 4. What Core keeps, and what leaves

Registration/login and sessions, organization members, the file service and object cleanup, jobs and recovery, notifications, API keys, audit, password-reset mail, rate limiting, telemetry — all stay, each pinned by tests: `just check-core` after a removal runs exactly these surviving tests (`registration`, `members`, `jobs`, `config`, `migration`). The mail and telemetry modules are in no `ownedPath`, which the handover notes call out as an acceptance point.

History does not vanish with the source: notifications pointing at a removed business show "this feature is currently unavailable" instead of a clickable target, and old bookmarks or external deep links land on the "this feature is currently unavailable" page, which keeps an explicit way back home — the address is never rewritten silently. The production tooling layers cleanly: `production-backup` and `production-restore` are business-agnostic (they only speak database and object inventory) and work as usual after a removal; the seeded journeys of `production-smoke` and `production-restore-drill` ride on example data, so after a removal they say so honestly and exit, inviting you to write your own drill on the same skeleton — the backup data plane is unchanged; only the journey is.

Performance budgets layer along the same line: the registration budget (`perf_registration.rs`) belongs to Core and stays pinned by backend tests after a removal; the document list/create/export budgets (`perf_documents.rs`) and the example list SQL in the query-plan scripts leave with the example — swap in your own business's performance tests for `just perf`, and the query-plan scripts in `just perf-ci` say so honestly and exit.

CI rehearses all of this on every PR: it clones the template into a temporary copy and dirties a file to verify the protection refuses; in the first copy it actually runs the removal with `--trim-migrations`, producing the notes-only combination against the full gate set, then removes notes in that same copy for the Core-only combination and reruns the frontend gates; in a second copy it removes notes for the knowledge-only combination, also against the full gate set. Together with the untouched main source (the dual combination, fully verified by the `verify` job), all four combinations are built and tested — before the job finishes with the next section's wiring exercise.

## 5. Wire in your own business

Deleting an example is only the beginning; the tutorial's promise is "a new business joins through the same public interfaces". For the frontend pages and navigation, see [Add a reference example](27-add-example.en.md); the backend follows these steps:

1. **Your own model and migration**: create `migrations/00XX_<business>.sql`, create your schema and tables, and register table ownership in `module.json` (`boundaries:check` requires every table to have an owner; referencing stable Core identifiers like `saas_core.users(id)` is an allowed cross-module reference).
2. **Implement the module**: declare it in `crates/app/src/modules/mod.rs` and write the HTTP handlers (get the current user with `identity::require_session`) and domain queries in `crates/app/src/modules/<business>/`; a module never touches another module's private tables. Keep identifiers as strings and convert explicitly at the SQL boundary (`$1::uuid`, `RETURNING id::text`) — the workspace's sqlx does not enable the uuid codec feature.
3. **Register routes and OpenAPI**: merge the module's router into `domain_routes` and its openapi() into the docs at the assembly point in `apps/api/src/lib.rs`.
4. **Generate the SDK**: `pnpm generate` puts your resource types into contracts/SDK.
5. **Test**: assert register → create → read over the public HTTP interface like `apps/api/tests/notes.rs` does (`#[sqlx::test]` needs a PostgreSQL; `just test-backend` brings a disposable instance).

The exercise script (`scripts/example-new-business.mjs`) writes these files into a temporary copy for you and runs `cargo test` and clippy through [the same test-postgres channel](../../scripts/lib/postgres.mjs) — a green CI run is the executable proof that the wiring path works after a removal.

## 6. Run this chapter's checks

```bash
node --test tests/tooling/example-remove.test.mjs
just example-remove --dry-run
just check
```

Drift between the manifests and the working copy is pinned at two layers: `boundaries:check` verifies the registered paths, their exclusivity and the marker blocks on every `just check`, and the [manifest tooling tests](../../tests/tooling/example-remove.test.mjs) verify the removal semantics themselves on a synthetic copy — zero-write dry-runs, exact deletions and marker edits, refusals for unknown ids and ownership conflicts, navigation trimming, dependency stripping, migrations retained by default versus `--trim-migrations`, and the refusal of dirty copies and structurally broken markers. The real removal acceptance runs end to end on a fresh copy in the CI `example-removal` job.
