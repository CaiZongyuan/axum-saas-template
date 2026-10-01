# Versioned Cache, Reauthorization and Database Fallback

Goal: cache large text or read-only computed results while PostgreSQL decides current version and eligibility. Define versions and authorization first. Optional Redis is not business, identity or permission truth.

<!-- example:knowledge:reference-01:start -->

Complete reference: [versions](06-edit-conflicts.en.md); [authorization](07-library-grants.en.md).

<!-- example:knowledge:reference-01:end -->

## Public Text Cache Interface

[Platform Cache](../../crates/platform/src/cache.rs) exposes `Cache::from_env / new / disabled` and these method excerpts:

```rust
pub fn deadline(&self) -> tokio::time::Instant;
pub async fn get(&self, key: &str, deadline: tokio::time::Instant) -> Lookup;
pub async fn put(&self, key: &str, value: &str, deadline: tokio::time::Instant)
    -> Result<(), CacheUnavailable>;
pub async fn remove(&self, key: &str, deadline: tokio::time::Instant)
    -> Result<(), CacheUnavailable>;
```

`Lookup` is Hit(String), Miss, Unavailable or Disabled. Share one Cache between CoreOptions and your Router so protected `/api/v1/system/cache` observes actual cumulative counters. See [API assembly](../../apps/api/src/lib.rs).

## Authorize and Read Version First

Knowledge reading checks current Membership, resource/base deletion and Grant in PostgreSQL for each request, obtains current title/version/can_edit, then reads:

<!-- example:knowledge:reference-02:start -->

Complete reference: [Knowledge reading](../../crates/app/src/modules/knowledge/application.rs).

<!-- example:knowledge:reference-02:end -->

```text
<CACHE_PREFIX>:knowledge:body:v1:<document_id>:<version>
```

Cache stores only Markdown for that version, never Sessions, roles, Grants, title, capability flags or whole responses. Authorized users share body text while eligibility is checked per request. Concurrent edits may commit after a read starts, but body and returned version must match.

On miss, reauthorize in the database and require the previously observed version. If changed, reread eligibility/version and try the new key. After at most two rounds, read completely from the authorized database path and skip filling. Timeout, disconnect, wrong type, non-UTF-8, oversize and disabled Redis all fall back without polluting an old version key.

## Invalidate after Commit

Commit body/version/Audit before removing the old key. Failure increments invalidation_failures without turning a committed save into business failure; independent TTL defaults to 60 seconds. Late readers may fill old keys, but new requests read the current database version first. Revocation/deletion reject before cache access too.

Your module defines keys, versions, authorization queries and matched-version fallback. Do not call private Knowledge reads or cache whole member-specific DTOs.

## Budgets and Outage Observation

GET/fill share a default 100 ms budget. Each short connection attempts once with at most 16 concurrent operations; saturation immediately falls back. Values are at most 1 MiB UTF-8. Size checks follow client parsing, so they do not prevent transient allocations from a malicious huge Redis response. Cancellation releases connection ownership without proving accepted writes were revoked.

[Configuration](site:reference/config.md) lists `REDIS_URL / CACHE_PREFIX / CACHE_TTL_SECS / CACHE_BUDGET_MS`. Unset URL disables caching; invalid settings fail before listening. Never log URLs/raw Redis errors. Development Redis uses 128 MiB noeviction without RDB/AOF; memory-pressure errors fall back.

Stop/restore Redis only in your development environment:

```bash
docker compose stop redis
docker compose up -d --wait redis
```

Business reads still succeed with increased fallbacks, without failing database readiness. Only Owner/Admin can read counters. Compare differences; restart resets totals.

## Verify and Continue

Run from the repository root:

```bash
node scripts/test-backend.mjs --test cache --test config
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test cached_documents
```

<!-- example:knowledge:reference-03:end -->

HTTP checks cover miss/hit, new versions, revocation/deletion, unshared permissions and bounded fallback. A [Redis gate](../../tests/support/redis_gate.rs) forwards real Redis and uses controlled barriers to test edits during misses without stale-key pollution and blocked GET deadlines. Add equivalent version/authorization/outage assertions, then configure [rate limits](17-rate-limits.en.md).

<!-- example:knowledge:reference-04:start -->

Complete reference: [HTTP checks](../../apps/api/tests/cached_documents.rs).

<!-- example:knowledge:reference-04:end -->
