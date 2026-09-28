# Walkthrough: Explicit saves and version conflicts

This chapter adds editing on top of the previous chapter's safe preview. Run `just dev`, open one of your documents, click "Edit document", change the title or the Markdown, then "Save document". On success the reading page shows an incremented version; the list title and the body cache update with it.

The editor has two layouts: on wide screens (≥1024px) "Edit" and "Preview" sit side by side and the preview live-syncs as you type; on narrow screens it collapses into the "Edit / Preview" tabs from the previous chapter. Saving is always explicit — neither layout saves for you. The design system's "Scenes" tab carries "Save conflicts and draft protection", which demos the same save feedback offline on demo data.

Operation names for editing and conflict handling stay consistent across Chinese and English:

| Page element          | Chinese                      | English                                          |
| --------------------- | ---------------------------- | ------------------------------------------------ |
| Edit document         | 编辑文档                     | Edit document                                    |
| Markdown mode (tabs)  | Markdown 模式                | Markdown mode                                    |
| Edit tab / pane       | 编辑                         | Edit                                             |
| Preview tab / pane    | 预览                         | Preview                                          |
| Markdown body         | Markdown 正文                | Markdown body                                    |
| Save document         | 保存文档                     | Save document                                    |
| Editing from version… | 基于版本 {version} 编辑      | Editing from version {version}                   |
| Save conflict         | 保存冲突                     | Save conflict                                    |
| Reading the latest…   | 正在读取最新版本…            | Reading the latest version…                      |
| Read latest version   | 读取最新版本                 | Read latest version                              |
| Latest version …      | 最新版本 {version}：{title}  | Latest version {version}: {title}                |
| Reviewed; keep draft  | 已核对，保留草稿并继续       | Reviewed; keep my draft and continue             |
| Discard draft         | 放弃草稿，采用最新内容       | Discard my draft and take the latest             |
| Save access lapsed    | 保存权限已失效，草稿已保留。 | Save access has lapsed. Your draft is preserved. |
| Re-check access       | 重新查询权限                 | Re-check access                                  |

## 1. Cause a conflict by hand first

1. Open the same document's edit page in two browser tabs; both show "Editing from version 1".
2. In the first tab write "first change" and save; the reading page shows version 2.
3. In the second tab write "second draft" and save. A version conflict appears and the draft is preserved.
4. Click "Read latest version" to see the saved version 2. The editor still holds your own draft.
5. After comparing, choose "Reviewed; keep my draft and continue", merge the text by hand and save again; or choose "Discard my draft and take the latest". Neither choice saves automatically.

If a third change lands before your next save, that save conflicts again. There is no silent overwrite, and this chapter deliberately excludes real-time collaboration or version history.

While you are here, drag the window across the breakpoint: the tabs appear and disappear as you cross it, and the body and title stay put. Both layouts render the same editor element — crossing the layout boundary never remounts the panes, so the draft does not move.

## 2. One conditional update decides who succeeds

The [update API](../../crates/app/src/modules/knowledge/mod.rs) uses `PUT /api/v1/knowledge/documents/{id}` with `title / markdown / version`. It rides the same Session, Origin, CSRF, input limits and structured errors as every chapter before it. The version must be a positive integer.

The [update use case](../../crates/app/src/modules/knowledge/application.rs) locks the current Membership first, then locks the Knowledge Base and checks the Grant. A document the caller cannot see returns 404; a Reader's write returns 403. The update succeeds only when the requested version equals the database's current version, and it increments the version and refreshes author and timestamps in the same statement.

```sql
UPDATE knowledge.documents
SET title = $1, markdown = $2, version = version + 1
WHERE id = $3 AND version = $4;
```

This is the simplified shape; the full code also carries knowledge-base ownership, grants and audit. Two writes never compare read versions inside the application: the database's conditional update guarantees they cannot both cover the same version. A stale save returns `409 document.version_conflict`.

The document change and the Audit commit in one transaction. An audit failure rolls the body and version back, and the same version can be retried after the fix. Updates use the version; the creation idempotency key is not a substitute for concurrency control. After a network error, never blindly resend an update — read the latest version and verify what actually committed.

