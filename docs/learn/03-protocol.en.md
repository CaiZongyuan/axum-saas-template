# 03 Define protocols and validation boundaries

Starting state: the `crud` checkpoint creates and reads tickets. Keep the same module and distinguish HTTP data shapes from business rules.

## Locate the protocol implementation

The copy's `crates/app/src/modules/tickets/mod.rs` defines CreateTicket, UpdateTicket, TicketQuery and Ticket:

<<< ../../examples/tutorial-tickets/mod.rs#ticket-protocol

CreateTicket accepts title/description; UpdateTicket adds status/version. Request DTOs reject unknown fields. Responses contain string id, creator, state, version and timestamps. Query `limit` accepts 1–100 and defaults to 50.

`BoundedJson` supplies JSON decoding, public errors and a read deadline; Router body limit is 16 KiB. It does not implement business field rules. Pure `domain.rs` provides those:

<<< ../../examples/tutorial-tickets/domain.rs#content

Title is trimmed, then must contain 1–200 characters. Description permits at most 8192 bytes, and neither field may contain NUL. Character count differs from UTF-8 byte size; database constraints use the same measures.

## Send invalid input

Use the second lesson's Session and CSRF at the copy root:

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: invalid-title" -H "Content-Type: application/json" \
  --data '{"title":"   ","description":"Not a valid title"}' \
  "$BASE_URL/api/v1/tickets"
```

Expect 400 with `tickets.invalid_input` and request_id. Validation rejects input before the transaction without creating Ticket, Audit or replay state. Change to a valid title and a new key to obtain 201, then read the result.

Add `"unexpected": true` to the body: DTO decoding should reject it before Domain validation. Oversized bodies, invalid queries and malformed path parameters use framework errors rather than exposing parser or database details.

## Keep one protocol source

```bash
just generate
pnpm contracts:check
```

Run in the copy; OpenAPI schemas and generated types for CreateTicket/Ticket should agree. Regenerate after changing DTOs or operationIds instead of hand-editing derived `packages/contracts` types.

The complete flow is in [mod.rs](../../examples/tutorial-tickets/mod.rs); validation is in [domain.rs](../../examples/tutorial-tickets/domain.rs). Update Domain, database constraints, OpenAPI and behavior checks together when field limits change.

Previous: [Migration and first write](02-migrations.md). Next: [Identity and ticket authorization](04-authorization.md).
