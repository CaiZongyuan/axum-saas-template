# Walkthrough: Backing up and restoring documents, attachments and jobs in an isolated environment

This chapter answers "how production data is backed up and how restorability is proven". A backup is not "copying the volume directory" — it is an auditable process: inside a maintenance window new changes are stopped and in-flight requests are drained, the database gets a consistent snapshot, and every ready object is verified against the database registry. A restore always enters an isolated empty environment rebuilt from the archive plus protected configuration, and then a real API journey proves that accounts, documents, attachments and queued jobs all came back. Two operations commands (`production-backup`, `production-restore`) cover daily use, and the [automated drill](../../scripts/production-restore-drill.mjs) turns the whole "backup → restore → verify" chain into one command that generates fresh secrets, a random project name and fresh data on every run.

## 1. What the backup contains — and what it does not

The archive produced by `just production-backup` = database snapshot + object manifest + manifest-verified object bytes + report:

| Archive content    | Form                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `database.dump`    | `pg_dump -Fc` custom format including `_sqlx_migrations`, restorable across versions with `pg_restore`                           |
| `manifest.json`    | Application image and digest, migration version and count, `sha256` and size of every ready file                                 |
| `objects/`         | The exact bytes of every ready object in the manifest, written to disk only after a per-object digest check against the database |
| `backup-report.md` | PASS/FAIL verdict with check details, for human review                                                                           |

Registering only ready objects is by design: ready objects are immutable and their content digest lives in the database (`saas_core.files.sha256`), so "database snapshot + ready objects" forms one self-consistent point — manifest and snapshot corroborate each other, and anything missing on either side is detectable (extra objects are reported but do not fail the backup, such as staging keys not yet cleaned up). Staging objects of pending uploads are not in the backup: after a restore they expire by TTL and are cleaned up idempotently — exactly the behavior the drill verifies.

Secrets are not in the archive. `POSTGRES_PASSWORD`, `S3_*` and `MAIL_ENCRYPTION_KEY` belong to the protected configuration and are provided separately from the deployer's environment file at restore time — losing the archive leaks no secrets, and holding only the archive without the environment file does not open the database. Archive and secrets are stored and authorized separately (the local Caddy root CA could likewise issue entry certificates; the script writes it only to a temporary directory and never into the archive).

## 2. The maintenance window: stop changes, drain, snapshot

```bash
just production-backup ENV_FILE=.env.production   # The archive lands in backups/<timestamp>/
```

The [backup script](../../scripts/production-backup.mjs) runs the full window sequence with a stopwatch: first the API stops (no new mutations; 30s grace period; the logs must contain `draining HTTP requests`), then the Worker stops (in-flight claims finish; 45s grace period; the logs must contain `stopping worker claims and draining current work`). If either reaches compose's kill grace period instead of exiting by itself, the script fails immediately. Only with both writers stopped is what `pg_dump` receives a consistent point free of new changes — the flip side of "assume staging PUTs stopped without stopping the API" is that the drain must really happen. No new requests can enter during the window, while already-queued jobs (such as exports) stay in the database job table and are claimed and completed by the Worker after recovery — nothing is lost. The stack ends the backup stopped; a plain `just production-up` restarts it.

The object side needs no separate freeze: ready objects are immutable, the manifest is generated row by row from the database (`ready_key`, `sha256`, `actual_size` of `state = 'ready'` rows) and then cross-checked against the bucket via ListObjectsV2 through the entry. Object operations are signed with the [minimal SigV4 implementation](../../scripts/lib/sigv4.mjs) using `S3_PUBLIC_ENDPOINT` — the same path as presigned URLs, whose correctness is pinned byte-for-byte against the official AWS get-vanilla test vectors ([tests](../../tests/tooling/backup-sigv4.test.mjs)); every object is also downloaded and compared against the database digest before it enters the archive.

## 3. Restore: an isolated empty environment, never an overwrite

```bash
just production-restore ARCHIVE=backups/20260927-120000 ENV_FILE=.env.production
```

The [restore script](../../scripts/production-restore.mjs) targets an isolated environment by default: a different compose project name (default `axum-saas-production-restore-<timestamp>`), with network and volumes all newly created. The script refuses outright when the project name matches production — same name means same volumes, the one overwrite path. It publishes the same ports as production, so the production composition must be fully stopped first; replacing it requires an explicit `down -v` of the old environment, and that decision is always a human's. The script then: starts dependencies → `pg_restore --no-owner --exit-on-error` (a half-restored database never passes silently) → `storage-init` creates the bucket → starts the entry (object PUTs must pass through Caddy for signatures to be valid) → signed-PUTs every file from `objects/` back into the bucket per `manifest.json` → starts the app → structural verification (readiness, migration versions matching the manifest, bucket contents matching the manifest). The restore report lands in the archive and the restored stack keeps running for human inspection. The app never migrates or creates buckets implicitly — the restore environment obeys the same contract as a first deployment.

## 4. The drill: automated proof that this archive really restores

```bash
just production-restore-drill
```

The [drill script](../../scripts/production-restore-drill.mjs) builds its own images and generates its own secrets and environment file (mail configured but unreachable, telemetry endpoint down — degradation runs through the whole journey), then drives the same two commands from sections 2 and 3 through the full chain and appends journey assertions:

1. **Seed**: register an owner, write a document with known content, upload an attachment with known bytes and complete it, open one **pending upload whose bytes never arrive** as the expiry victim, then queue an export after stopping the Worker.
2. **Window and backup**: `production-backup` drains and times the window, producing the dump, manifest, verified objects and backup report.
3. **Rebuild**: the drill runs `down -v` on the production project to free the ports, then `production-restore` rebuilds the isolated project from the archive alone.
4. **Journey verification**: the original session cookie still works (sessions live in the restored database); the document and attachment read back byte-for-byte; the queued export is completed by the restored Worker to `succeeded` with zip content identical to the source; the pending upload expires to the `expired` terminal state and `object_cleanup` records `first_deleted_at` for the staging key — the cleanup stays idempotent even though the object never existed; no job ends `failed`.
5. **Report**: three reports stay in the archive (`drill-report.md`, `backup-report.md`, `restore-report.md`); any failure outside PASS ends the drill with a `[phase-name]` prefix.

The upload TTL is 15 minutes (the `upload_secs` policy default), and the drill does not wait it out: it rewinds that row's `expires_at` into the past in the restored database, while the real maintenance sweep (30-second period) and cleanup job still perform the expiry, cleanup enqueue and idempotent deletion — the drill moves the clock, production code always runs the state machine.

The drill is repeatable: project names carry the PID, secrets are random, and it ends with `down -v` on both projects plus deleting the environment file and the temporary root CA; the archive stays under `.scratch/` for review (it contains only drill data). If ports 80/443 are taken, the production composition is still running — run `just production-down` first; that is the natural troubleshooting step of the "restore never touches production" constraint. The [manifest logic tests](../../tests/tooling/backup-manifest.test.mjs) verify manifest normalization, verification semantics and report rendering without Docker.

## 5. Run this chapter's checks

```bash
node --test tests/tooling/backup-sigv4.test.mjs tests/tooling/backup-manifest.test.mjs
just production-restore-drill
just check
```

Like single-machine production deployment, this chapter is a template core capability (Core) and is not registered in the example ownership manifest — the backup/restore tooling serves anyone deploying from the template and is not removed with the example business. Backup and restore are two halves of one tool: every drill run also proves "this archive really restores", a stronger promise than "the backup succeeded".
