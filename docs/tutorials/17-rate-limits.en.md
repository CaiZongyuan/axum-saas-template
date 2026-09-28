# Walkthrough: Rate limits, wait prompts and the Redis failure fallback

Run `just dev` and the API enables three fixed-window policies by default, with a 60-second window. The same direct TCP peer address shares one budget per policy:

| Policy         | Current request                                                       | Redis available | Local fallback |
| -------------- | --------------------------------------------------------------------- | --------------: | -------------: |
| registration   | POST registration                                                     |              20 |              5 |
| authentication | Authentication POSTs: sign-in and password reset; not register/logout |              60 |             20 |
| resource       | Everything else, including reads, resource writes and logout          |             600 |            120 |

`/health/live` and `/health/ready` consume no budget, so rate limiting cannot make the process health probes misreport. Requests that are allowed still run the normal Session, API key, CSRF and resource permission checks.

## 1. Watch one limit and its recovery on the page

To learn quickly, you can temporarily set these three values in your local `.env` and restart `just dev`:

```dotenv
RATE_LIMIT_AUTHENTICATION=2
RATE_LIMIT_AUTHENTICATION_FALLBACK=1
RATE_LIMIT_WINDOW_SECS=3
```

Open the sign-in page and submit wrong credentials repeatedly within one window. Once the cap is reached, the response is the unified `429` with an integer-second `Retry-After`, a body of `rate_limit.exceeded`, and `error.details.retry_after_seconds` repeating the same wait; request_id is still present.

The registration/sign-in pages keep the input and show a countdown; resubmission is impossible while waiting. When the time is up the button recovers, but no request is sent automatically. Ordinary resource pages show the same wait prompt, and the API/Query layers never retry multiplicatively on their own. After trying it out, restore the default configuration so the learning budget does not affect everyday development.

A fixed window may admit two batches across adjacent window boundaries; nothing here claims a sliding window or a uniform rate. Tune the production numbers against your deployment size and measurements.

## 2. What the Redis counter and the local counter each do

The [Core rate-limit module](../../crates/app/src/modules/rate_limit/mod.rs) sits in front of the route handlers, picks the policy from the real matched route and HTTP method, then hashes the direct peer address into an internal bucket id. The port does not take part in the id, IPv4-mapped IPv6 is normalized to IPv4, and a client-supplied `X-Forwarded-For` is never trusted.

Several users behind the same proxy therefore share the proxy address's budget. Trusted proxy forwarding requires a deployment-time trust boundary; a header any client can forge must never become an identity. Custom assemblies without TCP context use a shared unknown bucket instead of skipping the protection; the real API executable already passes in `ConnectInfo<SocketAddr>`.

The [Redis WindowCounter](../../crates/platform/src/rate_limit.rs) performs "read the current count → compare against the cap → update with TTL" in a single Lua operation. API instances sharing one Redis namespace, policy and window share the budget; once the cap is reached the remote counter stops increasing. Each operation tries once, with its own concurrency and overall deadlines.

The local side also records every request, including consumption while Redis is healthy or refusing. When Redis fails, the decision uses this already-consumed window and the lower local cap — switching stores never restores full quota. A timed-out remote command may already have executed, so the local decision is deliberately more conservative and never resends it just to get a "definitive" answer.

The local map holds at most 4096 peer/policy entries by default, and each new window cleans out expired ones. When capacity is full, new sources share a conservative overflow window per policy; old entries are never evicted to restore quota. A process restart clears local counts; this fallback targets single-machine operation and does not pretend to be a durable cross-machine quota.

## 3. Limits still apply when Redis is down

Stop your development Redis:

```bash
docker compose stop redis
```

Existing consumption stays in the local window; if you are already past the lower fallback cap you keep receiving `429`. The next window restores only what the local policy allows. Redis being unavailable never turns identity checks into allow, and never keeps the API from starting.

Bring Redis back:

```bash
docker compose up -d --wait redis
```

Later independent requests re-establish the connection and try remote counting again. Cache and rate limiting reuse the same [private Redis transport](../../crates/platform/src/redis_transport.rs) connection/timeout implementation, but with separate concurrency capacities — rate limiting never enters the cache's unbounded retry or queueing.

