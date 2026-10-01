# Classified Rate Limits and Bounded Redis Fallback

Goal: reuse Core budgets, common 429 responses and Redis outage fallback. Compose your business Router through Core first. Allowed requests still need authentication, CSRF and authorization.

## Enable at the Actual Assembly Point

[RateLimiter](../../crates/app/src/modules/rate_limit/mod.rs) exposes `from_env`, `local(limits, clock)` and `redis(limits, clock, settings)`. Integration excerpt; complete application is [configured_router](../../apps/api/src/lib.rs):

```rust
let options = saas_app::CoreOptions {
    limiter: saas_app::modules::rate_limit::RateLimiter::from_env()?,
    ..Default::default()
};
```

Pass options to `compose_routes_with_options`; use `rate_limit::describe` for the 429 contract. The production API enables this. Default CoreOptions disables the limiter, so focused tests/custom assembly choose explicitly rather than assuming every Router enables it.

| Fixed 60-second policy | Classification                                | Redis limit | Local fallback |
| ---------------------- | --------------------------------------------- | ----------: | -------------: |
| registration           | Registration POST                             |          20 |              5 |
| authentication         | Auth POST excluding register/logout           |          60 |             20 |
| resource               | Other API/business requests, including logout |         600 |            120 |

`/health/live /health/ready` are exempt. New ordinary business routes use resource. Special categories require explicit Core classification/configuration/contract changes rather than a duplicate unbounded-label limiter.

## Client Identity and Fallback

Buckets hash direct TCP peer IP, ignore ports, normalize IPv4-mapped IPv6 and distrust `X-Forwarded-For`. Users behind a proxy share its IP budget; trusted forwarding requires a separate policy. Missing ConnectInfo uses a shared unknown bucket; the API executable supplies real ConnectInfo.

The [Redis counter](../../crates/platform/src/rate_limit.rs) atomically decides/updates TTL in one Lua operation; matching namespace/policy/window shares across API instances. Every request also consumes the local window, including normal Redis/rejection. Outages use spent local budget with a lower ceiling, never resetting allowance. A timed-out command may have been accepted and is not resent.

Redis defaults to 50 ms total, independent concurrency and one attempt. Local state is at most 4096 entries; saturation uses conservative overflow windows instead of evicting consumption. Restart resets local state; this is not durable multi-machine quota. Adjacent fixed windows may permit two bursts, not uniformly sliding rates.

## Observe HTTP Limits

Temporarily configure your `.env`, restart development API and restore defaults afterward:

```dotenv
RATE_LIMIT_RESOURCE=2
RATE_LIMIT_RESOURCE_FALLBACK=1
RATE_LIMIT_WINDOW_SECS=3
```

```bash
curl -i http://127.0.0.1:18000/api/v1/system/status
curl -i http://127.0.0.1:18000/api/v1/system/status
curl -i http://127.0.0.1:18000/api/v1/system/status
```

The third same-window request returns `429 rate_limit.exceeded`, integer Retry-After, `error.details.retry_after_seconds` and request_id. Other concurrent requests also consume budget. Users explicitly retry after the window; never automatically resubmit POST. [Generated configuration](site:reference/config.md) defines limits; fallback is positive and cannot exceed the normal ceiling.

Owner/Admin can query `/api/v1/system/rate-limits` for fixed-class totals/local entry counts without raw IP/bucket/credentials. The endpoint also consumes resource allowance. Redis failure neither bypasses identity checks nor fails database readiness.

## Verify

Run from the repository root:

```bash
node scripts/test-backend.mjs --test rate_limits --test config
```

[Public HTTP checks](../../crates/app/tests/rate_limits.rs) use real Redis/controlled clocks for windows, sharing, spent-budget fallback, overflow, forged forwarding and retained authentication. Add 429 contract/manual-recovery checks to your business; continue with [password reset/mail](18-password-reset.en.md) or [observability](19-observability.en.md).
