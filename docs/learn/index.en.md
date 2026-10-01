# Build your ticket SaaS backend

Start with one Rust HTTP endpoint and evolve the same ticket module through persistence, identity, authorization, transactions, files, background tasks, testing and deployment. The course uses backend interfaces and requires no frontend implementation.

Tickets are reader-added course code; the default app retains the knowledge reference business. Each deployment serves one Organization, and tickets do not create another tenant. The course policy allows the creator and current Owner/Admin to access a ticket while hiding it from other members.

## Prerequisites and sequence

Complete [backend quick start](../getting-started/quickstart.md) and prepare the repository's pinned Rust, Node, pnpm, just and Docker. Run from the original template root:

```bash
export TEMPLATE_ROOT="$PWD"
export COURSE_ROOT="$TEMPLATE_ROOT/.scratch/ticket-saas"
node scripts/tutorial-course.mjs --stage module --root "$COURSE_ROOT"
```

The course tool wires code into this independent template copy without registering it in the original default app. It assigns a separate Compose project, volumes and free ports, recording public request addresses in `.course.env`; later checkpoints preserve them. Stop the copy's development processes before advancing, run the command in the original template, then run the copy. Save your own edits first; checkpoint installation is not a merge tool.

| Lesson                       | Development goal                                | Code checkpoint |
| ---------------------------- | ----------------------------------------------- | --------------- |
| [01](01-module.md)           | Module, Router and OpenAPI                      | `module`        |
| [02](02-migrations.md)       | Owned schema/migration and the first real write | `crud`          |
| [03](03-protocol.md)         | Protocols, validation and public errors         | Keep `crud`     |
| [04](04-authorization.md)    | Session, active Membership and ticket policy    | Keep `crud`     |
| [05](05-transactions.md)     | Business and Audit commit together              | Keep `crud`     |
| [06](06-retries-versions.md) | Idempotency and concurrent versions             | Keep `crud`     |
| [07](07-files.md)            | Upload, verification, publication and download  | `files`         |
| [08](08-jobs.md)             | JSON snapshot export, Worker and notifications  | `jobs`          |
| [09](09-verification.md)     | HTTP checks and generated SDK                   | Keep `jobs`     |
| [10](10-production.md)       | Deployment, observation, backup and restore     | Keep `jobs`     |

Four checkpoints provide complete runnable code. Lessons 03–06 verify individual responsibilities in one protected CRUD implementation rather than running an unprotected intermediate business. Full source lives in [examples/tutorial-tickets](../../examples/tutorial-tickets/); excerpts share that implementation so you do not have to invent missing helpers.

## Business contract

A Ticket has title, description, `open | closed` status and an integer version. Creation uses Idempotency-Key; updates carry the expected version. Resource authorization precedes reads, replay and publication.

Attachments belong to tickets while Core Files owns object state. Export produces JSON up to 64 KiB with request-time ticket and attachment metadata, not attachment bytes or a ZIP. Business retention is one hour. Downloads and Worker publication recheck identity, Membership and resource access; an invalid initiating Session cannot publish.

These are course business decisions, not automatic Core ticket rules. Actual Rust/OpenAPI defines protocols and calls. Chapter validation commands must be executed separately; footer SHA identifies build source only.

Next: [Add the first ticket endpoint](01-module.md).
