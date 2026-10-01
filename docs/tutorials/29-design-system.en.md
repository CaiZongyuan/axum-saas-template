# Walkthrough: Using production components and registering demo scenes

The design-system showroom (`/design-system`) is a reference room for the "replace the template with your own product" step: every signed-in user can open settings from the lower-left user area and select "Design system", and the colors, typography, spacing, components and icons it shows are the exact ones the business pages use — the showroom keeps no second color table and no separate copy of the library, so what you see here is what ships. This chapter walks the four tabs (Foundation / Components / Scenes / Icons), how an example registers its own demo scenes, and what happens to the showroom when an example is removed.

## 1. Feel it first: from settings to the showroom

Run `just dev`, sign in, click the lower-left user area, then select "Design system" in the settings directory. Existing `/design-system` bookmarks open the same showroom inside settings, sharing its lazy chunk. **Foundation** lists tokens, typography and spacing; **Components** operates real controls and overlays; **Scenes** includes Core and example-contributed scenes; **Icons** is an on-demand searchable catalog. Switch language and theme to inspect the same production components in each combination.

## 2. Foundation and components: reading production tokens directly

The token values on the Foundation tab are not a hard-coded swatch sheet — they are computed values read live from the document with `getComputedStyle` at render time: re-enter the page under the dark theme and the list shows the dark tokens' current values. "Copy" takes the value as computed right now — if the template re-skins, this list follows automatically. Typography and spacing/radius render with the production utilities themselves (`text-sm`, `p-4`, `rounded-lg`…).

The Components tab operates real `@saas/ui` components: the six button variants, loading (`aria-busy` plus a spinner), disabled; input, textarea, select and switch; "Simulate validation error" produces an `aria-invalid` flag, error text and a destructive alert together — error state never rides on color alone. The overlay demo uses the same AlertDialog as the production delete confirmation: focus moves into the dialog when it opens, Esc or Cancel closes it, and "Confirm delete" only leaves a demo note in local state — no request is sent.

## 3. Scenes: isolated fixtures and example registration

The generic form, list and empty-state scenes on the Scenes tab run on isolated fixtures and component-local state: saving sends no request, selection affects only this page, and the empty state toggles between its two shapes — they demonstrate shapes, not a business feature.

An example can register its own scenes through the assembly point (`ExampleContribution.scenes`, declaring an `id`, bilingual message keys and an optional interactive render body): the notes example (unregistered by default; once added back with `scripts/example-add.mjs`) registers a "Notes example" scene whose title resolves through the example's own namespace (`notes.nav.notes`), with the source example labeled on the card. After the removal tool strips the example, its scenes disappear with it — in a Core-only combination the Scenes tab keeps only the generic scenes, with a "no example scenes in this combination" note, and the base showroom stays complete. The knowledge base's save-conflict scene (UI07), attachment-icons-and-upload-states scene (UI08) and export-states-and-notification-display scene (UI09) all shipped through this same registration channel; their render bodies demo the save outcomes, the attachment upload lifecycle, and the display mapping from status badges to notification titles with the production components, on demo data only.

## 4. Icons: an on-demand catalog

The Icons tab has three parts. The top half is the **ModuleIcon matrix**: ten category colors across four appearances (bare / flat / soft / glossy), rendered once per table under scoped light and dark previews — category colors mark modules in small areas only (sidebar, module entries) and stay independent of semantic state colors; Core modules register theirs in `packages/views/src/shell/module-registry.ts`, and an example module declares its own route colors through `ExampleContribution.moduleIcons`, removed together with the example. The middle is the **file-icon samples**: attachments and file lists resolve to a vendored subset of Material Icon Theme 5.38.1 (32 SVGs, MIT license, attribution in `THIRD-PARTY-NOTICES.md` at the repository root) by filename, then longest extension, then MIME; export rows show version, status and expiry without a filename, so they carry no file icon yet. The bottom half is the curated Lucide catalog organized into four categories (Actions / Navigation / Status / Objects) whose category colors come from production tokens (`text-primary`, `text-link`, `text-success`, `text-warning`). The whole Icons tab ships in its own async chunk, downloaded the first time you open it — the initial bundle never contains it, and the performance budgets (`scripts/perf/baselines.json`) stay untouched. Each icon button carries a localized accessible name ("Copy icon name X"), clicking copies the icon name, and the copy feedback is text, not color. The Lucide icons come from [lucide.dev](https://lucide.dev) under the ISC license and can be swapped for any compatible icon set; to extend the catalog, add a row to the category table in `icon-catalog.tsx`.

## 5. Accessible interaction

The showroom does not lower the accessibility bar for demo purposes: the tabs are a real `tablist/tab` set, overlay focus is managed by the dialog primitive, icon buttons have localized names, copy feedback goes to a `role="status"` text region, and the focus ring always uses the `ring` token. Search fields, radios and switches are native controls or components with complete ARIA state, fully keyboard operable. Demo data is fully isolated from the signed-in user's business data: scenes never query or write real resources — which is exactly why the showroom can open to every signed-in user.

## 6. Verify it

```bash
pnpm exec vitest run apps/web/src/design-system.test.tsx
pnpm exec vitest run apps/web/src/app-shell.test.tsx
just check
```

The design-system suite drives settings-directory entry visibility, token search and copy feedback, component state operation, overlay focus, scene isolation, icon search and copy, and all four language/theme combinations through the real router; the app-shell suite keeps the showroom entry in settings signed-in-only. Scene assertions are written combination-agnostically — the removal job runs the same file and verifies that example scenes vanish while the base showroom stays. The bundle-budget measurement inside `just check` confirms the showroom and icon catalog live only in async chunks — the `lazyPatterns` list in `scripts/perf/baselines.json` turns that lazy boundary into a gate, so a regression that pulls the showroom back into the initial bundle fails outright. When registering a new example, declaring `scenes` on its `ExampleContribution` adds it to the Scenes tab with no showroom changes.
