# Maintain your bilingual documentation site

The template provides static Landing, Documentation, Blog and Downloads entries. Developers maintain repository Markdown and the site model; tooling produces generated sources and VitePress output. Teach your SaaS backend through tasks, files, code and HTTP results using the [documentation guide](../guides/maintain-docs.md).

Prerequisites are installed pnpm dependencies, Chinese/English content and the [authoring rules](../agents/documentation.md). Run commands from the repository root.

## Edit canonical sources and preview

```bash
pnpm docs:check
just docs
```

`just docs` starts the development server at the address printed in the terminal. Edit sources under `docs/`, never `apps/docs/.generated`. Generation follows:

```text
docs/site.json + bilingual Markdown + checked source/generated references
  → scripts/project-docs.mjs
  → apps/docs/.generated
  → VitePress
  → apps/docs/.vitepress/dist
```

[site.json](../site.json) declares pages, stable ids, groups and published paths. The [renderer](../../scripts/lib/docs.mjs) resolves documentation links for the active locale and writes counterpart/source-version metadata. Preserve `route` when moving sources to keep old bookmarks valid.

## Register your guide

Create `docs/guides/billing.md` and `billing.en.md`, then add a complete `pages` entry:

```json
{
  "id": "billing-guide",
  "source": "docs/guides/billing.md",
  "sourceEn": "docs/guides/billing.en.md",
  "route": "guides/billing.md",
  "title": "开发账务模块",
  "titleEn": "Build a billing module",
  "group": "开发指南",
  "type": "guide"
}
```

This is a reader-added page, not existing default Billing content. Use an existing bilingual group; a new group also needs both labels in `groupLabels`. Set explicit `previous` / `next` ids for a learning sequence. Omit unrelated relationships so the reader is not sent to another topic.

Chinese keeps the registered route and English mirrors it under `/en/`. Language switching selects the same chapter; search includes bilingual content and generated references. Site language follows the path rather than application device preferences.

## Public entries, themes and layout

The four Chinese entries are `/`, `/docs/`, `/blog/` and `/downloads/`, mirrored under `/en/`. Blog and Downloads currently state “coming soon.” Actual content and artifacts must exist before those placeholders can represent delivered features.

Public layout pages use `layout: "page"` outside the documentation sidebar. `pageTitle` / `pageTitleEn` and `pageDescription` / `pageDescriptionEn` must be paired. [Locale-model validation](../../scripts/lib/docs-locales.mjs) rejects omissions, conflicts and dangling chapter relationships.

The accepted reading experience keeps the sidebar at the viewport's left edge, constrains prose independently and collapses navigation on narrow screens. VitePress themes use `auto | light | dark`, persisted locally under `vitepress-theme-appearance`. Implementation is in the [theme directory](../../apps/docs/.vitepress/theme/) with colors derived from shared tokens. Theme changes need real wide/narrow browser, focus and overflow checks; content edits begin with links and builds.

## Ownership and checks

Business-specific display and links in shared public pages belong inside registered `example:<prefix>:<marker>:start/end` blocks. Register exclusive tutorials in the business manifest. Removal trims both content and navigation while Core pages continue to build. Do not link exclusive source outside a shared page's markers.

```bash
pnpm docs:check
pnpm docs:build
```

The first checks bilingual registration, links, snippets and generated references. The second projects/builds and validates generated navigation/links. Open both new pages and verify language switching, source links and chapter neighbors.

After changing navigation, theme, search or deployment base, run:

```bash
just e2e-docs
```

It tests only the static site, without application databases or Electron. A documentation build does not prove Rust examples work; their compilation, HTTP or public-capability checks are separate.

For a custom deployment prefix:

```bash
DOCS_BASE=/my-saas/ pnpm docs:build
```

Missing page/snippet sources, unpaired metadata and navigation to removed chapters fail validation. Fix source declarations and rebuild rather than editing dist.

Next: [Publish your documentation site](../getting-started/publish-docs.md).
