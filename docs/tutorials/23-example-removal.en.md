# Remove built-in business code while preserving SaaS Core

Remove the knowledge business from your template working copy while accounts, Memberships, Sessions, Files, Jobs, notifications, Audit, mail, API Keys, rate limiting and telemetry remain available to your SaaS. Example Removal changes source and derived artifacts; it does not delete production databases, objects or secrets.

You need a clean Git working copy and the installed toolchain. Run commands from the repository root. Save your edits or rehearse in an independent temporary copy before applying removal.

## Inspect ownership and preview

```bash
just example-remove --dry-run
```

The default id is `knowledge-base`. The [tool](../../scripts/example-remove.mjs) reads `examples/<id>/manifest.json` and lists paths, registration blocks, documentation entries, exclusive dependencies and regeneration commands without writing files.

| Manifest field                                 | Purpose                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `ownedPaths`                                   | Exclusive source, tests, migrations and bilingual teaching pages             |
| `registrationMarkers`                          | Paired `example:<prefix>:<marker>:start/end` blocks in shared assembly files |
| `compositionPoints`                            | API, Worker, Web and documentation entries to edit rather than delete        |
| `ownedDependencies` / `ownedCargoDependencies` | Dependencies exclusive to this business                                      |
| `retainedMigrations`                           | Historical migrations preserved after code removal                           |

Conflicting ownership, missing/duplicate markers, unknown ids and uncommitted changes prevent actual removal. Resolve ownership or save edits as reported; do not disable safeguards around your customizations.

## Choose a migration-history policy

For a project with applied or published migrations, use the default:

```bash
just example-remove
```

Business code and registration disappear while historical migrations remain under `retainedMigrations`. Existing tables/data and the source migration set/checksums remain intact. Plan production data removal separately through new migrations, object cleanup and Audit; do not delete applied migration files.

A fresh project that has never created a database may use:

```bash
just example-remove --trim-migrations
```

This trims example migrations so a new empty database initializes from Core. The tool does not inspect databases to prove this condition; you must establish it. Existing databases cannot use the trimmed path.

## Verify the reduced application

```bash
just check-core
just docs-build
```

Removal regenerates lockfiles, contracts/SDK and documentation references. Check compilation, real Core HTTP/task behavior, boundaries, frontend and documentation builds, then run your own business tests.

Universal home, identity pages and settings remain. Historical notifications for removed features stay readable and can be marked read, while their targets are unavailable. Old business links provide recoverable unavailable feedback; historical records do not imply an API still exists. Removing the selected business Default Entry falls back to universal home, and direct `/` always remains universal home.

Backup/restore tools remain usable. Reference-specific production smoke, restore drills and load scenarios explain and exit when the example is absent. Replace them with your own business assertions; a skip is not acceptance.

## Add or remove another reference business

The shipped notes example proves UI composition only. It is unregistered by default and has no notes backend. Both add and remove require a clean copy. Validate and commit your changes after each operation before the next:

```bash
node scripts/example-add.mjs --example notes
```

```bash
node scripts/example-remove.mjs --example notes --dry-run
node scripts/example-remove.mjs --example notes
```

Unregistered notes lacks required markers and cannot be removed directly as a whole. Add it first, then remove it, or handle ownership manually. All contributions still belong to one Organization; see the [source-composition ADR](../adr/0003-static-example-composition.md).

## Start your own module

Use [Add a business module](../guides/develop-module.md) to compose Router/OpenAPI, then add an owned schema, migration and `module.json`. Access identity, Memberships, Files, Audit and Jobs through public interfaces. Register outside any removed business's markers.

The [new-business exercise](../../scripts/example-new-business.mjs) creates a real backend notes module, migration and HTTP tests in a copy without knowledge, verifying registration, creation and reading. It is a development exercise distinct from shipped UI-only notes. It modifies its target and needs Docker/PostgreSQL; do not run it repeatedly in a production working copy:

```bash
node scripts/example-new-business.mjs --root /tmp/my-clean-core-copy
```

Replace `/tmp/my-clean-core-copy` with your prepared removal exercise copy.

```bash
node --test tests/tooling/example-remove.test.mjs
pnpm boundaries:check
```

Tool tests cover exact deletion, dry-run, migration history, dependency/navigation trimming and refusal behavior. Next: continue backend work with [Add a module](../guides/develop-module.md), or [application-shell contributions](27-add-example.md) when adding Web pages.
