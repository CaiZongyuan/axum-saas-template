# Walkthrough: Managing members and protecting the last owner

Run `just dev`, sign in with the first registered account, and open "Members" from the "Administration" group in the left navigation (the old address `/members` is unchanged and works as a direct visit too). The interface follows the "Appearance & language" setting; in English the page and its operations read Members, Role, Member is active, Save member and Reload the list. Register a colleague's account in a private window, reload the roster as the Owner, then change their role or deactivate them. Every change is applied only by an explicit "Save member" click.

The "Administration" group is visible to Owners and Admins only. A plain Member sees no entry at all, and visiting `/members` directly shows the permission alert instead of a roster.

## 1. A change is one versioned request

The [organization management API](../../crates/app/src/modules/organization/management.rs) provides a paginated member list and `PUT /api/v1/organization/members/{user_id}`. The request carries `role / active / version`; a stale version returns 409 — click "Reload the list" and retry.

A rejected change keeps your selection on screen along with the error and its request ID. Refreshing the list is an explicit recovery action; background re-fetching never silently bumps the version your local form is holding. The backend paginates at 50 per page (100 maximum), binds the cursor to the current administrator, and sorts stably by member ID.

## 2. Why it is not count-then-update

Two owners can both see "there are still two owners" outside any transaction, then demote themselves to Member at the same time — leaving the organization without one.

The [pure rules](../../crates/app/src/modules/organization/domain.rs) only decide whether a given change is allowed; the [transactional use case](../../crates/app/src/modules/organization/management.rs) guarantees the facts it reads cannot be preempted by another management operation:

1. Lock the single organization coordination row.
2. Lock the actor's and the target's memberships in a fixed order by member ID, then re-check the actor's current role.
3. Read the count of enabled owners inside the transaction, and validate role boundaries, version and the last-owner constraint.
4. Update the member, revoke the sessions that must go, append the audit entry, and commit together.

First registration coordinates owner initialization through the same organization row. Afterwards the last enabled owner can never be demoted or deactivated: the API returns `422 organization.last_owner`. Under concurrent sign-outs exactly one operation succeeds; the other sees the freshest set and is rejected.

Knowledge-base writes already share the membership lock in shared mode; role changes and deactivation take the exclusive lock, so they commit in order with business writes. Any future operation touching several members must take its locks in the same fixed ID order.

## 3. Deactivation and session revocation commit together

Letting authentication alone check `active = false` is not enough: after re-enabling, the old cookies could become valid again. Deactivation therefore goes through Identity's [public session revocation endpoint](../../crates/app/src/modules/identity/mod.rs), revoking every session of that user in the same transaction as the member change and the audit entry.

Session issuance also holds the membership shared lock. Deactivation waits for an in-flight issuance to finish, then revokes what it produced; if the deactivation commits first, the issuance re-reads the inactive state and refuses. After re-enabling the user must sign in again with the password — old cookies stay invalid.

Registering the same email again still conflicts: it cannot restore the member, change roles or overwrite the original password. When the audit write fails, role, active state, version and the session revocations roll back together.

## 4. Core and the reference example stay independent

Organization touches only its own organization and membership tables. Member names and emails are read through Identity's batch profile endpoint, avoiding cross-module joins into private tables and one query per member. Session revocation likewise goes through Identity's public endpoint.

The [shared members page](../../packages/views/src/organization/members-view.tsx) renders inside the universal shell's administration group, reusing the generated SDK, Query, the shared Field / Select / Switch components, and the Core bilingual catalog in [core-messages.ts](../../packages/views/src/shell/core-messages.ts). Saved member resources live only in Query; each row form's role, active flag and version are an uncommitted draft. After a change the list and the current session are re-queried, and interface caches that lost their entitlement are cleared.

This chapter belongs to SaaS Core: removing the knowledge-base example keeps the member management API, page, migration, tests and tutorial. It never reads the document or grant tables. The knowledge-base example may use the same member directory to pick grant recipients.

## 5. Verify concurrency and the experience

```bash
node scripts/test-backend.mjs --test members --test membership_policy
pnpm exec vitest run apps/web/src/members.test.tsx
just check
```

Domain tests cover the owner set and admin boundaries. HTTP tests run against a real multi-connection PostgreSQL and cover two owners signing out concurrently, the role matrix, version conflicts, audit-failure rollback, and the controlled race between session issuance and deactivation. View tests drive save, rejection, conflict recovery and server-decided editability through the public page.

Run this once at the end of the key flow:

```bash
node scripts/e2e.mjs tests/e2e/members.spec.ts
```

The browser test creates the colleague account through the normal registration page, has the Owner change the role and deactivate, and confirms the colleague loses the session after a refresh — re-enabling never revives the old cookies. The test entry prepares its own dedicated Owner and does not depend on test-file execution order.
