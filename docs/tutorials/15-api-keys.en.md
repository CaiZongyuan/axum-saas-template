# Register Key Scopes for Your Read API

Goal: expose machine reads with explicit permission ceilings. Define resource authorization and compose Router/OpenAPI first. Existing API Keys support explicitly enabled read-only operations, not business mutations or background Session credentials.

<!-- example:knowledge:reference-01:start -->

Complete reference: [resource authorization](07-library-grants.en.md).

<!-- example:knowledge:reference-01:end -->

## Register at the Application Assembly Point

[API Keys](../../crates/app/src/modules/api_keys/mod.rs) exposes `KeyScope { id, label }`, `core_scopes()` and `require_read`. Core registers `profile:read`; the reference registers `knowledge:read` at the [API assembly point](../../apps/api/src/lib.rs). Supply your scopes through `CoreOptions.api_key_scopes` too. Integration excerpt:

```rust
let mut scopes = saas_app::modules::api_keys::core_scopes();
scopes.push(saas_app::modules::api_keys::KeyScope {
    id: "tickets:read".into(),
    label: "Read accessible tickets".into(),
});
```

This new-business excerpt does not create ticket routes. `GET /api/v1/api-keys/scopes` lists actually supported capabilities; Key creation rejects unknown scopes.

## Validate in Read Handlers

[Public authentication interface](../../crates/app/src/modules/api_keys/authentication.rs) excerpt:

```rust
pub async fn require_read(
    pool: &PgPool,
    auth: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
    scope: &str,
) -> Result<ReadActor, Response>;
```

Pass `tickets:read`, then authorize current business visibility/deletion state using the returned User ID. Scope intersects with resource eligibility; it is not global visibility. Knowledge reads provide complete Handlers. Only list/detail enable Keys; attachments, exports and mutations still use Sessions.

<!-- example:knowledge:reference-02:start -->

Complete reference: [Knowledge reads](../../crates/app/src/modules/knowledge/mod.rs).

<!-- example:knowledge:reference-02:end -->

Explicit invalid Authorization never falls back to Cookie. Session-only management rejects Bearer. Authentication checks hash, expiry, revocation, current membership and scope every time, taking member locks before credential locks. Missing scope is 403; invalid/expired/revoked/inactive is 401; business-hidden resources return 404.

## Real Requests and Secrets

Create a Key through Session management first, then enter the one-time secret in Bash. Curl receives config on stdin so the secret avoids history/process arguments:

```bash
read -rsp 'API Key: ' SAAS_API_KEY
curl --fail-with-body --config - <<CURL
url = "http://127.0.0.1:3000/api/v1/profile"
header = "Authorization: Bearer ${SAAS_API_KEY}"
CURL
unset SAAS_API_KEY
```

This requires `profile:read` and returns your basic profile. Revocation makes the same request return 401. Your URLs/responses come from the generated contract; read-only `can_edit=false` is not server-side mutation protection.

Keys are 256-bit random secrets with only SHA-256 stored. Creation shows them once and uses neither replayable idempotency nor automatic retry. For lost responses, identify/revoke using metadata and explicitly create a new Key. Store name/prefix/scopes/times, never secrets in logs, Query cache or persistent state. Expiration is 1–365 days; already-authenticated requests cannot be recalled.

## Verify and Extend

Run from the repository root:

```bash
node scripts/test-backend.mjs --test api_keys --test sessions
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test key_documents
```

<!-- example:knowledge:reference-03:end -->

[Core checks](../../crates/app/tests/api_keys.rs) cover one-time secrets, private management, CSRF, rollback, revocation and mixed credentials. A real TCP client creates a Key, reads with Bearer, revokes and observes 401, including resource intersection. Your API should cover eligible reads, missing scope, revocation and denied writes. Remove scope registration when removing your business; continue with [versioned cache](16-versioned-cache.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [real TCP client](../../apps/api/tests/key_documents.rs).

<!-- example:knowledge:reference-04:end -->