The default total budget for a rate-limit Redis operation is 50 ms, covering connection creation, sending and waiting for the reply; at full concurrency capacity the decision falls back to local immediately. Time is composed of the system time at process start plus monotonic elapsed time; tests inject a controllable clock, so a system clock reset never moves a local window backwards.

## 4. Configuration and observation

The [generated configuration reference](site:reference/config.md) lists the `RATE_LIMIT_*` defaults and ranges: the window, the three normal caps, the three fallback caps, the local entry capacity, the Redis namespace and the operation deadline. A fallback cap must be greater than zero and no larger than its normal cap. Format or range errors fail before listening and report only the field name.

Using Owner/Admin, read from the browser console:

```js
await fetch('/api/v1/system/rate-limits').then((response) => response.json());
```

The result contains only the allow/deny/fallback cumulative counters of the three fixed policies and the local entry total — never raw addresses, bucket hashes, emails, secrets or per-user labels. Request logs keep using route, status and request_id. The metering endpoint itself is protected by the ordinary resource budget.

The default rate-limit entry point of the runtime configuration is enabled. The base router assembly used for focused HTTP tests starts without it; when assembling the application yourself, provide an explicit instance through `CoreOptions.limiter`. The standard API executable already uses `RateLimiter::from_env` — this is not a test-only demonstration.

## 5. The frontend and the public contract

The [unified error factory](../../crates/app/src/http.rs) builds the same `429` envelope and `Retry-After`. The final assembled OpenAPI declares that response for every protected operation, so the generated SDK never needs a second error definition per business.

The [shared wait prompt](../../packages/views/src/system/rate-limit.tsx) only recognizes the public error code and the 1–3600 second range; arbitrary error text is never treated as an executable hint. The authentication form's timer starts from the actual request failure and is cleaned up on leaving the page; the countdown only re-enables the button, with no background resend. Business error views compose the same prompt and keep their existing input and error handling. Inline images and attachment links keep their rate-limit errors too and disable retry while waiting; the prompt uses safe inline markup.

Sign-in/registration success navigation uses a callback that lives as long as the page's observer, so a late authentication response cannot yank the page back after the user left.

## 6. Verification

```bash
node scripts/test-backend.mjs --test rate_limits --test cached_documents --test config
pnpm exec vitest run apps/web/src/rate-limits.test.tsx apps/web/src/registration.test.tsx apps/web/src/sessions.test.tsx
just check
```

The HTTP tests against real Redis/PostgreSQL use a controllable clock to verify thresholds, shared windows and recovery; a [shared TCP forwarding fixture](../../tests/support/redis_gate.rs) disconnects Redis and proves that old consumption still counts and local quota stays limited. Local capacity overflow, the three policies' independence, forged forwarding addresses doing nothing, allowed requests still requiring authentication, the public metering and the generated contract are all verified.

View tests advance the wait with controlled timers and verify there is no automatic POST, the form input survives, and retry is explicitly possible after the wait. After finishing the whole journey, run the isolated browser profile once:

```bash
RATE_LIMIT_AUTHENTICATION=2 RATE_LIMIT_AUTHENTICATION_FALLBACK=1 RATE_LIMIT_WINDOW_SECS=3 node scripts/e2e.mjs tests/e2e/rate-limits.spec.ts
```

Real HTTP requests consume the authentication window, the browser sees the `429` and the wait button, and once the window recovers a real account signs in. Everyday development keeps using the faster HTTP/view checks.

## 7. Extending with your own business

New ordinary business routes automatically inherit the resource policy and the unified error contract; handlers remain responsible for permissions. When you need a different policy, add a bounded category in Core's explicit classification and configuration, metered with stable labels — never build metric labels per document, user or URL.

Rate limiting, configuration, the shared UI prompt, the Redis transport, the authentication tutorial and the matching Core tests survive removing the knowledge base. Your own business never needs a second rate limiter, and Redis never becomes the single source of truth for identity or business facts.
