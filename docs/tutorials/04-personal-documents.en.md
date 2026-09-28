# Walkthrough: Saving your first Markdown document

Run `just dev`, register or sign in, and open "My documents" from the shared shell's sidebar. A new account first sees the empty state; click "New document", enter a title and Markdown, then click "Save document". Refresh the detail page — the content is still read from PostgreSQL.

An ordinary Member does not wait for an administrator to create a knowledge base. The first successful save prepares the personal Knowledge Base, the Editor Grant, the Document and the corresponding audit in the same transaction. This chapter shows creation, listing and reading the original content; the [next chapter](05-search-preview.md) adds safe preview and search, and concurrent editing arrives in a later chapter.

The chapter's fixed copy comes from the knowledge example's bilingual message catalog; the UI language switches on the register page, the sign-in page or under "Appearance & language". Operation names stay consistent across Chinese and English:

| Page element | Chinese       | English       |
| ------------ | ------------- | ------------- |
| Business nav | 我的文档      | My documents  |
| New action   | 新建文档      | New document  |
| Title field  | 标题          | Title         |
| Body field   | Markdown 正文 | Markdown body |
| Save action  | 保存文档      | Save document |
| Edit entry   | 编辑文档      | Edit document |
| Load more    | 加载更多      | Load more     |

## 1. Keeping the business in its own module

The knowledge base's [pure content rules](../../crates/app/src/modules/knowledge/domain.rs) limit the title to 1–200 characters and Markdown UTF-8 content to 1 MiB, and reject NUL bytes that PostgreSQL text cannot store. The rules live in the module's own Domain file and can be adapted to your product without pushing knowledge-base concepts into Core.

The [Application use case](../../crates/app/src/modules/knowledge/application.rs) orchestrates the transaction and permissions; the [HTTP interface](../../crates/app/src/modules/knowledge/mod.rs) handles the protocol and public errors. The [business migration](../../migrations/0003_knowledge.sql) owns only the tables of the `knowledge` schema — Core's registration neither creates personal knowledge bases nor calls these use cases.

The first write coordinates concurrency with the `personal_owner` unique constraint. Only the transaction that actually creates a new knowledge base grants Editor; writes against an existing knowledge base missing the grant are rejected, and retrying initialization never quietly restores a revoked permission. Owner/Admin can access every organization knowledge base under the confirmed rules; other ordinary members need a Grant for that knowledge base.

Writes lock the current membership through Organization's public interface and hold the knowledge base's shared lock while checking the grant. Later role deactivations and grant changes can take the corresponding exclusive lock, forming an explicit commit order.

## 2. One transaction protects one save

Creating the knowledge base, granting the default permission, creating the document and the Audit commit together. If the audit fails, every change rolls back — a half-finished "document exists, but the audit or grant is missing" must not happen.

The document body is stored in PostgreSQL; Markdown is not written to RustFS today — RustFS will serve the later attachments and export binaries.

## 3. Making a retry the same operation

[Core Idempotency](../../crates/app/src/modules/idempotency/mod.rs) provides `claim` / `complete`; the business holds the transaction and calls them after authorization. The scope covers the account, the operation and the target knowledge base, storing the fingerprint and result of the normalized request. The idempotency record commits in the same transaction as the business/Audit writes; concurrent requests coordinate serially on the same record.

The same `Idempotency-Key` with the same content returns the original result; the same key with changed content returns 409. The replay window defaults to 24 hours; expired keys can be reused, and calls reclaim expired records in bounded batches. Replay still checks the session, the current membership and the knowledge base grant — a cache is never treated as authorization.

The new-document page keeps the key when retrying the same input and generates a new key when the input changes. After a network timeout the user can retry, and the server still produces exactly one document. The SDK never retries POST automatically.

## 4. From the contract to the page

The [API assembly point](../../apps/api/src/lib.rs) merges Core's and Knowledge's Routers/OpenAPI; the generated SDK exports methods from the combined contract. Core's Router builder never imports the knowledge module.

```bash
just generate
pnpm contracts:check
```

[Knowledge Views](../../packages/views/src/knowledge/documents-view.tsx) reuse the Core session, the generated SDK and the common UI. The list returns summaries only, with cursor pagination defaulting to 50 and capped at 100; the cursor binds to the current identity and ordering and cannot be carried across accounts. Every query re-authorizes independently — a cursor is not an access credential.

The page renders only the workspace content: the sidebar navigation, the page landmark and the role-gated entries come from the shared shell provided by the app adapter, and the business navigation entries plus all copy come from the example's registered navigation and message catalog. Switching the UI language re-renders the page in place; lists and input survive, and user content stays in its original language.

This chapter originally wired reading through the raw detail; the current version shows the safe preview as described in the [next chapter](05-search-preview.md). A failed save keeps the input and the request ID; a save response from a previous identity cannot update the new identity's UI after switching accounts.

## 5. Verifying behaviour and removability

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx apps/web/src/knowledge-bilingual.test.tsx
pnpm boundaries:check
just check
```

The backend covers create→read, privacy isolation, initialization/replay rejection after revocation, lock-driven concurrency, idempotent retries and transaction rollback. The View tests check the empty state, new-document navigation, failed saves keeping input and reusing the request key. The bilingual tests verify the representative pages in both languages. Run the key journeys together when they complete:

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

A real browser registers a new Member, saves the first document directly, then refreshes and reopens it from the list.

The [ownership manifest](../../examples/knowledge-base/manifest.json) registers the business directories, migrations, tests, tutorials and the few assembly points. Blocks marked `example:knowledge` are the explicit wiring locations; the later removal tool operates on a fresh copy by the manifest rather than guessing from file names — and never deletes existing production data. Core's identity, audit, idempotency and common HTTP capabilities remain.
