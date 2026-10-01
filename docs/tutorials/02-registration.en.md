# Reuse Identity and Account Transactions

Goal: use Core registration and credentials without reimplementing passwords, User or Membership in a business module. Start the API and PostgreSQL from the [quickstart](../getting-started/quickstart.en.md). Run commands from the repository root.

## Connect Identity Endpoints

The [Core Router](../../crates/app/src/lib.rs) composes [Identity](../../crates/app/src/modules/identity/mod.rs): `POST /api/v1/auth/register`, `POST /api/v1/auth/login` and `GET /api/v1/auth/session`. Registration accepts `email`, `password` and optional `display_name`; the server determines the role.

```bash
curl -i http://127.0.0.1:18000/api/v1/auth/session
node scripts/test-backend.mjs --test registration
```

Anonymous requests return 401 and request_id. Public registration checks create accounts through the real Router, obtain Cookies and query identity, verifying the first Owner and later Member. Complete requests are in the [registration HTTP tests](../../crates/app/tests/registration.rs), DTOs in the [API reference](site:reference/api.md). Your Handler integration follows on the [next page](03-sessions.en.md).

## Transactions and Commit Boundaries

The [Identity migration](../../migrations/0002_identity.sql) stores accounts, credentials, memberships, sessions and audit. Registration creates User, Credential, Membership and Audit in one transaction; failure rolls everything back. Admission uses [Organization](../../crates/app/src/modules/organization/mod.rs)'s public interface:

```rust
pub async fn enroll(
    connection: &mut PgConnection,
    user_id: &str,
) -> Result<MemberRole, sqlx::Error>;
```

This is an interface excerpt. The singleton Organization row serializes first Owner initialization; requests cannot select Owner. Each deployment serves one Organization and business modules do not add another tenant layer. See the [ADR](../adr/0001-single-organization-deployment.md).

Session issuance follows the account commit. `auth.session_unavailable` means the account exists and login provides recovery. Repeated registration cannot overwrite passwords, roles or inactive status.

## Password and Secret Boundaries

The [password implementation](../../crates/app/src/modules/identity/crypto.rs) uses Argon2id with random salt. Blocking computation has 4 concurrent slots; saturation returns retryable 503. Passwords are 12–128 characters. Email is trimmed and unique in lowercase, without folding `+tag` or dots; concurrent duplicates allow one success.

A Session is a 256-bit random secret with only SHA-256 stored. HTTPS uses `__Host-saas_session` with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain; loopback HTTP is for development. Keep secrets out of business JSON, logs and browser storage.

Registration requires trusted `APP_ORIGIN`, never inferred from request Host. JSON is limited to 16 KiB and a 3-second read; the account transaction has 3 seconds and separate Session issuance has 2 seconds. Responses use no-store. A lost success response does not mean account creation failed; do not automatically repeat registration POST.

## Verify and Adapt

Checks cover duplicate email, concurrent first Owner, Audit rollback, Cookies, credential storage and origin rejection. Audit failure must leave no account; a committed account with failed Session issuance must later be able to log in.

Reference User IDs from business tables and check current membership. For customer-profile initialization, decide which facts must commit together and use public capabilities; keep profile rules in your module. Continue with [Session, Origin and CSRF](03-sessions.en.md), then business transactions and idempotency.

<!-- example:knowledge:reference-01:start -->

Complete reference: [business transactions and idempotency](04-personal-documents.en.md).

<!-- example:knowledge:reference-01:end -->
