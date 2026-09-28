# Walkthrough: Job recovery, attempt budgets and administrator retries

Request a document export, sign in as an Owner or Admin, and open "Background jobs" from the "Administration" group in the left navigation. Failed jobs are listed by default; you can switch to queued, running, succeeded or all statuses, and the filter lives in the URL, so switching the language or theme never clears it. Open a record to inspect the current batch, the attempt history and the safe error summary.

Failed jobs offer "Retry failed job". The operation keeps the original job ID and business request and opens a bounded new batch. The old record stays readable; succeeded jobs have no such entry. The business handler still checks the original requester, credentials and source resource, so re-running never restores revoked access.

## 1. Why claiming itself consumes an attempt

[Core Jobs](../../crates/app/src/modules/jobs/mod.rs) increments attempts inside the claiming transaction, generates a new lease_token and records the attempt. Even if the process dies immediately afterwards, the attempt has been spent.

Once the lease expires, the next worker may re-claim a job that still has budget. The earlier attempt is recorded as lease_expired; when the budget is exhausted the job turns failed and is not re-claimed endlessly. Transient errors enter retry_wait with exponential backoff and full jitter; permanent errors fail directly. Every enqueue call states its bounded `max_attempts`, and the database limits it to 1–20.

The knowledge-base export's `EXPORT_JOB_MAX_ATTEMPTS` defaults to 5. That is example configuration; when you replace the business, the new handler uses its own sensible budget. See the [generated configuration reference](site:reference/config.md) for details.

## 2. A stale worker cannot submit new results

Every claim carries its own token; renewal, failure and success all require the current token still inside its validity window. Success commits inside the caller's transaction, completing the business result, the job and the attempt history together.

For example, the first worker pauses after uploading and its lease expires; a second worker takes over and finishes. However long the first worker keeps running, it cannot overwrite the result with its old token. Handlers may run twice, so external side effects need their own idempotency strategy; this example protects exports with non-overwritable candidate objects and a unique database publication.

The [worker loop](../../crates/app/src/modules/jobs/worker.rs) advances the handler and the renewal independently. If the renewal SQL waits on the publication transaction's row lock, the handler can still finish its transaction. When renewal fails, the worker first cancels the underlying handler future and releases its transaction, then writes the failure state; the failure write has its own deadline. Two real PostgreSQL lock-wait regression tests protect this ordering.

Shutdown stops claiming first and gives current executions a bounded time to finish. After a timed-out cancellation the running lease is kept and left to expire naturally for recovery; a job that still produces side effects is never handed to another worker early. Blocking ZIP work already started keeps following the previous chapter's cooperative cancellation and resource ownership rules.

## 3. New batches keep the old history

[migration 0010](../../migrations/0010_job_history.sql) records JobBatch and JobAttempt. The job points at its current batch; attempt records keep the number, executor, start and end times, lease deadline and safe error codes. Claiming, renewal and terminal transitions update the related records in one database transaction.

When upgrading from earlier versions, old jobs keep only the summaries available at the time; a still-running current attempt is recorded, and the missing historical timeline is never fabricated. Newly produced attempts are recorded one by one.

The [administration use case](../../crates/app/src/modules/jobs/administration.rs) authorizes by current effective member role — only Owners/Admins may read or retry. The retry transaction locks the failed job, creates the next batch, resets the bounded budget and writes the audit and idempotency records together; an audit failure rolls everything back. Resubmitting the same command never opens another batch, and concurrent requests cannot bypass the state constraints.

The [HTTP entry points](../../crates/app/src/modules/jobs/management.rs) provide list, detail and retry. The list uses a reverse cursor bound to the identity and the status filter; the detail serves at most ten batches per page with older history on demand. Responses contain no payload or lease_token — administrators see status, error summaries and the correlated request.

## 4. How the frontend joins the recovery operation

The [shared job views](../../packages/views/src/jobs/jobs-view.tsx) call the Core API through the generated SDK and render inside the universal shell; the interface follows the "Appearance & language" setting, and the page and its operations read Background jobs, Job status, All statuses, View record, Retry failed job, Job details and Execution history. The web app owns routing and the view navigates through callbacks; the administration pages survive once the knowledge-base example is removed.

Running records refresh their progress. A failed request may retry the same command; after a successful submission the latest history returns, and job state changes or revoked permissions refresh the related queries and the session. Plain members see no "Administration" group in the sidebar, direct visits are rejected by the backend, and the page reads "Only organization owners and administrators can manage background jobs."

Error summaries exist to locate problems; the original request's correlation ID keeps serving the later audit and observability chapters. An administrator retry never mutates the export snapshot. When the original session has been revoked or the snapshot has expired, a user with permission should request a new export.

## 5. Verify with controlled failures

```bash
node scripts/test-backend.mjs --test jobs --test exports
pnpm exec vitest run apps/web/src/jobs.test.tsx
just check
```

The public job/HTTP tests use real PostgreSQL and synchronization points to cover:

- crashing after a claim still spends budget, and reaching the cap turns the job failed;
- two workers continue each other, and a late stale result is never published;
- transient retries are scheduled by scheduled_at with business parameters unchanged;
- shutdown waits boundedly and never releases the lease early;
- administrator permissions, the bounded new batch, history, idempotency and audit rollback;
- publication racing renewal, and transaction release after a renewal timeout.

Timing tests explicitly advance lease/schedule times in the database; races are organized with Notify and real lock waits, never arbitrary sleeps guessing at timing.

Run a real browser once when the key journey completes:

```bash
node scripts/e2e.mjs tests/e2e/job-recovery.spec.ts
```

The isolated runner uses a shorter but bounded test budget. The test first pauses the RustFS it created, watches the export running, then force-kills the runner's own worker; storage is restored, the runner's supervisor starts a replacement worker, and the export is verified to finish. Storage is then made unavailable again, the budget is allowed to run out, and the real administrator page retries the job while success and the old history are observed.

The test only touches its own containers and processes, restores storage in `finally` and confirms worker health. The replacement worker is managed by the runner, services stay up for later tests in the same round and shut down together at the end. The worker's temporary root follows the same runner isolation and cleanup; when a production process meets SIGKILL, the local temporary directory still respects the previous chapter's declared cleanup boundary. The browser report keeps sensitive traces/screenshots off, preserving only safe summaries.

The default `just check` does not repeat the browser failure journey. The next chapter reuses these reliable jobs to clean up deleted documents, attachments and expired objects.
