# 04 Reuse Sessions and authorize ticket resources

Starting state: `crud` and the Session saved in lesson 02. Keep the same module and verify a complete denied-access path. Organization owns roles; your business owns ticket policy.

## Separate identity, Membership and resource checks

The Handler in `crates/app/src/modules/tickets/mod.rs` calls `identity::require_session`. Writes use `mutation = true` for Cookie, trusted Origin and CSRF. Identity must not come from a body-supplied user_id:

<<< ../../examples/tutorial-tickets/mod.rs#create-handler

`application.rs` calls `organization::active_role_in` inside the caller's transaction, holds a Membership FOR SHARE lock, then locks the resource and applies policy:

<<< ../../examples/tutorial-tickets/application.rs#authorization

Course policy permits the creator and current Owner/Admin to read/write. Other active members receive 404 to avoid exposing existence. Lists apply the same filtering instead of returning all resources for clients to hide. Two ticket collections still belong to one Organization.

## Prove denial with another identity

At the copy root in the request terminal, retain the original cookies and `TICKET_ID`; create a second Member with a separate Cookie file:

```bash
curl --fail-with-body -sS -c .scratch/course-http/other-cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"email":"ticket-other@example.test","password":"course-test-password"}' \
  "$BASE_URL/api/v1/auth/register" > .scratch/course-http/other-session.json
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

The second Member receives 404/`tickets.not_found`; the creator receives 200 with unchanged content. Use `/api/v1/auth/login` for an existing second account. Repeat without a Cookie to get 401.

## Write-failure boundaries

Original-session writes still need Origin and `X-CSRF-Token`. A Cookie without CSRF receives 403; command-line clients get no bypass:

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"title":"Rejected change","description":"No CSRF","status":"open","version":1}' \
  -X PUT "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

Read afterward to verify unchanged title/version. Logout, expiry or deactivation invalidates the Session; late requests, replay and later file publication must reauthorize. Core `active_role` has no transaction lock and cannot replace `active_role_in` for critical writes.

See [Sessions](../tutorials/03-sessions.md) and [Organization Memberships](../tutorials/08-members.md) for the public contracts. This course adds no API Key write protocol.

Previous: [Protocols and validation](03-protocol.md). Next: [Commit business and Audit together](05-transactions.md).
