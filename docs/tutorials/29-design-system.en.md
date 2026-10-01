# Use production components and register business demo scenes

Web clients reuse components and semantic tokens through `@saas/ui`, while business contributions provide isolated demos through ExampleContribution.scenes. The design-system page reads production components rather than maintaining separate colors or copies.

Prerequisites are [application-shell integration](27-add-example.md) and [bilingual messages](28-appearance-language.md). Backend contracts do not depend on the design system, and scenes do not call production APIs.

## Choose components for business pages

Import public exports from the [UI component directory](../../packages/ui/src/components/), for example:

```tsx
import { Button } from '@saas/ui/components/button';
```

Use semantic `primary`, `destructive`, `success`, `warning` and `ring` tokens in [styles.css](../../packages/ui/src/styles.css). Buttons, inputs, dialogs and status components share focus, disabled, error and loading semantics. Errors also need text and `aria-invalid`, not color alone.

Run `just dev`, sign in and open `/design-system` or its settings section. Foundations read `getComputedStyle` dynamically; the component section exposes real buttons, inputs and dialogs. It helps developers choose and inspect components without granting business permissions.

## Add a complete Billing scene

Add this component to `packages/views/src/billing/example.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@saas/ui/components/button';

function BillingDemo() {
  const message = useAppMessage('billing');
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <Button onClick={() => setSaved(true)}>{message('demo.save')}</Button>
      <p role="status">{saved ? message('demo.saved') : ''}</p>
    </div>
  );
}
```

Keep the file's existing `useAppMessage` import from the previous guide. Extend bilingual `messages` with:

```ts
// messages.zh
'demo.title': '账务保存反馈',
'demo.save': '保存',
'demo.saved': '已保存',

// messages.en
'demo.title': 'Billing save feedback',
'demo.save': 'Save',
'demo.saved': 'Saved',
```

Add to the contribution returned by `createBillingExample()`:

```tsx
scenes: [
  {
    id: 'save-feedback',
    titleKey: 'demo.title',
    render: () => <BillingDemo />,
  },
],
```

The scene uses only local React state and demonstration data. Save changes feedback without reading or modifying real resources. The [AppScene contract](../../packages/views/src/shell/app-contract.ts) defines assembly validation; the [scene renderer](../../packages/views/src/design-system/scenes-section.tsx) adds ownership and localized titles.

## Preserve loading and ownership boundaries

The design system is an asynchronous chunk, with the icon catalog lazy-loaded inside it. Do not synchronously import [icon-catalog.tsx](../../packages/views/src/design-system/icon-catalog.tsx) from a business entry to obtain one icon; import operation icons directly from Lucide. Route ModuleIcons are supplied through `moduleIcons`. File icons use an attributed Material Icon Theme subset; see [third-party notices](../../THIRD-PARTY-NOTICES.md).

Register demo components and tests as business-owned. Removing the contribution removes its scenes and route icons. Core-only compositions retain foundations, components and generic scenes; the showroom must not import business code backward.

## Verify and check failures

```bash
pnpm exec vitest run apps/web/src/design-system.test.tsx apps/web/src/app-shell.test.tsx
pnpm typecheck
node scripts/perf-bundle.mjs
```

Open the Billing scene in both languages and themes, save and verify `role="status"` feedback while real business data remains unchanged. Temporarily remove the English `demo.title`: assembly must fail. Restore it and recheck. Dialog scenes also need keyboard focus and Esc checks.

Bundle validation ensures design-system and icon catalog stay out of the initial set. The [lazy-loading baseline](../../scripts/perf/baselines.json) already enforces this; registering a scene should not require raising a threshold to hide a static-import regression.

Next: write product documentation with [Maintain developer documentation](../guides/maintain-docs.md); use the [public-site guide](30-public-site.md) for its host.
