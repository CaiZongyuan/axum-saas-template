# Validate Sessions in Business Handlers

Goal: use current identity in your read/write APIs and handle Origin, CSRF and expiration. Reuse [Identity](02-registration.en.md) and compose your Router through Core first. Successful authentication still requires resource authorization.

## Call the Public Interface

This [Identity](../../crates/app/src/modules/identity/mod.rs) interface excerpt uses types from Identity, Axum, SQLx and Platform settings:

```rust
pub async fn require_session(
    pool: &PgPool,
    settings: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
    mutation: bool,
) -> Result<CurrentSession, Response>;
```

In a Handler with existing `pool / auth / headers / id`:

```rust
let session = identity::require_session(&pool, &auth, &headers, &id, true).await?;
```

Pass `false` for reads and `true` for mutations. It returns identity such as `user.id` and `csrf_token`, or a common Response. Write use cases must still [lock current membership](08-members.en.md) and authorize resources inside their transaction. Cookie presence alone is insufficient.

<!-- example:knowledge:reference-01:start -->

Complete reference: [Knowledge HTTP layer](../../crates/app/src/modules/knowledge/mod.rs); [authorize resources](07-library-grants.en.md).

<!-- example:knowledge:reference-01:end -->

## Mutation Proof

Registration/login check trusted Origin. Cookie mutations require both Origin matching `APP_ORIGIN` and the current Session's `x-csrf-token`. HMAC derives the token from the secret and the response body supplies it to clients; another Session's token is invalid. Session-only endpoints reject explicit Authorization; a failed Bearer never falls back to Cookie.

`POST /api/v1/auth/logout` revokes the current Session and clears its Cookie. The old Cookie then receives 401 from Session lookup. Repeated valid logout proof is idempotent without affecting other devices. Machine read credentials use [API Keys](15-api-keys.en.md).

Defaults are 7 days absolute and 24 hours idle, judged by database time. Valid reads refresh idle time without extending absolute expiry; revocation and deactivation take effect immediately. See the [generated configuration reference](site:reference/config.md).

## Failure and Recovery

Wrong email, password and inactive membership share 401 behavior; unknown email still performs equivalent bounded password work. Database failures return 503 and remain retryable errors rather than successful logout. Login issues a new independent Session without revoking all devices.

On logout, identity change or Session loss, clients cancel old requests and clear identity-related queries; late responses cannot populate the new identity's cache. Keep passwords and Cookie secrets out of persistent state and never resubmit passwords through background refresh.

## Verify Your Handler

Run from the repository root:

```bash
node scripts/test-backend.mjs --test sessions
```

[HTTP checks](../../crates/app/tests/sessions.rs) cover login/logout, Origin/CSRF, expiration, deactivation and recovery after registration's Session failure. Check anonymous 401, valid Cookie reads, mutation rejection without CSRF, successful valid mutations and rejection after logout for your Handler. Drive the real Router/database instead of replacing private authentication functions.

Background work captures a credential reference instead of the secret and revalidates it during execution/publication. Continue with [background execution](10-document-exports.en.md).