## 3. Drafts and server resources stay separate

The [shared editor view](../../packages/views/src/knowledge/documents-view.tsx) reuses the creation form, the Markdown preview and the generated SDK. Query manages saved resources; the input fields plus the baseline version form one local editing session. Background refreshes may update the server content inside Query, but they never replace the text being edited or the baseline version.

A media query selects the layout, and the shared view exposes `data-editor-layout="wide|narrow"` as the public hook for tests and styles. On wide screens the preview refreshes on every keystroke; an invalid body (NUL or over 1 MiB) keeps the last good preview, and the error surfaces on save or on a tab switch without clobbering other input errors such as the title's. The narrow tabs keep the explicit switch: moving to "Preview" validates the body first, and invalid text stays on the source pane with the error shown; the tabs answer the arrow keys, matching the previous chapter's keyboard path. Preview rendering is a deferred update, so typing long documents never blocks.

After a conflict, saving stays disabled until the user has read and compared the latest content. The [failure alert and the conflict reconcile section](../../packages/views/src/knowledge/document-feedback.tsx) are the exact components the editor and the design-system scene share — the scene demos the production behavior. Network failures and conflicts both keep the input. Saving disables the write controls while in flight; success updates the related list and detail caches. A late response after leaving the page never navigates the user back, and a response from a previous identity cannot write into the previous identity's cache.

## 4. Leaving the page and refreshing the browser

The [web navigation adapter](../../apps/web/src/knowledge-navigation.tsx) uses a TanStack Router blocker. The shared view only tells the host whether the draft is dirty; it never imports a Router or builds a second web-specific path.

Leaving inside the app shows the "Keep editing / Leave anyway" dialog; refreshing or closing the browser uses the native beforeunload prompt, whose wording the browser owns. Navigation after a successful save goes straight through. A save request already in flight may still complete on the server after you leave, so what the server holds wins when the page reopens; this chapter promises no local draft persistence.

## 5. Verifying the public behavior

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx apps/web/src/design-system.test.tsx
just check
```

The HTTP tests coordinate two concurrent requests through real PostgreSQL locks, confirm one success and one 409, then verify the final body through the read API; they also cover Reader and invisible-document rejections and the audit-failure rollback. The view tests cover the wide two-pane layout with its live preview, draft and mode retention across the breakpoint, the narrow tabs' keyboard path, disabled controls while saving, drafts surviving background refreshes, conflict reading with explicit recovery, and keeping input when a leave is cancelled. The design-system test walks the "Save conflicts and draft protection" scene through its four states — success, failure, version conflict, lost permission — with the failure alert carrying a request id and, after reading the latest version, both conflict exits ("discard my draft" swaps the body to the latest content, "keep my draft" preserves it) reaching the success state, all on demo data.

After the key journeys, run the browser suite:

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

The first journey asserts the desktop two-pane layout and its live preview, then narrows the viewport to verify the tabbed mode; the second scene produces a conflict with two real tabs and confirms version 3 from the other page after a manual merge. Day-to-day changes keep using the targeted HTTP/view tests.

## 6. Applying this to your own domain

Any record two people may change can carry a version: the form remembers the version it read, the server conditionally updates inside the authorized transaction, and the client keeps the input on a 409 and offers the recovery choice. Never "SELECT then unconditional UPDATE" in a controller, and never copy the server object into the form on every background refresh.

An editor's save feedback can enter the design-system showroom through the same channel: an example declares `scenes` (title, description and an optional render body) in its own contribution, and the [assembly](../../packages/views/src/shell/app-contract.ts) handles namespacing and bilingual validation. Scenes use demo data and local state only; they never re-enact business writes.

This chapter's views, web wiring, API, contract types, tests and tutorials belong to the knowledge-base example. The [ownership manifest](../../examples/knowledge-base/manifest.json) registers these entry points; the generic AlertDialog stays in the UI package for the next business to reuse.
