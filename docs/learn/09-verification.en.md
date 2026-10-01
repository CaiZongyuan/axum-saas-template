# 09 Verify public HTTP behavior and generate the SDK

Starting state: the `jobs` checkpoint exposes working Tickets, attachments and JSON exports through real APIs. Turn successes, denials and recovery into repeatable checks, then verify client contracts come from the current module.

## Tests compose the real module

Return to the original template root and run with isolated dependencies:

```bash
node scripts/test-backend.mjs --test tutorial_course
pnpm tutorial:check
pnpm tutorial:course:check
```

The [complete course checks](../../crates/app/tests/tutorial_course.rs) drive real Core plus ticket Routers through HTTP, PostgreSQL, Files object protocols and a controlled Worker. A minimal create/read path is:

<<< ../../crates/app/tests/tutorial_course.rs#crud-test

Course SQL is installed in isolated databases, not your development data. `pnpm tutorial:check` covers the static first module. `pnpm tutorial:course:check` upgrades all four checkpoints in a temporary copy, verifying the real migration ledger, both API entries, HTTP/storage/job behavior and Worker compilation. Actual curl journeys complement these checks.

Required outcomes include invalid input, hidden resources, replay/key conflict, stale-version rejection, Audit rollback, unpublished-upload invisibility, downloaded bytes, task output and terminal notifications. Worker `run_once` returning true only means a task ran; read Job and business results afterward.

## Generate contracts from your copy

Run at the course-copy root:

```bash
just generate
pnpm contracts:check
pnpm typecheck
```

The [generator](../../scripts/generate-contracts.mjs) reads this copy's assembled OpenAPI and writes:

| Artifact                                        | Inspect                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/contracts/openapi.json`               | Ticket/upload/export routes, DTOs and public errors                       |
| `packages/contracts/src/generated/types.gen.ts` | CreateTicket, UpdateTicket, Ticket and request types                      |
| `packages/sdk/src/generated/sdk.gen.ts`         | Operations such as createTicket, readTicket, updateTicket and listTickets |
| `packages/sdk/src/index.ts`                     | Stable client configuration using generated types/methods                 |

Rust DTOs and operationIds own the protocol. Regenerate after adding/removing fields so drift checks reject stale artifacts. Do not maintain a second Ticket interface in SDK code. Browser Cookie/CSRF wiring belongs to later client work; this course implements no frontend pages.

## Check a contract failure

Temporarily change a Ticket output field in the copy without regenerating, then run `pnpm contracts:check`: it should report drift. Restore source or run `just generate` to pass. Read current JSON too, ensuring generated contracts and the live API use the same binary revision.

```bash
curl --fail "$BASE_URL/api/openapi.json"
curl --fail -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

## Record evidence and ownership

After focused checks pass, run `just check` in the copy and record its actual revision/results. Compilation, HTTP, storage/tasks and documentation builds establish different responsibilities. Do not report unrun deployment/client checks as passed.

Maintain module, migrations, HTTP checks, bilingual lessons and course tooling together. Removing the knowledge reference business must not remove this independent course. The [course ownership inventory](../../examples/tutorial-tickets/ownership.json) records owned files and shared references. The fixture is not registered in the default application; trimming it requires updating shared references. `example-remove` manages registered application examples separately.

Previous: [Background tasks and notifications](08-jobs.md). Next: [Deploy your ticket business](10-production.md).
