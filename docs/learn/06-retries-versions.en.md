# 06 Protect retries and concurrent updates

Starting state: the same CRUD module, first Ticket and creator Session. Idempotency asks whether an operation already executed; an expected version asks whether the resource is still the version you read. They have different responsibilities.

## Use public idempotency for creation replay

After Membership authorization, `application.rs` fingerprints normalized title/description and claims the actor, endpoint scope and Idempotency-Key:

<<< ../../examples/tutorial-tickets/application.rs#idempotent-create

New operations complete business writes, Audit and replay in one transaction. Replay stores only ticket_id, then reauthorizes and reads the current resource. It cannot bypass revocation through cached responses. Keys contain 1–128 visible ASCII bytes; Core's default retention is 24 hours.

Repeat lesson 02's exact input/key:

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: first-ticket" -H "Content-Type: application/json" \
  --data '{"title":"First ticket","description":"Investigate a request"}' \
  "$BASE_URL/api/v1/tickets"
```

Expect 201 with the same `TICKET_ID`, without another Ticket or creation Audit. Changing title to `Different input` with that key returns 409/`tickets.key_conflict`. A distinct operation needs a new key.

## Own the update's version condition

The update checks `WHERE id = ... AND version = expected` and increments version on success:

<<< ../../examples/tutorial-tickets/application.rs#version-update

Ticket and active-Membership locks stabilize authorization while the version condition rejects stale drafts. Core Idempotency does not automatically implement business optimistic concurrency.

This starts with lesson 02's version 1. If already updated, read the current version and use it for the first request, keeping that same stale version for the second.

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"title":"Investigating","description":"The request is assigned","status":"closed","version":1}' \
  -X PUT "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

The first update returns 200 with version 2. Repeating version 1 returns 409/`tickets.version_conflict`. Read afterward to verify the winner's fields/version remain. After a timeout, read the current result rather than blindly incrementing a version and overwriting.

## Verify concurrency and duplicate-free effects

Run from the original template root:

```bash
node scripts/test-backend.mjs --test tutorial_course creation_replays_one_result_and_rejects_changed_input
node scripts/test-backend.mjs --test tutorial_course two_updates_of_one_version_have_one_winner
```

The [course HTTP checks](../../crates/app/tests/tutorial_course.rs) verify replay/changed-input conflict and simultaneous updates yielding `[200, 409]`, then read the winner. Sequential calls cannot replace a race check, and a frontend cannot decide which write is valid.

Previous: [Transactions and Audit](05-transactions.md). Next: [Connect ticket Files](07-files.md).
