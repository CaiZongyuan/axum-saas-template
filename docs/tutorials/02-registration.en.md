# Walkthrough: Registration, transactions and sessions

Run `just dev` and open `/register`. Enter an email, a 12–128 character password and an optional display name; success lands on the home page showing the current email and organization role. Refreshing keeps you signed in. Register a second account with a different email in another private window and you'll see the first account is Owner, the second Member.

Registration is a SaaS Core capability and depends on no knowledge base, invitation, email or Redis. This chapter delivers registration and the current-session query; ordinary sign-in/sign-out arrive in the next chapter, and personal documents start with the knowledge-base chapters.

## 1. Making four facts true at once

The [Identity migration](../../migrations/0002_identity.sql) establishes the storage for User, Credential, Membership, Audit and Session. The User, Credential, Membership and registration-Audit writes share one transaction: any step failing rolls the registration back as a whole.

The email is trimmed at both ends — the display value is kept, the lowercase value backs the database unique constraint. `+tag` and dots are not folded; no provider-specific convention becomes a universal rule. Of concurrent same-email requests, exactly one succeeds in the end.

The [registration use case](../../crates/app/src/modules/identity/mod.rs) calls [Organization's member admission](../../crates/app/src/modules/organization/mod.rs) and [the Audit append interface](../../crates/app/src/modules/audit/mod.rs) with the same transaction. Organization's single coordination row serializes first initialization: the transaction claims Owner before committing, and a failed transaction rolls the claim back too. Later members cannot name their own role through the registration request.

You can copy this transaction boundary into your own business: put the data writes and audit entries that must succeed together into one transaction and collaborate through module-public interfaces. Your business rules stay in your module.

## 2. Password and Session are two different kinds of secret

Passwords use RustCrypto `argon2` 0.5.3's Argon2id default parameters: 19,456 KiB of memory, 2 iterations, 1 parallel lane, a random salt. The computation runs on the blocking thread pool with a 4-slot concurrency cap on memory; a full pool returns a retryable 503. The integration tests execute these parameters for real — a full registration on a single dev build takes about 0.5–0.7 s; that is not a production performance promise, and deployments should verify capacity against a release build on the target machine.

A Session uses a 256-bit secret from the OS random source; the Cookie holds the secret and the database stores only its SHA-256. A high-entropy random secret does not need the expensive hashing a human password does.

<<< ../../crates/app/src/modules/identity/crypto.rs

Sessions default to a 7-day absolute lifetime and a 24-hour idle lifetime, both judged by database time; a session lookup for a deactivated member fails immediately. The associated CSRF token derives from the current session secret via HMAC-SHA256, stays stable across refreshes, and is delivered in the response body for subsequent Cookie mutations; it is not a substitute for the Cookie login.

## 3. Registration commits and session issuance are separate

The account transaction commits first; the Session is issued after. If the second step fails, the API returns `auth.session_unavailable` and the page states clearly that the account was created — no need to register again. Repeated requests never overwrite the original password or role. The next login chapter verifies the full recovery-to-login path.

The request JSON cap is 16 KiB (413 beyond it); the request body may wait up to 3 seconds, returning a 408 with a request_id if not fully received. The database transaction waits at most 3 seconds and session issuance has its own 2-second budget. The timers are separate so that "the account was created but the session timed out" is never misreported as an ordinary registration failure. A network interruption can also swallow a successful response; the client never auto-retries the registration POST.

## 4. Onto the real page

After `just generate`, the Rust OpenAPI produces `registerUser`, `getCurrentSession` and the related DTOs. The [register view](../../packages/views/src/identity/register-view.tsx) uses the generated SDK and shadcn field controls, showing submit state, validation and failures carrying a request_id. Page texts come from the Core bilingual catalog, rendered in the device language or the manual choice, and the page itself can switch language and light/dark theme directly (see [Appearance and language](28-appearance-language.en.md)); server errors map to local texts by stable code (such as `auth.email_exists`). On success the old identity query cache is cleared before entering the signed-in home page.

The session secret is never stored in localStorage nor returned to JavaScript. API responses use `Cache-Control: no-store`. Over HTTPS the `__Host-saas_session` Cookie carries `Secure / HttpOnly / SameSite=Lax / Path=/` with no Domain set. Development allows loopback HTTP only.

`APP_ORIGIN` is the trusted browser origin — `http://127.0.0.1:5173` locally, your own HTTPS origin in production. The API never infers it from a submitted Host header; registration requests must carry a matching Origin. When you change the web port, change this setting with it — see the [configuration reference](site:reference/config.md).

## 5. Verifying the error-prone parts

```bash
node scripts/test-backend.mjs --test registration
pnpm exec vitest run apps/web/src/registration.test.tsx
just check
```

The backend goes through real Routers and PostgreSQL checking duplicate emails, first-Owner concurrency, audit rollback, deactivation protection, password/token storage, trusted origins and secure cookies. The concurrency test first blocks both requests with a database lock, confirms PostgreSQL really holds two lock waiters, then releases; the session test uses another lock to simulate issuance stalling — it never fakes the failure by replacing a private method.

View tests operate inputs and buttons and use a real in-memory Router to verify navigation; MSW substitutes only HTTP. The browser runs once, concentrated after this journey:

```bash
just e2e
```

It uses two independent browser contexts to register two accounts, confirm identity across refresh and check HttpOnly Cookie isolation. Day-to-day changes keep using the targeted tests; the full browser flow is not repeated after every edit and push.

These sources and this tutorial belong to Core; the [example ownership manifest](../../examples/knowledge-base/manifest.json) keeps its business paths empty, and removing the knowledge example later must preserve registration.
