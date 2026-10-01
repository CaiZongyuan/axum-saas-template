# Command Index

Install the toolchain in [Backend development setup](../getting-started/quickstart.md). `just --list` lists current recipes. This index follows the published revision's [justfile](../../justfile) and [package.json](../../package.json).

## Select a Verification Entry

When developing your backend, run relevant Rust HTTP/job tests first, then contracts and documentation checks. `just e2e-docs` verifies navigation, search and deployment paths in the static documentation website without application services. `just desktop-smoke` verifies the Electron application shell when desktop integration changes. Editing documentation alone does not require Electron tests.

`just check` runs the full repository gate, including real services, frontend, performance contracts and documentation builds. `just check-full` adds real application browser journeys. Load scenarios and Desktop Soak are separate report tasks; see Performance guide.

## Persistent Data and Recovery

`just dev` starts local dependencies, migrates and initializes storage, preserving data on exit. `services-down` and `db-down` stop containers. `production-migrate` changes the deployment database schema; `production-up` includes explicit migration. Read the prerequisites in [Production deployment](../tutorials/21-single-machine-production.md) and [Backup and restore](../tutorials/22-backup-restore.md). Confirm that `ENV_FILE` and archive paths belong to the intended environment before running those operations.

<!-- generated:task-runner -->

<!-- example:knowledge:reference:start -->

The knowledge reference domain's [Performance guide](../tutorials/24-perf-gates.md) explains its deterministic budgets. Removing the domain removes this reading entry.
<!-- example:knowledge:reference:end -->
