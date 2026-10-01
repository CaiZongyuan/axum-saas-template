# Current Membership Locks and Role Lifecycle

Goal: order business writes against member demotion/deactivation and reuse existing member management. Start with [Sessions](03-sessions.en.md) and resource authorization. A deployment serves one Organization.

<!-- example:knowledge:reference-01:start -->

Complete reference: [resource authorization](07-library-grants.en.md).

<!-- example:knowledge:reference-01:end -->

## Public Interfaces and Usage

[Organization](../../crates/app/src/modules/organization/mod.rs) provides `MemberRole::{Owner, Admin, Member}`, `active_role_in` and `lock_memberships`. Call them inside your business transaction; locks remain through commit/rollback. SQL excerpt:

```sql
SELECT role FROM saas_core.memberships
WHERE user_id = $1::uuid AND active
FOR SHARE
```

`None` means no active membership. Use `lock_memberships(&mut tx, &ids)` to lock multiple affected members in ID order before resources. Do not add unordered member locks after a resource lock. Signatures are in the authorization guide.

<!-- example:knowledge:reference-02:start -->

Complete reference: [authorization guide](07-library-grants.en.md).

<!-- example:knowledge:reference-02:end -->

[Identity](../../crates/app/src/modules/identity/mod.rs) exposes batch `profiles(connection, ids)` and transactional `revoke_user_sessions(connection, user_id)`. Use these instead of joining private credential tables or querying one profile at a time.

## Reuse the Management API

[Management Handlers/use cases](../../crates/app/src/modules/organization/management.rs) provide paginated members and `PUT /api/v1/organization/members/{user_id}` with `role / active / version`. Lists default to 50, maximum 100, with administrator-bound cursors; stale versions return 409. Owners manage Owners, Admins only non-Owners, and Members are denied.

[Pure rules](../../crates/app/src/modules/organization/domain.rs) and transactions protect the last Owner. Lock the singleton Organization row, then actor/target memberships in ID order. Check active Owners, roles and version within the transaction; update membership, revoke needed Sessions, append Audit and commit. Never count outside the transaction and update separately.

Demoting/deactivating the last active Owner returns `422 organization.last_owner`. Two simultaneous Owner departures allow one success; initial registration uses the same coordination row.

## Reactivation Does Not Restore Old Sessions

Deactivation revokes all old Sessions, password-reset materials and appends Audit in the membership transaction. Old Cookies remain invalid after reactivation; users log in again. Session issuance holds the membership lock and orders consistently with deactivation. Audit failure rolls all changes back.

Business writes hold shared Membership locks and administration takes exclusive locks. A previously returned role, client dropdown or cached eligibility cannot replace current transactional checks. Independently managed API Keys check active status on each authentication; password reset does not automatically revoke them.

## Verify Your Integration

Run from the repository root:

```bash
node scripts/test-backend.mjs --test members --test membership_policy
```

[Real HTTP checks](../../apps/api/tests/members.rs) cover roles, stale versions, concurrent last-Owner protection, Audit rollback, deactivation/reactivation and login races. [Pure checks](../../crates/app/tests/membership_policy.rs) cover the rule set. Add a controlled deactivation/write race for your business to prove legal commit ordering. Apply the discipline to [file completion](09-attachments.en.md) and [background publication](10-document-exports.en.md).
