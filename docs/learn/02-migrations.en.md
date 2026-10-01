# 02 Persist tickets with explicit migrations

Starting state: the first lesson's static module. Upgrade to the complete `crud` checkpoint with owned schema, migration, DTOs, access control and transactions. The next four lessons explain that same implementation; first prove a write can be read back.

## Update the copy and migrate

Stop its `just dev`, return to the original template root and run:

```bash
node scripts/tutorial-course.mjs --stage crud --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

Development explicitly migrates before starting API/Worker. With dependencies already running, use `just migrate` in the copy and restart development so embedded migrations match the source.

The tool installs the [course migration](../../examples/tutorial-tickets/migrations/0001_tickets.sql) at the next available version under the copy's `migrations/`, and `mod.rs`, `application.rs`, `domain.rs` under `crates/app/src/modules/tickets/`. `module.json` owns `support.tickets`.

<<< ../../examples/tutorial-tickets/migrations/0001_tickets.sql#ticket-schema

The table references a stable Core user id while public APIs read identity/Membership. Database constraints protect state/version and the business owns its tables. Add a new migration version instead of editing applied history.

## Obtain a Session and create data

Run at the copy root in the request terminal with `BASE_URL` / `ORIGIN` loaded from `.course.env` in the previous lesson. These files hold development credentials only; do not commit them:

```bash
mkdir -p .scratch/course-http
curl --fail-with-body -sS -c .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"email":"ticket-owner@example.test","password":"course-test-password"}' \
  "$BASE_URL/api/v1/auth/register" > .scratch/course-http/session.json
export CSRF_TOKEN=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/session.json','utf8')).csrf_token")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: first-ticket" -H "Content-Type: application/json" \
  --data '{"title":"First ticket","description":"Investigate a request"}' \
  "$BASE_URL/api/v1/tickets" > .scratch/course-http/ticket.json
export TICKET_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/ticket.json','utf8')).id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

Registration and creation return 201; reading returns 200. Ticket title is `First ticket`, status `open`, version 1, and id matches creation. Other fields include creator and timestamps. When repeating with an existing account, replace registration with `/api/v1/auth/login` using the same credentials to obtain a new Session.

## Check migration failure

```bash
curl -i "$BASE_URL/health/ready"
pnpm boundaries:check
```

Expect readiness 200. After adding an unapplied migration, differing source/database sets produce 503. Run `just migrate`, restart and verify ticket writes/reads. API startup does not migrate for you.

Course integration tests apply Core migrations followed by course SQL in an isolated database; Core readiness alone does not establish the ticket schema on that fixture path. The development copy includes course SQL in the real root migration set, which also requires recompilation for production.

Previous: [Module assembly](01-module.md). Next: [Protocols and validation](03-protocol.md).
