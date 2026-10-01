# Define Authorization for Your Resources

Goal: reuse current Core membership while keeping resource access rules in your business. Start with [Sessions](03-sessions.en.md) and [use cases](04-personal-documents.en.md). Authentication, organization role and resource authorization are distinct decisions.

## Core Supplies Identity, Your Business Supplies Rules

Knowledge Base Grant is a reference policy, not a universal tenant or ACL service. Complete implementation: [base use cases](../../crates/app/src/modules/knowledge/bases.rs), [Grants](../../crates/app/src/modules/knowledge/grants.rs) and [document authorization](../../crates/app/src/modules/knowledge/application.rs).

| Current eligibility  | Read/search   | Write         | Manage bases/Grants |
| -------------------- | ------------- | ------------- | ------------------- |
| Active Owner/Admin   | All bases     | All bases     | Allowed             |
| Member + Reader      | Granted bases | Denied        | Denied              |
| Member + Editor      | Granted bases | Granted bases | Denied              |
| Member without Grant | Hidden        | Hidden        | Denied              |

Personal bases use the same policy, including Owner/Admin access. Define rules for your tickets, projects or invoices, such as author-or-administrator access; Knowledge's all-base policy is not a Core default.

## Check Current Eligibility in the Transaction

[Organization](../../crates/app/src/modules/organization/mod.rs) public interface excerpts:

```rust
pub async fn active_role_in(connection: &mut PgConnection, user_id: &str)
    -> Result<Option<MemberRole>, sqlx::Error>;
pub async fn lock_memberships(connection: &mut PgConnection, user_ids: &[String])
    -> Result<Vec<MembershipAccess>, sqlx::Error>;
```

For one writer, acquire Membership's shared lock before business resource locks and your access query. For multiple affected members, lock actor/targets in ID order before the resource. Check returned active/role and completeness. Unlocked `active_role` cannot replace the write-transaction check.

Reference writes hold a shared base lock; Grant changes take its exclusive lock. If a save locks first, revocation waits for it; if revocation commits first, later saves fail. Authorization changes and Audit commit together. Replay, cache and background publication must also reauthorize.

## Apply Rules to Every Entry Point

List/search SQL filters current visibility. Detail, update, delete, attachments and exports check their resource associations and deletion state. Hidden resources return 404; visible resources with denied writes return 403. `can_edit / can_manage / can_create` improve client feedback without replacing execution checks.

Core does not read your business tables. Knowledge's `lock_document` is private reference code, not a public API for new modules. Write your own small resource query and reuse the membership interfaces above.

## Verify and Continue

Run from the repository root:

```bash
node scripts/test-backend.mjs --test knowledge
```

[Real HTTP checks](../../apps/api/tests/knowledge.rs) cover the matrix, private search, pagination/replay after revocation, Audit rollback and save/revocation lock order. Cover reads/writes/lists and denial after revocation in your resource rather than only hiding buttons.

Revocation cannot erase displayed/downloaded content and is not real-time push. Signed download capabilities have their own [TTL boundary](09-attachments.en.md). Continue with [membership lifecycle](08-members.en.md) before integrating the same policy with Files and Jobs.
