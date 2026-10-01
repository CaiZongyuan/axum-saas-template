# Reuse language and appearance preferences in business clients

Use the shell's Preferences and Messages instead of adding a second locale state or theme table. These are device-local client choices, not changes to Users, Memberships or backend authorization. Connect these optional interface capabilities after backend behavior works.

Prerequisites are a page registered through the [contribution guide](27-add-example.md) and Providers mounted by the Web entry. Place code in your business View; run commands from the repository root.

## Add bilingual content to the same page

Keep Billing's `messages.zh` / `messages.en` complete for every key. Create `packages/views/src/billing/summary.tsx` and resolve messages through a namespace instead of detecting device language inside the component:

```tsx
import { useAppFormat } from '../shell/format';
import { useAppMessage } from '../shell/messages';

export function BillingSummary() {
  const message = useAppMessage('billing');
  const format = useAppFormat();
  return (
    <section>
      <h1>{message('page.title')}</h1>
      <output>{format.formatNumber(1200)}</output>
    </section>
  );
}
```

Import it in the previous guide's `billing/example.tsx` and replace the existing `routes` field:

```tsx
import { BillingSummary } from './summary';
```

```tsx
routes: [{ path: '/billing', component: () => <BillingSummary /> }],
```

Remove the original `BillingPage`. `page.title` is the previous guide's existing key. The sample number demonstrates formatting, not a currency amount. Use `formatDateTime` for dates; its time zone follows the device.

The business declares local keys such as `page.title`, assembled as `billing.page.title`. Core owns [core-messages.ts](../../packages/views/src/shell/core-messages.ts); business contributions must not overwrite it. `assembleApp` checks bilingual keys, navigation and scene labels. Runtime fallback cannot substitute for complete translations.

## Consume preferences without duplicating Providers

[preferences.tsx](../../packages/views/src/shell/preferences.tsx) exposes `usePreferences()`:

| Field/operation        | Contract         |
| ---------------------- | ---------------- |
| `locale` / `setLocale` | `zh              | en`; explicit choices take effect immediately |
| `theme` / `setTheme`   | `system          | light                                         | dark` |
| `resolvedTheme`        | Effective `light | dark`                                         |

Sign-in and settings already provide shell controls, so business pages usually only consume state. Explicit choices persist under `saas.locale` and `saas.theme` on this device. The first matching Chinese/English tag in `navigator.languages` determines initial locale; no match falls back to English. Theme defaults to system.

Invalid stored values act as absent values. Unavailable storage does not block startup; choices remain for the current session. OS appearance changes affect only `system`. A password-reset link can override the flow locale temporarily; a manual choice ends that override without the link silently rewriting saved choices.

## Keep first paint aligned with production themes

Before React paints, [apps/web/index.html](../../apps/web/index.html) reads the same keys and sets `html.lang`, `dark` and `color-scheme`. Update both the Provider and first-paint script when changing keys or fallback rules to prevent a light flash on a dark refresh.

Use semantic classes from [production tokens](../../packages/ui/src/styles.css), including `text-foreground`, `bg-background` and `text-muted-foreground`. Components follow the shell theme instead of maintaining page-wide color state. Messages, `html.lang`, page titles and accessible names should change with locale while preserving input.

Electron's [platform adapter](../../apps/web/src/desktop-preferences.tsx) mirrors only two preference enums to the local error page; desktop and browser storage remain independent.

## Verify and check failures

```bash
pnpm exec vitest run packages/views/src/shell/preferences.test.tsx packages/views/src/shell/core-messages.test.ts apps/web/src/settings.test.tsx
pnpm typecheck
```

Run `just dev` and switch locale/theme with existing settings controls. Your title, numeric formatting and surfaces should follow, and refresh should retain the choice. Temporarily remove Billing's English `page.title`: assembly must fail. Restore it and rerun. Complex forms also need a check that locale switches preserve drafts.

At runtime, [messages.tsx](../../packages/views/src/shell/messages.tsx) tries the active language, English and an understandable generic hint, never a raw key. This provides failure tolerance while release checks still require complete catalogs. These Core capabilities survive reference business removal.

Next: [Use production components and isolated demo scenes](29-design-system.md).
