# 01 Add a ticket module and HTTP endpoint

Starting state: the template runs but has no registered ticket business. This lesson composes a complete `tickets` module with the real Core Router/OpenAPI and returns static JSON. Persistence and identity start at the next checkpoint.

## Install the complete module checkpoint

Run from the original template root:

```bash
export TEMPLATE_ROOT="$PWD"
export COURSE_ROOT="$TEMPLATE_ROOT/.scratch/ticket-saas"
node scripts/tutorial-course.mjs --stage module --root "$COURSE_ROOT"
cd "$COURSE_ROOT"
pnpm install --frozen-lockfile
just dev
```

The generated copy uses a separate Compose project, volumes and dynamic ports instead of original development data. Open another terminal at the copy root, load its public addresses and request:

```bash
source .course.env
curl -i "$BASE_URL/api/v1/tickets/preview"
```

Expect HTTP 200, `x-request-id` and:

```json
{ "title": "First ticket", "status": "open" }
```

Later HTTP commands use this terminal's `BASE_URL` / `ORIGIN`. Run `source .course.env` again in each new terminal. This file contains only public addresses; private database/storage configuration lives in the copy's `.env`. Do not override the course with original-template DATABASE_URL or service ports.

## How code enters the application

Full stage source is [preview.rs](../../examples/tutorial-tickets/preview.rs), copied into `crates/app/src/modules/tickets/mod.rs`. The minimal Handler and contract are:

<<< ../../examples/tutorial-tickets/preview.rs#preview

The tool also updates four assembly locations:

| File                                         | Change                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| `crates/app/src/modules/mod.rs`              | Declare `tickets`                                    |
| `crates/app/src/modules/tickets/module.json` | Declare business ownership with no tables yet        |
| `apps/api/src/lib.rs`                        | Merge routes in ordinary and configured Router paths |
| The same file's `openapi()`                  | Merge ticket OpenAPI                                 |

Core `compose_routes_with_options` receives the assembled result without importing Ticket. A module, a registered route and a registered contract are separate conditions.

## Verify and check a failure

In another terminal at the copy root:

```bash
cargo check --locked -p saas-api
pnpm boundaries:check
curl --fail "$BASE_URL/api/openapi.json"
```

OpenAPI should include `previewTicket` and `TicketPreview`. Temporarily remove the business Router merge in the copy: the request becomes a structured 404. Restore it to get 200. Compilation alone cannot establish HTTP registration.

This static endpoint writes no database data and defines no product access policy. See [Add a business module](../guides/develop-module.md) for complete assembly details.

Previous: [Course overview](index.md). Next: [Add your schema and migration](02-migrations.md).
