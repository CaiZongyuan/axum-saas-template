# Back up your business and verify independent recovery

After deployment, prove that business data, Files objects and queued tasks can recover together. A Backup Archive contains a consistent database snapshot, verified ready objects, a manifest and reports from a Maintenance Window. Document exports and direct volume copies cannot replace it.

This guide requires a deployed production stack, Docker Compose, a protected environment file and enough archive space. Run commands from the repository root. Backup stops application writers; restoration creates new persistent volumes.

## Include your business in the backup contract

| Data location                                    | Backup responsibility                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Business schemas in this deployment's PostgreSQL | Included in the full database dump with migration history, Sessions, Jobs and Audit            |
| Ready objects published through Files            | Verified against keys, sizes and sha256 in `saas_core.files`, then downloaded into the archive |
| Pending uploads                                  | Staging objects are omitted; restored uploads expire by TTL and run idempotent cleanup         |
| Additional databases or direct object writes     | Not covered by these tools; extend manifest, verification and drills before promising recovery |
| Secrets and deployment configuration             | Omitted; supplied separately through protected deployment configuration                        |

Use Files to manage file state, immutable content and ownership. The archive contains business data from PostgreSQL, so it still needs access control and retention despite excluding deployment secrets.

## Stop writes, drain and archive

```bash
just production-backup .env.production
```

Use the second positional argument for a chosen archive directory:

```bash
just production-backup .env.production backups/release-before-upgrade
```

The [backup script](../../scripts/production-backup.mjs) first stops API, requiring `draining HTTP requests` and exit before 25 seconds, below Compose's 30-second grace period. It then stops Worker, requiring `stopping worker claims and draining current work` and exit before 40 seconds, below its 45-second grace period. Reaching either budget or failed object verification fails the backup. Queued Jobs remain in PostgreSQL and are not claimed during the window.

After writers stop, the tool runs `pg_dump -Fc`, reads registered ready files, downloads each and verifies sha256 and size. Extra unreferenced objects are reported; missing or mismatched ready objects make the archive inconsistent.

Expect:

```text
database.dump
manifest.json
objects/
backup-report.md
```

`manifest.json` records the image/digest, migration version and object inventory. After checking PASS and its details, restart the original stack with `just production-up .env.production`.

## Restore into an independent empty environment

Stop the production composition to release 80/443 while preserving its volumes:

```bash
just production-down .env.production
just production-restore backups/release-before-upgrade .env.production
```

The Restore Environment gets a different Compose project name, new network and new volumes. The tool rejects the production project name. Releasing production ports does not require deleting production data. Switching traffic is an explicit deployment decision; the tool does not overwrite production volumes.

The [restore script](../../scripts/production-restore.mjs) starts dependencies, runs `pg_restore --no-owner --exit-on-error`, initializes the bucket, starts Caddy, uploads manifest objects, then starts API/Worker. Prepare the archive's matching image and protected configuration: it does not download historical images or implicitly apply new migrations.

Final checks cover readiness, migration version and bucket inventory. It writes `restore-report.md` and leaves the stack running for inspection. A failed `pg_restore` may have partially written the target; remove that failed independent restore project and create a fresh one before retrying.

## Add recovery assertions for your business

After structural verification, use the real HTTPS API to validate a complete business result:

1. Before backup, create a resource with known fields and record its id, version and authorized account.
2. Publish a file with known bytes if the business uses files.
3. Stop Worker, then enqueue a task through the public API before backup.
4. After restore, sign in or use the restored Session; compare resource fields, version and file bytes.
5. Wait for Worker to complete the original queued Job and read its business result. Verify failures/revocation do not publish extra objects.
6. In the drill, expire a pending upload and check its terminal state and staging cleanup.

The existing [automated drill](../../scripts/production-restore-drill.mjs) exercises the same backup/restore commands with the reference application: account, documents, attachment bytes, queued export, pending expiry and cleanup. It creates test projects and secrets, removes its volumes, environment files and temporary certificate afterward, and keeps reports in `.scratch/`. It needs free 80/443 ports. Add your business assertions explicitly; they are not automatically part of this journey.

## Checks and recovery

```bash
node --test tests/tooling/backup-sigv4.test.mjs tests/tooling/backup-manifest.test.mjs
just production-restore-drill
```

Manifest and SigV4 tests require no Docker; the drill runs the real production stack. Identify the process holding conflicting ports before proceeding; volume deletion is not a port-conflict remedy. Preserve reports for object mismatches and compare Files records with storage. Recover missing deployment secrets from protected configuration; they cannot be derived from the archive.

These tools belong to SaaS Core and survive reference application removal. Next: [Integrate your recovery assertions into the feedback loop](../testing/t01-feedback-loop.md).
