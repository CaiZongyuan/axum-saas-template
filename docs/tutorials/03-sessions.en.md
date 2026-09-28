# Walkthrough: Sign-in, sign-out and session invalidation

This chapter reuses the accounts, password hashing and session storage from the [registration chapter](02-registration.en.md). Run `just dev`, register an account, sign out from the home page, open `/login` and sign back in with the same email and password. Refreshing the home page still shows the current identity.

## 1. Sign-in only verifies an existing identity

`POST /api/v1/auth/login` applies the same email normalization rules as registration. After the server finds the Credential, Argon2id runs on the thread pool; a nonexistent email performs the same grade of password computation, so there is no obviously faster path to probe.

Nonexistent emails, wrong passwords and deactivated members return the same 401. Error responses and logs never contain passwords or hashes. Service failures such as an unavailable database return 503, and the client never auto-resubmits the login request.

On success a fresh high-entropy Session is created, returning the current identity and CSRF token, with the session secret delivered through the HttpOnly Cookie. One account can hold several independent browser sessions; signing in does not kick other devices offline.

A user from the previous chapter's "the account committed but session issuance failed" recovers through this same sign-in flow — no re-registration, no credential overwrite. The [public HTTP tests](../../crates/app/tests/sessions.rs) trigger that failure with a real database lock and verify the recovery.

## 2. Why a Cookie still needs a CSRF token

The browser attaches Cookies automatically, so the server cannot accept a mutation on "the request carries a Cookie" alone. Registration and sign-in first require a matching `APP_ORIGIN`; sign-out checks the Origin and that the `x-csrf-token` belongs to the current Cookie session.

The CSRF token derives from the current session via HMAC-SHA256 and is compared with a mature library's constant-time interface. Another session's token, a missing token or an invalid Origin cannot revoke the current session. The API is same-origin by default and never enables credentialed CORS for external Origins.

`POST /api/v1/auth/logout` revokes the current session in the database, then returns the Cookie-clearing response. The old Cookie then gets a 401 from `/api/v1/auth/session`. Repeating the same valid sign-out is idempotent and never revokes other browsers' sessions.

## 3. What the absolute and idle lifetimes each govern

- The absolute lifetime counts from issuance, 7 days by default; continuous use never extends it without end.
- The idle lifetime counts from the last valid read, 24 hours by default; a valid session lookup refreshes it.

Both use database time. A deactivated member or a revoked session is rejected immediately, without depending on client clocks, Redis or long-lived JWTs.

Tests construct the boundary conditions by setting expired/idle timestamps, then check results through the real HTTP interface — never by waiting a real 24 hours. See the [generated configuration reference](site:reference/config.md) for the settings.

## 4. Letting the page follow identity changes

The [login view](../../packages/views/src/identity/login-view.tsx) shows submission, controlled failures and retry; the [home page](../../packages/views/src/identity/home-view.tsx) queries the current session through the SDK and performs sign-out. Both pages take their texts from the Core bilingual catalog: the interface language and light/dark theme switch before any sign-in, and sign-in failures map to local texts by stable code (`auth.invalid_credentials`) while keeping the request_id (see [Appearance and language](28-appearance-language.en.md)).

On a successful sign-in or sign-out, in-flight queries are cancelled and the Query cache cleared before the new current-session state is written. When a session refresh notices an identity/role change or invalidation, it clears the other queries the same way — covering the case where the current page regains focus after another tab switched accounts. The tests deliberately keep the previous identity's query cache and assert its removal after the switch. Password forms use short-lived component/request memory, and mutations leave no cache behind; passwords and session secrets never enter localStorage or any persisted business state.

When the session query returns 401, the home page drops the signed-in identity and offers the sign-in entry; 503-class service failures stay retryable errors, never disguised as a successful sign-out.

## 5. Running this chapter's checks

```bash
node scripts/test-backend.mjs --test sessions
pnpm exec vitest run apps/web/src/sessions.test.tsx
just check
```

The focus: consistent responses for invalid credentials, Origin/CSRF validation, old-Cookie rejection after sign-out, absolute/idle expiry, deactivated members, and recovery sign-in after a failed session issuance.

The browser journey runs once at the end of this chapter: `node scripts/e2e.mjs tests/e2e/registration.spec.ts` — two independent browsers register, refresh, sign out, verify the old Cookie dies, then sign back in. Day-to-day changes use the targeted feedback loop above.

Authentication tests record no trace/screenshots by default and keep no HTML reports with action parameters. `test-results/summary.json` records only test names, results, durations and source locations; raw exceptions and page snapshots are not kept — correlate with the services' request_id logs. Public-state scenarios without credentials may keep traces and screenshots.
