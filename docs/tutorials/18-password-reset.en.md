# Walkthrough: Resetting a password from a real email

This chapter adds password recovery on top of the existing registration, sign-in and PostgreSQL jobs. Users never wait for email to register or write; only password recovery needs email delivery. This is Core functionality — the pages, jobs, tests and this chapter remain after the knowledge-base example is removed.

## 1. Complete a real reset

Run `just dev` and open the registration page to create your own test account. In another browser window open the sign-in page, click "Forgot password?", fill in the email and submit. The page always answers "If the account is usable, you will receive a reset email" and never confirms whether that address is registered.

Open the [Mailpit local inbox](http://127.0.0.1:8025), find the reset email and open its link. The mail is delivered by the real worker over SMTP; Mailpit only captures mail and never forwards it outward. Set a new password of 12–128 characters with confirmation, then return to the sign-in page and use the new password.

The original window's session is now invalid — refreshing or calling `/api/v1/auth/session` returns a signed-out result. Opening the same link again and submitting fails; a password reset never signs you in automatically and never revokes independently managed API keys.

The development entry starts Mailpit automatically and generates a random `.secrets/development-mail-key` on first run with `0600` permissions. The API and the worker use the same persistent key, so a restart never makes undelivered mail undecryptable. The directory is ignored — never commit it or copy it into public documents. An existing key file with a wrong format or permissions fails explicitly instead of being silently overwritten.

## 2. How one request becomes reliable email

`POST /api/v1/auth/password-reset` accepts `{email}` and validates the trusted Origin. Existing, unknown, disabled accounts and repeat requests inside the cooldown all receive the same 202 and body. The request may carry `locale: "zh" | "en"` to choose the email language; omitting it keeps the default Chinese delivery, and any other value gets a stable validation error. Without mail configured every address gets the same 503; ordinary registration and sign-in keep working. Requests follow the [authentication rate limits](17-rate-limits.md): repeat requests for the same usable account within the default 60 seconds merge instead of creating a new job.

The [identity request use case](../../crates/app/src/modules/identity/password_reset/requests.rs) saves the reset hash, the short-lived encrypted material and the `identity.password_reset` job in one transaction. The job payload carries only `reset_id`; the plaintext token, the address and the full link never enter job state, Audit or logs. The requested language is sealed into the material as a snapshot of the delivery language, and cross-language repeat requests inside the cooldown merge and keep the first language. A new request never invalidates a previously issued link, so nobody can knock a link out of a user's hands by spamming requests.

The link is built only from the trusted `APP_ORIGIN` — `https://your-app.example/reset-password#token=…` — never from the request Host. The fragment is not sent with HTTP request paths or the Referer; the web page reads it and immediately replaces the URL, the token is used only for that one submission and never written to browser storage or the Query/Mutation caches. When the request named a language the fragment gains a non-sensitive `&lang=<locale>` hint; the reset page renders only that flow in that language and never writes the saved preference. Links from requests without a language stay byte-identical to the existing format. Refreshing the reset page after the URL is cleared requires reopening the mail link.

After claiming the persistent job, the [reset email handler](../../crates/app/src/modules/identity/password_reset/worker.rs) verifies the member is currently valid, credentials exist, the reset is unexpired/unused/revoked, the job binding and lease hold — then decrypts and sends. The email subject and body use the language recorded when the material was sealed, so every attempt — retries included — speaks one language; material sealed before the field existed keeps the default Chinese. The database transaction ends before the network send; while sending, the worker keeps renewing its lease, and losing the lease cancels a send still waiting. The expiry also bounds the send budget. Sent mail cannot be recalled; consumption still re-validates the link.

## 3. What the hash and the ciphertext each solve

The [identity migration](../../migrations/0016_password_reset.sql) has two tables: `password_resets` stores the SHA-256 hash of the 256-bit random token and its validity; `password_reset_mail` stages the ciphertext of the recipient address and link. Verifying a token needs no decryption, but the worker must be able to recover the mail content after a restart, so the short-lived ciphertext cannot be replaced by a hash.

The [mail capability](../../crates/app/src/modules/mail/mod.rs) uses XChaCha20Poly1305 with a fresh 24-byte random nonce per material. The associated data binds purpose, schema, reset ID, job ID, user ID, key version and the exact expiry; swapping records or tampering with content fails decryption. The key is an independent 32-byte random value — never the database password or an API key.

Successful delivery deletes the ciphertext in the job's success transaction; a successful reset or a disabled member atomically revokes the other links and deletes that user's material. The maintenance entry cleans at most 100 expired/used/revoked materials per pass, even while SMTP is unconfigured. Downtime delays physical cleanup, but expired material can never reset a password and cleanup resumes after recovery. The validity defaults to 30 minutes with a range of 1–60 minutes.

The ciphertext protects pending content in the database; assembling and sending necessarily produces short-lived plaintext at runtime. Do not read ciphertext protection as "every memory buffer is safely erased".

## 4. Consumption, concurrency and revocation

`POST /api/v1/auth/password-reset/complete` accepts `{token,password}`. Link validity is checked before the Argon2 work to reuse the bounded password capacity. On submit it locks member → credentials → reset record in order, re-checks validity, and in one transaction updates the password, consumes the token, revokes all old sessions, revokes the other valid links, clears the material and appends the `identity.password.reset` audit.

Any failed step rolls back; of two concurrent consumptions exactly one succeeds. When issuing a session, sign-in also compares the just-verified password hash against the current credentials inside the transaction, so a stale verification interleaved with a reset can never mint a new session. Success clears the current cookie; the frontend clears the old session query data and asks for a fresh sign-in.

Expired, used and revoked tokens all return `auth.reset_invalid` with no account information. The UI offers a re-request entry; when the network result is unknown, try signing in with the new password first instead of blindly resending.

## 5. SMTP failures, retries and key recovery

The [SMTP adapter](../../crates/platform/src/mail.rs) sends once per attempt, up to four concurrent sends. An overall timeout covers DNS, TLS, DATA and QUIT; no extra connection-pool auto-retry. 4xx, recognized transient network errors and timeouts go to the jobs bounded backoff for at most five attempts; 5xx, invalid configuration, tampered ciphertext or an unknown key version fail immediately. Owner/Admin can see the static error codes on the jobs page and retry explicitly after fixing.

SMTP acceptance only means the server took over delivery, not that the recipient got the mail. A crash after acceptance, a lost reply or a failed database commit can resend the same link; a fixed Message-ID does not guarantee deduplication either. Single consumption is guaranteed by the database transaction. An expired or consumed job never starts a new delivery even if executed again.

Production uses `MAIL_SMTP_TLS=wrapper` or `starttls` with certificate validation, the right port, sender address and matching SMTP credentials. The `local` plaintext mode accepts only loopback, localhost or the development service name mailpit. Never expose the local inbox to a public network. The full variable list is generated by the [configuration reference](site:reference/config.md).

The API and the worker must share the same `MAIL_ENCRYPTION_KEY` and positive-integer `MAIL_ENCRYPTION_KEY_VERSION`. v1 supports a single current version: before rotation stop new requests, wait for old material to be delivered or expire and be cleaned, then change key/version on both ends together. Never present a new key as an old version. A wrong version fails jobs with `mail.key_unavailable`; restoring the original key/version within the TTL allows retrying from the jobs page. Expired links should be requested anew. Restoring a backup also means restoring the matching protected keys — never the database alone.

## 6. Verify and reuse

```bash
node scripts/test-backend.mjs --test password_reset --test mail_materials
pnpm exec vitest run apps/web/src/password-reset.test.tsx
node --test tests/tooling/development-mail-key.test.mjs
just check
```

Real HTTP/PostgreSQL/Job/Mailpit tests cover delivery, re-claiming after a restart, stale-lease rejection, repeated consumption, concurrency, expiry, disable-then-re-enable, audit failure rollback and SMTP 451/550. The requested language decides the delivered language and the link hint and survives retries, cross-language cooldown merges keep the first language, and an unsupported language returns a stable validation error. The reset-versus-sign-in races are organized with real database row locks, never guessed with arbitrary waits. View tests cover the neutral notice, manual retry, password confirmation, success, invalid links and URL fragment clearing; the link's language hint applies to that flow only, and a language the user picks inside the flow persists under the normal preference rules.

Run once when a new key journey is completed:

```bash
node scripts/e2e.mjs tests/e2e/password-reset.spec.ts
```

The browser takes the link from the really captured mail, resets, then verifies the other browser's session is invalid and signs in with the new password; the language journey verifies the requested language drives the mail and the link hint and covers only the reset flow itself. Auth journeys keep trace/screenshot off, and reports never save mail, tokens, passwords or raw exceptions.

To extend to other transactional email, let the business module own its own validity and short-lived material tables and connect through the public mail encryption/delivery capability and the jobs transactional interfaces. Let your handler re-validate the current business state and fail with static codes; never put plaintext secrets into ordinary job payloads.
