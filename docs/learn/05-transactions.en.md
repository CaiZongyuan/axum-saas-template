# 05 Commit business changes and Audit together

Starting state: the same protected CRUD module. Define successful creation as Ticket and Audit persisting together rather than inserting a Ticket and sending a separate audit request.

## The use case owns the transaction

In the copy's `crates/app/src/modules/tickets/application.rs`, create performs Membership checks, idempotency claim, business insertion, Audit, replay completion and commit in one PostgreSQL transaction:

<<< ../../examples/tutorial-tickets/application.rs#create-transaction

`audit::append` takes the caller's PgConnection. An error propagated with `?` rolls back the uncommitted transaction. It accepts no arbitrary request JSON metadata: events contain actor, stable action/resource, RequestId or Job source, and optional affected user.

Do not append Audit outside the transaction from a Handler or write `saas_core.audit_events` directly from business code. Resource changes and cross-module side effects share one commit decision.

## Observe Audit through public results

Use the Owner Session from lesson 02 at the copy root:

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/audit-events"
```

The Ticket returns 200; Audit should include action `tickets.create`, resource_type `tickets.ticket` and resource_id matching `TICKET_ID`. Its request_id correlates with creation response/logs. Use the generated [HTTP reference](site:reference/api.md) for the list shape rather than assuming every endpoint wraps arrays identically.

The course's first account is Owner and can read Core Audit. Ordinary members cannot use that list as a cross-resource data entry.

## Prove Audit failure rolls back business

Return to the original template root and run the focused HTTP check:

```bash
node scripts/test-backend.mjs --test tutorial_course a_failed_audit_rolls_back_ticket_and_request_replay
```

The [course test](../../crates/app/tests/tutorial_course.rs) forces `tickets.create` Audit failure only in isolated PostgreSQL. Creation returns 503 and the public list is empty. Removing the fault and retrying the same key creates exactly one result, proving rollback left no unusable replay claim.

Do not install the fault trigger in development or production databases. The test observes HTTP 503, public lists and recovered results instead of counting calls to append.

When adding other side effects, place Job, notification intent or Files publication records inside the same caller-owned transaction. PostgreSQL rollback cannot undo network I/O.

Previous: [Resource authorization](04-authorization.md). Next: [Protect retries and concurrent updates](06-retries-versions.md).
