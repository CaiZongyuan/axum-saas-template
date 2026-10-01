# Public Errors and Troubleshooting

Choose recovery by HTTP status, then branch on stable `error.code`. [ApiErrorResponse](site:reference/api.md#schema-ApiErrorResponse) and [ApiError](site:reference/api.md#schema-ApiError) define the generated structure; business code should not maintain another DTO. `error.message` is public explanatory text, not a client branch key. Current `public_error` returns empty `details`; do not expect database exceptions or form field errors.

## Request Correlation

Core [request_context](../../crates/app/src/http.rs) generates a new `RequestId` per request and returns `x-request-id`. Error JSON uses that same value in `error.request_id`. Client-supplied request ids are not directly trusted. Record method, route, status, stable code and request_id, then correlate through Logs and tracing. Exclude Cookies, Authorization, request bodies and signed URLs.

With the local API running, observe a safe failed request:

```sh
curl -i http://127.0.0.1:18000/api/v1/does-not-exist
```

Expect `404`, `http.not_found`, `x-request-id` and a matching JSON request_id. HTML or a proxy error means the response has not reached Core's error boundary; check proxy targets and paths first.

## HTTP and Authentication

| Status    | Stable code / source                                                                                                                                           | Recovery                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 400       | [`http.invalid_json`](../../crates/app/src/http.rs), [`http.invalid_query`](../../crates/app/src/http.rs), [`http.invalid_path`](../../crates/app/src/http.rs) | Correct JSON, query or path types; do not retry unchanged input                                        |
| 404 / 405 | [`http.not_found`](../../crates/app/src/http.rs), [`http.method_not_allowed`](../../crates/app/src/http.rs)                                                    | Check API assembly, paths and HTTP methods against current OpenAPI                                     |
| 408 / 413 | [`http.body_timeout`](../../crates/app/src/http.rs), [`http.payload_too_large`](../../crates/app/src/http.rs)                                                  | Check upload speed or reduce the body; use Files for binary content instead of increasing JSON budgets |
| 401       | [`auth.unauthorized`](../../crates/app/src/modules/identity/mod.rs), [`auth.invalid_credentials`](../../crates/app/src/modules/identity/mod.rs)                | Log in again or provide an active credential; Bearer never falls back to Cookie                        |
| 403       | [`auth.origin`](../../crates/app/src/modules/identity/mod.rs), [`auth.csrf`](../../crates/app/src/modules/identity/mod.rs)                                     | Check APP_ORIGIN; refresh Session and use its current csrf_token for mutations                         |
| 403       | [`api_keys.scope_forbidden`](../../crates/app/src/modules/api_keys/authentication.rs)                                                                          | Obtain the required scope; business rules still check resource access                                  |
| 409       | [`auth.email_exists`](../../crates/app/src/modules/identity/mod.rs)                                                                                            | Use the existing account or choose another registration email                                          |
| 429       | [`rate_limit.exceeded`](../../crates/app/src/http.rs)                                                                                                          | Honor `Retry-After` with bounded backoff; avoid concurrent retry loops                                 |
| 503       | [`database.unavailable`](../../crates/app/src/lib.rs), [`auth.unavailable`](../../crates/app/src/modules/identity/mod.rs)                                      | Check database, migrations and connection budgets; retain request_id and bound retries                 |
| 503       | [`auth.session_unavailable`](../../crates/app/src/modules/identity/mod.rs)                                                                                     | Account creation may already have committed; log in instead of registering again                       |

## Files and Jobs

| Status    | Stable code / source                                                                                                                     | Recovery                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 400 / 413 | [`files.invalid_input`](../../crates/app/src/modules/files/mod.rs), [`files.too_large`](../../crates/app/src/modules/files/mod.rs)       | Correct filename, media type, size or SHA-256; generated configuration defines limits            |
| 404 / 410 | [`files.not_found`](../../crates/app/src/modules/files/mod.rs), [`files.upload_expired`](../../crates/app/src/modules/files/mod.rs)      | Check business ownership for the former; start a new upload session for the latter               |
| 409       | [`files.upload_missing`](../../crates/app/src/modules/files/mod.rs), [`files.upload_changed`](../../crates/app/src/modules/files/mod.rs) | Upload actual bytes first; changed content requires completion verification again                |
| 422       | [`files.upload_rejected`](../../crates/app/src/modules/files/mod.rs)                                                                     | Start a new upload session and recalculate size/hash                                             |
| 503       | [`files.unavailable`](../../crates/app/src/modules/files/mod.rs)                                                                         | Check matching API/Worker storage settings, bucket and service availability; use bounded retries |

Job errors are separate from HTTP statuses. Handlers return [JobError](../../crates/app/src/modules/jobs/mod.rs): `Permanent` ends the current batch, `Transient` retries within budget and `LostLease` prevents publication. Job details and attempt records expose last_error. The Recovery guide explains when administrators start a new batch. Retain job_id, correlation_id and the original request_id.

## Your Business Errors

Define Domain failures first, then map them through [`public_error`](../../crates/app/src/http.rs) to statuses and stable codes with a business prefix. Transaction failures roll back. Payload mismatch for an idempotency key and stale-version mutations should return `409`, preserving existing data. Add public failure behavior checks for these branches; see [Testing feedback loop](../testing/t01-feedback-loop.md).

Startup `ConfigError` occurs before HTTP exists. Check the named variable against [Configuration sources](configuration-sources.md). For API readiness failure, verify migrations first. For a Worker that does not claim jobs, check kind registration and running state before leases and attempt budgets.

<!-- example:knowledge:reference:start -->

The reference domain's [Logs and tracing guide](../tutorials/19-observability.md) and [Job recovery guide](../tutorials/11-job-recovery.md) provide complete request/job investigation flows. Removing knowledge leaves the Core error reference and public source entries available.
<!-- example:knowledge:reference:end -->
