# Add a reference example

The universal app shell knows nothing about concrete businesses. An example joins through a declarative contribution object (pages, navigation groups, bilingual messages, an optional default entry) at an explicit assembly point, and the shell validates and assembles it. This chapter walks through the full wiring using the repository's notes example, then shows how the zero-, single- and dual-example source combinations run and get verified.

## 1. What an example owns

Each example registers file ownership (`ownedPaths`) and registration markers (`registrationMarkers`) in `examples/<id>/manifest.json`; the removal tool uses them to strip the example in one piece. At runtime, an example contributes an `ExampleContribution`:

```ts
{
  id: 'notes',                        // stable id: nav groups, message namespace and route ownership all derive from it
  routes: [{ path: '/notes', component }],
  navigation: [{ id: 'main', labelKey: 'nav.group', items: [...] }],
  messages: { zh: { ... }, en: { ... } }, // bilingual texts; a missing locale fails at assembly
  defaultEntry: '/notes',             // optional: the post-login business default entry
  scenes: [...],                      // optional: demo scene declarations
  provide,                            // optional: wraps this example's pages with its own ports
}
```

The types and the `assembleApp` validation live in `packages/views/src/shell/app-contract.ts`. Duplicate ids, route conflicts, Core reserved routes and missing translations all fail loudly at assembly — the last registration never silently wins. Navigation items may only point at routes the example itself contributes, and empty groups disappear.

## 2. What the notes example looks like

`packages/views/src/notes/example.tsx` is a complete minimal example: one reachable page (Notes example page), one navigation group (Notes), six texts per locale and one scene declaration. It depends on no backend — the second example exists precisely to prove that the composition interface contains no knowledge-specific special case. Pages resolve their texts with `useAppMessage('notes')`; the assembled catalog prefixes keys with `notes.`, so messages from different examples can never collide.

## 3. Joining at the assembly point

`apps/web/src/app-examples.tsx` is the only file a new example edits. Shell and Core code never import a concrete example, and examples never import each other — the assembly point imports everything and hands the result to the shell:

```tsx
// example:notes:assembly:start
import { createNotesExample } from '@saas/views';
// example:notes:assembly:end

export const exampleEntries: ExampleContribution[] = [
  // example:notes:entries:start
  createNotesExample(),
  // example:notes:entries:end
];

export const assembledApp = assembleApp({
  examples: exampleEntries,
  defaultEntry: exampleEntries.find((entry) => entry.defaultEntry !== undefined)
    ?.defaultEntry,
});
```

Each example owns two marker blocks: `assembly` (its imports) and `entries` (its list entry), and every marker name appears at most once per file so the removal tool can rewrite them mechanically. The Router exists only in the app adapter `apps/web/src/router.tsx`: it turns the assembled result into real routes, while pages receive routing through ports (`params`, `navigate`, `apiClient`) and never import a concrete Router.

## 4. The four source combinations

| Combination           | How to get it                                                    | Where login lands                                        |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Dual (default source) | run `just dev`                                                   | the knowledge example's My documents entry               |
| Notes-only            | `node scripts/example-remove.mjs` (removes knowledge by default) | the universal home `/` (notes declares no default entry) |
| Knowledge-only        | `node scripts/example-remove.mjs --example notes`                | the knowledge example's My documents entry               |
| Core-only             | remove knowledge, then notes, in one copy                        | the universal home `/`                                   |

Commit the copy between the two removals — the removal tool only edits clean copies, and the same care protects your customizations.

The default-entry strategy is decided at assembly: the first example that declares a default entry wins, and the assembly point may pin one explicitly; after login or registration the app opens the selected business default entry, and when the example owning it is removed the app falls back to the universal home. A direct visit to `/` always stays on the universal home and is never forced to a business entry; valid business deep links take precedence over the default entry. Missing targets fall back home without a redirect loop.

Every combination passes the same frontend gates: `pnpm typecheck`, `pnpm test:frontend`, `pnpm --filter @saas/web build` and `pnpm boundaries:check`. The app-shell tests assert against the assembled result (navigation groups, default entry, unknown paths, deep links), so one test file holds in all four combinations; example-owned behavior tests leave together with the example. The CI example-removal job runs all four combinations for real. Menu display never replaces direct routes or backend authorization — permission feedback still comes from the business pages and the backend contracts.

## 5. Register ownership

Once wired, register the new files in `examples/<id>/manifest.json`: `ownedPaths` lists the pages, tests and adapter files; `compositionPoints` and `registrationMarkers` record the assembly files and marker names. From then on the [compose-and-remove](23-example-removal.md) flow strips the example in one piece while the remaining groups and Core functionality stay stable.
