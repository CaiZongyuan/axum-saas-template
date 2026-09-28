# Walkthrough: The bilingual public site

The public site consists of four parts — Landing, Documentation, Blog and Downloads: an unauthenticated visitor understands the template from a concise brand home, enters the documentation in their language from the top navigation, and Blog and Downloads keep stable entries that honestly say "Coming soon". This chapter walks the four entries as a visitor first, then explains, as a maintainer, how the pages are declared, how the copy stays truthful, how the example showcase leaves with the example, and the rules for language, theme and the deployment base.

## 1. Try it first: the four entries and the public paths

Build and browse the site:

```bash
pnpm docs:build   # Renders the bilingual site and verifies its navigation
just docs         # Local dev server for editing while you look
```

The Chinese entries live at the root: `/` (Landing), `/docs/` (the documentation), `/blog/` and `/downloads/`; English mirrors each of them under `/en/`. Language is decided by the path: `/en/blog/` serves the English page, and the site performs no device-language redirects. The top navigation's "English / 中文" switch follows the counterpart page recorded in the frontmatter, so it always lands on a page that exists. Old chapter deep links (such as `/en/getting-started/quickstart`) are unaffected by the redesign.

## 2. The information structure: Expo's four beats

The Landing follows the information structure of Expo's home while claiming only delivered capabilities:

1. **Value proposition + primary action**: one sentence for the template (the README's own wording), with the primary button entering the Documentation in the current language and a GitHub repository entry beside it.
2. **The usage flow**: start the stack → follow the tutorials → compose/remove the example → deploy and back up, each step linking to a real chapter.
3. **Real capabilities**: every capability card links an existing tutorial chapter or the v1 coverage page; there is no "planned / coming soon" capability card.
4. **The closing call to action**: back to the documentation.

The discipline for a new card: confirm the capability has a row in [v1 capability coverage and acceptance](../architecture/v1-coverage.en.md) before deciding on the card and its link; keep the wording consistent with the chapter it points at, and never invent numbers (performance, scale, user counts).

## 3. How pages are declared: site.json and the renderer

[site.json](../../docs/site.json) is the only place to declare them. The Landing and the two placeholder pages are ordinary page entries carrying `layout: "page"`: bilingual pairs (`sourceEn`/`titleEn`) plus paired `pageTitle`/`pageTitleEn` and `pageDescription`/`pageDescriptionEn` — the renderer writes them into the page frontmatter, so each page's `<title>` and meta description honestly reflect the "Coming soon" state. The validation lives in [docs-locales.mjs](../../scripts/lib/docs-locales.mjs): the meta must be paired and may only appear on layout pages; half a pair fails the build.

A layout page stays out of the sidebar (the renderer also writes `sidebar: false`) and appears only in the top navigation; the four page kinds share the same navigation, footer, visual tokens and light/dark rules. The Landing sources are plain Markdown with a little constrained HTML (`docs/index.md` and the adjacent `docs/index.en.md`), styled in [custom.css](../../apps/docs/.vitepress/theme/custom.css) with the same `--vp-*` tokens the documentation uses.

## 4. The boundary of Coming soon

Blog and Downloads are placeholders in this round: no article list or publishing management, no download catalog, version/platform picker, installer service, subscription form or progress promises. The placeholder's obligation is honesty — say what a visitor can do now (return home, read the documentation, watch the repository) and never fabricate articles, dates or release assets; the page title and meta state the status truthfully. When the blog or the download service arrives, replace the placeholder content; the entry paths and the navigation stay stable.

## 5. The ownership of the example showcase

The Landing's "reference example" section sits entirely between the `example:knowledge:landing:start/end` markers — it is the knowledge-base example's showcase. Landing text outside the markers may only link Core chapters; the post-removal [docs:build](../../scripts/check-docs-build.mjs) checks every link's existence, and the example's cards disappear with the markers as one block, leaving no dead entries behind. Run the drill yourself:

```bash
git clone . /tmp/ui16-drill && node scripts/example-remove.mjs --root /tmp/ui16-drill
cd /tmp/ui16-drill && pnpm docs:build   # The showcase is trimmed; every remaining link resolves
```

CI's example-removal job does the same on every pull request; the Core-only site must keep building and publishing.

## 6. Language, theme and deployment

The theme preference is saved locally in the browser by VitePress's appearance toggle (`localStorage`); it never syncs across devices. Language follows the path only — the site promises no automatic cross-site following. Deployment rides the existing static pipeline: GitHub Pages publishes from `main` (see [publishing the documentation site](../getting-started/publish-docs.en.md)), repository sub-paths are carried by the base, and a custom base is built with `DOCS_BASE=/your-base/ pnpm docs:build` and verified by the built-in check — the public-site browser journeys (`just e2e-docs`) include one custom-base smoke pass.

## 7. Run this chapter's checks

```bash
pnpm docs:check     # The bilingual contract, paired meta, links and snippets
pnpm docs:build     # Rendering + post-build navigation check (base resolution included)
just e2e-docs       # Public-site journeys: four entries, CTA, placeholders, switching, theme, narrow screens, custom base
just check          # The main gate
```

Contrast rides the documentation site's settled tokens: body text clears WCAG AA by a wide margin on both surfaces; the only self-drawn decoration, the small dots beside card headings, keep ≥3:1 against the background in both modes (the non-text threshold), with a brighter violet-500 compensating the purple dot in dark mode.

The public site's page kinds, navigation and renderer are all Core: the placeholder pages, the top bar and the whole rendering chain appear in no ownership manifest, and the site builds and publishes after example removal. The Landing source file is a Core page too, but it registers the `example:knowledge:landing` markers in the example ownership manifest's registrationMarkers — the example owns not the page but the showcase section between the markers, which the removal trims as one block; the only example-related part of the browser journeys is that section.
