# Add a business module

Add a `tickets` module for your SaaS, expose one HTTP endpoint and connect it to the framework's request context and OpenAPI document.

Prerequisite: finish the [quick start](../getting-started/quickstart.md) and work in your development copy. This chapter returns static development data; later stages add persistence, authentication and business rules.

## 1. Create the complete module

Create `crates/app/src/modules/tickets/mod.rs` with the following code. It exposes Router and OpenAPI while keeping the handler and DTO private.

<<< ../../examples/tutorial-tickets/preview.rs

The [public HTTP check](../../apps/api/tests/tutorial_module.rs) compiles this source directly. `pnpm tutorial:check` applies the declaration, route and OpenAPI steps below in a temporary source copy and verifies both application entries; it does not modify your working copy or access an existing database. The response type and HTTP declaration share one Rust definition.

## 2. Declare the module and table ownership

Append this outside the knowledge marker block in `crates/app/src/modules/mod.rs`:

```rust
pub mod tickets;
```

Create `crates/app/src/modules/tickets/module.json`:

```json
{ "kind": "business", "tables": [] }
```

There are no database tables yet. Register your table names when adding migrations, so boundary checks can determine which module owns each table.

## 3. Compose application routes

Connect your Router in `apps/api/src/lib.rs`. The default process uses `configured_router`; tests and other callers also use `router_with_cache`.

In `router_with_cache`, after the knowledge marker block and before the Core composer, add:

```rust
let domain_routes = domain_routes.merge(saas_app::modules::tickets::router());
```

Add the corresponding line in `configured_router`:

```rust
let routes = routes.merge(saas_app::modules::tickets::router());
```

The application entry composes business routes. Core's `compose_routes_with_options` receives the result without importing ticket types.

## 4. Merge OpenAPI

In the same file's `openapi()`, before `rate_limit::describe(document)`, add:

```rust
let mut document = document;
document.merge(saas_app::modules::tickets::openapi());
```

Keep registration outside the knowledge marker block so removing that example preserves your business. `previewTicket` is the stable operationId used by SDK generation.

## 5. Compile and request

Run from the repository root:

```bash
cargo check --locked -p saas-api
pnpm boundaries:check
curl -i http://127.0.0.1:3000/api/v1/tickets/preview
```

`just dev` restarts the API when Rust files change. Expect HTTP 200, an `x-request-id` header and this body:

```json
{ "title": "First ticket", "status": "open" }
```

Request `/api/openapi.json` and find `previewTicket` and `TicketPreview`. Generate client contracts:

```bash
just generate
pnpm contracts:check
```

## 6. Change one condition

Replace `First ticket` with your own text and request the endpoint again. Temporarily remove the application Router merge: the request returns the framework's 404 error. Restore it to get JSON again. This separates a Rust module from its registration in the running application.

The static endpoint is only for this development stage. Your create, read and update use cases should add current identity, a data model, authorization and transactions.

## Next step

Read [Core and business boundaries](../architecture/module-boundaries.md), then use [the first request](../tutorials/01-full-stack-request.md) to inspect DTOs, public errors, generated SDK and tests. The continuous ticket course builds on this module.
