# Walkthrough: Shared knowledge bases and permission inheritance

Personal writing still means signing in, opening "My documents" from the sidebar and saving the first document. This chapter adds shared spaces: Owner/Admin create a shared knowledge base from the sidebar's "Knowledge bases", rename it, and grant read-only or editable access to already-registered members.

Operation names on the knowledge base and grant pages stay consistent across Chinese and English:

| Page element          | Chinese            | English                 |
| --------------------- | ------------------ | ----------------------- |
| Business nav          | 知识库             | Knowledge bases         |
| Knowledge base name   | 知识库名称         | Knowledge base name     |
| Save name             | 保存库名           | Save name               |
| New action            | 新建文档           | New document            |
| Owning knowledge base | 所在知识库         | Open the knowledge base |
| Grants section        | 知识库授权         | Knowledge base access   |
| Member select         | 选择成员           | Select member           |
| Access select         | 访问权限           | Access                  |
| Read-only             | 只读               | Read-only               |
| Editable              | 可编辑             | Editable                |
| Save grant            | 保存授权           | Save grant              |
| Revoke                | 撤销 {邮箱} 的授权 | Revoke {email}’s access |
| Delete knowledge base | 删除知识库         | Delete knowledge base   |

## 1. Walking through it with two accounts

1. Sign in as the Owner, open "Knowledge bases", create "团队手册". Click "New document" inside the knowledge base and save a Markdown document.
2. Register a colleague's account in another browser. At this point the colleague can neither read the document nor see the shared knowledge base.
3. The Owner clicks "Open the knowledge base" from the document, picks the colleague under "Knowledge base access", and saves "Read-only".
4. The colleague opens the shared knowledge base from the sidebar's "Knowledge bases": searching and reading work; creating and editing do not.
5. The Owner changes the colleague to "Editable". After refreshing, the colleague can create new documents or edit explicitly.
6. The Owner revokes the grant. The colleague's subsequent knowledge base queries, searches, reads and saves are all denied; refreshing shows the denial.

The server decides role changes — no re-login needed. Already-open content is not wiped remotely; subsequent API requests run under the current grant, and the page picks up the new state when re-querying or regaining focus. This chapter introduces no real-time permission push.

## 2. Who can do what

| Qualification    | Read/search in knowledge bases | Document writes         | Create/rename/grant |
| ---------------- | ------------------------------ | ----------------------- | ------------------- |
| Owner / Admin    | All knowledge bases            | All knowledge bases     | Allowed             |
| Member + Reader  | Granted knowledge bases        | Denied                  | Denied              |
| Member + Editor  | Granted knowledge bases        | Granted knowledge bases | Denied              |
| Member, no Grant | Invisible                      | Invisible               | Denied              |

Personal knowledge bases use the same Grant; the first save prepares Editor automatically, and new features never publish personal knowledge bases to other ordinary users. Owner/Admin can still manage and read all personal knowledge bases under the confirmed model. Assigning a Reader grant to an administrator never reduces what the organization role already allows.

Library deletion and file cleanup arrive with the later deletion chapter; this chapter manages names, access scope and grants.

## 3. Grants decide data reads and writes

The [knowledge base interface and use cases](../../crates/app/src/modules/knowledge/bases.rs) provide the visible list, creation, detail and rename. The [Grant use cases](../../crates/app/src/modules/knowledge/grants.rs) handle grant listing, granting and revoking. Granting and revoking commit in the same transaction as the Audit; repeated operations without an actual change do not append another grant event.

The document list API gains an optional `knowledge_base_id`; without it the scope is still the personal space. Creating a document can also target a knowledge base. The list returns summaries only, and title search still escapes `%`, `_` and backslash. Cursors bind to the account, the knowledge base scope, the filter and the ordering — changing knowledge bases forces a fresh query.

Invisible documents or knowledge bases return 404; readable but not writable returns 403. Read / List / Search / Create / Update all verify on the backend — hidden buttons, direct URLs or reused cursors cannot bypass them.

The `can_edit / can_manage / can_create` in each response is the server's current judgment. The personal document list also returns the current `can_create`: allowed for a first write without a personal knowledge base, denied after revocation so re-initialization cannot sneak past. The frontend uses these flags only to improve the experience; executing a mutation still re-validates. GrantAccess and the related SDK types are generated from the Rust contract — the frontend maintains no parallel role-derivation rules.

## 4. How revocation orders with an in-flight save

An ordinary document write first takes the current Membership's shared lock, then the Knowledge Base's shared lock, checks the permission and saves. A grant change locks both the operator and the target member through Organization's [ordered member-lock interface](../../crates/app/src/modules/organization/mod.rs), then takes the knowledge base's exclusive lock.

If a save already holds the knowledge base lock, the revocation waits for that save to complete before committing; requests starting after the revocation commits cannot keep writing. Conversely, when the revocation takes the lock first, later saves read "no grant" and are denied. Grant caches or idempotent results cannot skip this step.

With multiple members involved, locks are taken in member-ID order, matching organization member management; new attachment or job authorization must respect the same commit order. Core never reads Knowledge tables — the reference business collaborates through Core's public interfaces.

## 5. Pages and caching

Click a knowledge-base icon in the list to customize it. Glass is the default; glyphs and category colors are also available. A choice stays in a draft until confirmed, then appears in the list, reader and editor context. This device-only preference is scoped by user and knowledge base. It changes neither knowledge-base data nor Grants, and it does not change other members' views.

[Knowledge Views](../../packages/views/src/knowledge/knowledge-bases-view.tsx) reuse Core's member directory to pick registered users — no invitation step. Documents in the personal space and inside a knowledge base share the same [list/edit View](../../packages/views/src/knowledge/documents-view.tsx); the knowledge base scope enters the Query key and the API parameters, and unsaved drafts stay separate per account and knowledge base.

Grant control names resolve with the UI language, and the revoke button's accessible name carries the target email ("撤销 {邮箱} 的授权" / "Revoke {email}’s access") so screen readers identify the target in both languages; bilingual View tests cover the representative pages.

Readers see the read-only page, and even opening the edit URL directly leaves the save controls disabled. After a 403/404 on save, resubmitting is disabled immediately and permissions are re-read while the unsaved text stays untouched; only an explicit "re-check permissions" confirmed by the server restores saving. A failed permission re-read never lets the stale UI permission submit. All saved resources remain Query-managed — nothing is copied into a second business store.

Knowledge bases, grants and member lists default to 50 per page, capped at 100. The page offers "Load more" and failed-read retries, and the browser keeps at most ten pages per list to avoid unbounded growth. The backend never returns every knowledge base to ordinary users for frontend filtering.

## 6. Verifying from the public entry

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx apps/web/src/knowledge-bases.test.tsx apps/web/src/knowledge-bilingual.test.tsx
just check
```

Real PostgreSQL tests cover the role/Grant matrix, invisible search, rename, scope binding, grant-audit rollback and revocation/write lock races. View tests verify creating a shared knowledge base → saving inside it, granting/revoking, renaming, and the Reader's page and direct edit entry.

Run once when the key flow completes:

```bash
node scripts/e2e.mjs tests/e2e/knowledge-grants.spec.ts
```

Two real browsers walk invisible → Reader → Editor → revoked, exercising the pages together with Cookies, the generated SDK, server authorization and the actual database.

This chapter only extends the knowledge reference business; the knowledge base model, API, Views, contract symbols, tests and tutorial are registered in the [ownership manifest](../../examples/knowledge-base/manifest.json). Core's ordered member locks and member directory remain. Later attachments reuse the same knowledge-base-level grant boundary — no per-file ACL.
