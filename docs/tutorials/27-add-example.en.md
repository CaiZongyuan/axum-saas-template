# Connect your business pages to the application shell

After composing your backend module and OpenAPI, contribute Web pages, navigation and bilingual messages through ExampleContribution to the Universal App Shell. A frontend contribution does not register backend routes or grant resource access; API assembly and business authorization own those responsibilities.

Prerequisites are [project structure](../architecture/project-structure.md) and installed pnpm dependencies. Make these changes in your development copy and run commands from the repository root.

## Create a complete minimal contribution

Create `packages/views/src/billing/example.tsx`. This stage adds one page; later use `AppPageProps.apiClient` with your generated SDK:

```tsx
import type { ExampleContribution } from '../shell/app-contract';
import { useAppMessage } from '../shell/messages';

function BillingPage() {
  const message = useAppMessage('billing');
  return <h1>{message('page.title')}</h1>;
}

export function createBillingExample(): ExampleContribution {
  return {
    id: 'billing',
    routes: [{ path: '/billing', component: () => <BillingPage /> }],
    navigation: [
      {
        id: 'main',
        labelKey: 'nav.group',
        items: [{ id: 'billing', labelKey: 'page.title', path: '/billing' }],
      },
    ],
    messages: {
      zh: { 'nav.group': '账务', 'page.title': '账务' },
      en: { 'nav.group': 'Billing', 'page.title': 'Billing' },
    },
    defaultEntry: '/billing',
  };
}
```

Append to the [Views entry](../../packages/views/src/index.ts):

```ts
export { createBillingExample } from './billing/example';
```

Keep a small page simple. When it needs parameters, navigation or a client, use `params`, `navigate` and `apiClient` from the [public page ports](../../packages/views/src/shell/app-contract.ts). Shared pages do not import the Web Router.

## Register at the Assembly Point

[app-examples.tsx](../../apps/web/src/app-examples.tsx) is the Web assembly file importing business contributions. Add this import and array entry outside existing business markers:

```tsx
// example:billing:assembly:start
import { createBillingExample } from '@saas/views';
// example:billing:assembly:end
```

```tsx
  // example:billing:entries:start
  createBillingExample(),
  // example:billing:entries:end
```

The second block belongs inside the existing `exampleEntries` array. Shared shell, settings and notifications consume `assembledApp` without knowing Billing. [apps/web/src/router.tsx](../../apps/web/src/router.tsx) turns contributions into real routes.

```bash
pnpm typecheck
pnpm test:frontend
pnpm --filter @saas/web build
pnpm boundaries:check
```

Run `just dev`, sign in and open `/billing`; the heading should work in both languages. Temporarily change the route to Core-reserved `/settings`: assembly must fail explicitly. Restore the route and verify again.

## Default Entry and authorization

The first contribution declaring `defaultEntry` selects the post-login/registration destination; assembly may override it explicitly. Appending Billing after an existing default business does not change that destination automatically. Direct `/` remains universal home; valid business deep links take priority, and removal of a selected entry falls back to home.

`assembleApp` rejects duplicate ids, conflicting routes, Core-reserved routes, missing bilingual keys and navigation to uncontributed routes. Hiding navigation grants no protection. Direct pages and APIs still need backend identity, active Membership and resource rules.

## Register ownership and optional contributions

Create `examples/billing/manifest.json` for a removable Reference Domain. Register stable id/markerPrefix, backend/page paths, bilingual tutorials, migrations, tests, exclusive dependencies and assembly markers. Shared capabilities cannot be business-exclusive, and businesses do not import one another. See [removal](23-example-removal.md) for the complete rules.

Add `provide` for page-specific ports, `resolveNotificationTarget` for navigation, `describeNotification` for localized notification titles, `scenes` for demos and `moduleIcons` for business-route icons when needed. Unknown notification targets remain readable and the destination API reauthorizes. Unused fields need no placeholders.

The shipped UI-only notes example can be registered with `node scripts/example-add.mjs --example notes` in a clean copy. It proves composition, not a backend notes product. The tool reads `examples/<id>/registration.mjs`, verifies all anchors before writing and rejects dirty copies, duplicate additions and ambiguous anchors. A new business still requires your implementation and ownership registration; the tool does not generate business rules.

Next: [Reuse language and appearance preferences](28-appearance-language.md), then [register isolated demo scenes](29-design-system.md).
