# Reuse Password Reset and Transactional Mail

Goal: enable Core password recovery and understand how Mail/Jobs serve other transactional emails. Integrate [Identity](02-registration.en.md) and [Worker](10-document-exports.en.md) first. Normal registration/business use does not depend on mail delivery.

## Configure and Obtain a Result

`just dev` starts Mailpit; the [inbox](http://127.0.0.1:8025) captures development mail only. Development creates `.secrets/development-mail-key` with mode 0600, shared by API/Worker and retained across restart. Never commit/publicly copy it; invalid format/permissions are not overwritten automatically.

Core composes two APIs; the [contract](site:reference/api.md) defines inputs/responses:

| Endpoint                                    | Input                            | Result                                                       |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `POST /api/v1/auth/password-reset`          | email, optional locale `zh / en` | Valid formats receive neutral 202 without account disclosure |
| `POST /api/v1/auth/password-reset/complete` | token, 12–128-character password | Successful consumption requires login again                  |

Requests require trusted Origin/auth rate limits. Existing, absent, inactive and cooldown-merged accounts share 202; unavailable mail uniformly returns 503. Defaults are 60-second cooldown and 30-minute tokens; cross-language duplicates retain the first language. Omitted locale is Chinese, unsupported values fail.

Run complete public-request/real-delivery checks from the repository root:

```bash
node scripts/test-backend.mjs --test password_reset --test mail_materials
node --test tests/tooling/development-mail-key.test.mjs
```

[HTTP/Job/Mailpit checks](../../crates/app/tests/password_reset.rs) obtain a real email link, reset, reject the old password/all old Sessions and log in with the new password. API Keys remain independently managed and are not automatically revoked.

## Store Hash and Short-Lived Ciphertext

The [request use case](../../crates/app/src/modules/identity/password_reset/requests.rs) stores token hash, short-lived mail materials and enqueues `identity.password_reset` together. Payload is only reset_id; plaintext email/token/full links stay out of Jobs, Audit and logs. New requests do not immediately invalidate earlier valid links.

The [migration](../../migrations/0016_password_reset.sql) separates verification SHA-256 from pending ciphertext: hash supports consumption, ciphertext allows Worker restart recovery, and neither replaces the other. [MailService](../../crates/app/src/modules/mail/mod.rs) exposes:

```rust
pub fn seal(&self, binding: &Binding<'_>, plaintext: &[u8]) -> Result<Sealed, MaterialError>;
pub fn open(&self, binding: &Binding<'_>, sealed: &Sealed) -> Result<Vec<u8>, MaterialError>;
pub async fn send_plain_text(&self, to: &str, subject: &str, body: String,
    message_id: &str, expires: tokio::time::Instant)
    -> Result<(), saas_platform::mail::DeliveryFailure>;
```

These are method excerpts. XChaCha20Poly1305 uses independent nonces. Binding authenticates purpose, schema, business/Job/User IDs, key version and exact expiry. Your business owns validity/material tables and uses an independent 32-byte key, never the database password. Runtime plaintext still exists briefly; not every buffer is guaranteed erased.

## Worker and One-Time Consumption

The [reset Handler](../../crates/app/src/modules/identity/password_reset/worker.rs) checks current membership, credential, expiry, consumption/revocation, Job association and lease before decryption, then ends its database transaction before sending. Retries preserve sealed language. Lost leases cancel pending sends but cannot retract delivered mail; consumption rechecks validity.

The [consumption transaction](../../crates/app/src/modules/identity/password_reset/consume.rs) locks member → credential → reset, revalidates and atomically updates password, consumes token, revokes all old Sessions/other links, removes materials and appends Audit. Concurrent consumption allows one success; Audit failure rolls back. Session issuance compares the current hash to prevent old-password verification races.

Invalid/expired/used/revoked returns `auth.reset_invalid`. After uncertain responses, try the new password instead of blindly resubmitting. Trusted APP_ORIGIN constructs links; token is in the fragment, immediately removed by the page and absent from storage/cache. `lang` hints affect only this flow.

## SMTP Failure and Key Recovery

[SMTP](../../crates/platform/src/mail.rs) sends once per attempt with at most 4 concurrent sends and a deadline covering DNS/TLS/DATA/QUIT. 4xx/recognized temporary network errors/timeouts use Jobs for at most five attempts; 5xx/tampering/unknown key version are permanent. SMTP acceptance is not recipient delivery. Lost acknowledgements/failed commits can resend; fixed Message-ID does not guarantee deduplication. Database consumption provides one-time use.

Fenced send success removes ciphertext; consumption/deactivation clears user materials atomically. Maintenance handles at most 100 items; delayed physical deletion cannot revive expired links. Production uses verified starttls/wrapper; local plaintext is development-only loopback/service name. See [configuration](site:reference/config.md).

API/Worker share `MAIL_ENCRYPTION_KEY / MAIL_ENCRYPTION_KEY_VERSION` with one current version. Stop new requests and drain/expire old materials before switching both. For mistakes, restore the original key/version within TTL and explicitly retry. Database restore also needs the matching protected key. Other transactional mail owns its validity, materials and Handler, never secrets in ordinary payloads. Continue with [telemetry](19-observability.en.md).
