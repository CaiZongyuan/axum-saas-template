# Walkthrough: Title search and safe preview

Run `just dev`, sign in, create a document titled "部署 100%_完成" and fill the body with:

```markdown
# 部署笔记

**检查列表**：

- [x] 数据库可连接
- [ ] 发布应用

参见 [Rust 官网](https://www.rust-lang.org/)。
```

Switch to "Preview" to see the layout, then save. The reading page shows the same safely rendered result. Return to "My documents" from the sidebar, type `100%_` and press Enter — the document appears; both `%` and `_` are ordinary characters here. Clearing the search restores the list. More results use "Load more"; changing the keyword or resubmitting restarts from the first page.

Operation names for search and preview stay consistent across Chinese and English:

| Page element     | Chinese      | English            |
| ---------------- | ------------ | ------------------ |
| Search field     | 标题关键词   | Title keywords     |
| Edit tab         | 编辑         | Edit               |
| Preview tab      | 预览         | Preview            |
| Clear search     | 清除搜索     | Clear search       |
| Load more        | 加载更多     | Load more          |
| Retry pagination | 重试加载更多 | Retry loading more |

## 1. Adding a filter to the existing list

The [HTTP contract](../../crates/app/src/modules/knowledge/mod.rs) adds an optional `q` to the existing list endpoint while still returning summaries only. The keyword is at most 200 Unicode characters and cannot contain NUL; matching is a case-insensitive title substring match after trimming both ends. An empty keyword shows every accessible document in the personal knowledge base. Create titles stay limited to 1–200 characters and bodies to 1 MiB as UTF-8; the browser gives immediate feedback and the server keeps validating independently.

The [Application](../../crates/app/src/modules/knowledge/application.rs) escapes LIKE's `%`, `_` and backslash, then binds the pattern as an SQL parameter. Never concatenate user input into SQL, and never make `%` a wildcard the user controls.

The endpoint's scope is "my personal knowledge base". A later chapter's knowledge base pages provide the knowledge-base-scoped browsing entry; Owner read permission does not mix organization-wide documents into "My documents" here. The permission condition, the keyword and the pagination bounds enter the query together — inaccessible titles are never fetched first and filtered in the browser.

## 2. Cursors bind to the query conditions

Pagination sorts by `created_at DESC, id DESC`. Inserting new documents cannot push records that belong on the next page back onto the previous one. The [cursor](../../crates/app/src/modules/knowledge/pagination.rs) carries the current identity, scope/ordering, a digest of the normalized keyword and the last item's position; changing identity or keyword forces a fresh query. Every page re-checks the current Grant; the cursor is a position, not an authorization credential, and guarantees no cross-page database snapshot.

`limit` defaults to 50, caps at 100; the server fetches one extra row to decide `has_more` and never returns totals or bodies. An invalid cursor returns a structured 400; network failures keep the request ID and the page offers re-querying or retrying the next page.

The [View](../../packages/views/src/knowledge/documents-view.tsx) uses TanStack Query with a key covering the identity, the personal-knowledge-base scope and the keyword; saved documents still live only in the Query cache. The search input is form state and the preview shows the unsaved draft — no second resource store. Switching identity clears the cache and rebuilds the search form. The list keeps at most ten pages in memory, evicting the oldest page beyond that window; a fresh search starts over.

UI language and theme are shared preference state: switching updates copy and formatting (dates, for example) without remounting the page, and the keyword plus results stay untouched; bilingual View tests cover the representative pages in both languages.

## 3. Treating untrusted Markdown as content

The [Markdown renderer](../../packages/views/src/knowledge/markdown-content.tsx) uses pinned versions of `react-markdown`, `remark-gfm` and `rehype-sanitize`:

- `skipHtml` disables raw HTML and `rehype-raw` stays off.
- The default URL protocol filtering is kept, followed by sanitizing with the default schema; filtered links render as plain text.
- Headings, lists, emphasis, code, links, tables and task lists are supported.
- External links open as ordinary browser links with `noopener noreferrer`; the server never fetches links.
- Images currently show their alternative text without loading external images; the attachments chapter wires authorized resource references — permanently public storage URLs must never be pasted into the body.

The "Edit" panel keeps the original input; only switching to "Preview" parses the body once. The parser loads on demand through a dynamic import and never loads on the register page or re-parses on every keystroke. Drafts over 1 MiB cannot preview or submit, but the input stays so the user can shrink it and retry. Adding a Markdown plugin requires re-reviewing whether it can produce unsanitized HTML/URLs.

## 4. Verifying from the public entry

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx apps/web/src/knowledge-bilingual.test.tsx
just check
```

HTTP tests use a real PostgreSQL and verify literal escaping, ordering, filter binding, input bounds, cross-account invisibility and continued pagination after revocation. View tests operate the real page, covering keyboard tab switching, safe links, draft retention, pagination failure retries, empty results and re-querying.

Run once when the key journey completes:

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

A real Chromium registers a Member, writes with a preview, saves, refreshes, then searches by title and opens the body. Day-to-day changes run the targeted HTTP/View tests without repeating the browser journey on every push.

## 5. Copying the pattern into your own business

Add a bounded filter to your own list contract, parameterize the query, and put the same filter into the cursor and the Query key; authorization happens on the server. Keep content-format conversion at the business View boundary, not in the Core session or the common SDK.

This chapter's source, tests, generated Knowledge operations and tutorial belong to the knowledge example; the generic Tabs are reusable UI. The [ownership manifest](../../examples/knowledge-base/manifest.json) records the removal scope. The Markdown dependencies are used only by the example Views; the removal tool deletes that dependency registration too.

Library docs: [react-markdown 10.1.0](https://github.com/remarkjs/react-markdown/tree/10.1.0#security), [remark-gfm 4.0.1](https://github.com/remarkjs/remark-gfm/tree/4.0.1), [rehype-sanitize 6.0.0](https://github.com/rehypejs/rehype-sanitize/tree/6.0.0).
