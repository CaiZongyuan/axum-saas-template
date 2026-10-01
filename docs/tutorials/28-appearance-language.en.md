# Walkthrough: Appearance and language settings

The interface language and light/dark theme are device-scoped preferences: they switch before sign-in, the choice lives in the current browser or desktop app, it never syncs across devices, and it never enters account data. This chapter walks the full preference behavior — first visit follows the device, an explicit choice wins, refresh restores it, invalid values fall back, storage being unavailable still allows in-session switching — plus the ownership rules for bilingual messages: Core and each example keep their own catalogs, merged at the assembly point, with runtime fallback to an understandable hint rather than a bare key.

## 1. Feel it first: from the login page to settings

Run `just dev` and open `/login`. The top-right corner carries two controls — "简体中文 / English" and "跟随系统 / 亮色 / 暗色" (System / Light / Dark) — that behave identically before and after sign-in: clicking applies immediately, the page never reloads, and anything typed into the email/password fields stays. The register, forgot-password and reset-password pages use the same controls.

After signing in, the sidebar bottom leads to "Settings" (`/settings`): language and theme live in the "Appearance & language" section, still two native radio groups writing the same preference state as the login-page controls. Switch to English and the sidebar, page title and `html.lang` become English together; the address bar is unchanged and no network request is made — switching is pure frontend state.

Clicking the lower-left user area opens settings directly. Its directory sits immediately beside the main sidebar, with Appearance & language, Profile, API Keys, Design system, System status and Help. Identity-related sections appear after sign-in. `?section=` opens a specific section, such as `/settings?section=api-keys`. The utilities operate inside settings; existing `/api-keys`, `/design-system` and `/system` bookmarks remain usable.

Drag the desktop sidebar's right edge to change its width. With the separator focused, arrow keys adjust it, Home/End reach its bounds, and double-click restores the default. Width is remembered on this device. Profile avatars use DiceBear, defaulting to Lorelei, with selectable designs and backgrounds. Changes stay in a draft until confirmed. Avatar preferences are remembered per user on this device; they do not modify account data or sync across devices.

## 2. How the preference is decided

The [preferences module](../../packages/views/src/shell/preferences.tsx) implements three rules:

1. **First visit follows the device.** `navigator.languages` is scanned in order for the first Chinese or English tag: Chinese (`zh-*`) → Simplified Chinese; English (`en-*`) → English; neither → English. `html.lang` becomes `zh-CN` or `en` accordingly.
2. **An explicit choice wins and persists.** Choices are written to `saas.locale` and `saas.theme` in `localStorage`; the next visit reads them and never looks at the device language again.
3. **Invalid values fall back.** A stored value outside the known sets (edited by hand, say) is treated as "nothing saved" and rule 1 applies.

The theme defaults to "follow the system": only that mode listens for OS light/dark changes and switches live; "Light / Dark" stay fixed.

## 3. No first-paint flash: the inline pre-paint script

Before React's first render, an inline script in [index.html](../../apps/web/index.html) reads the same two keys and sets `lang`, the `dark` class and `color-scheme` directly on `<html>`. Refreshing with a dark preference therefore never flashes white first. The script's logic must stay in sync with `PreferencesProvider` — both read the same keys with the same fallback order; change one side, change the other.

When storage is unavailable (private modes that disable it, and similar), both reads fail silently: the app starts normally, preferences last only for the session, and the switch controls keep working.

## 4. Bilingual messages register by ownership

Interface texts live in two places:

- **The Core catalog**: [core-messages.ts](../../packages/views/src/shell/core-messages.ts) holds the zh/en texts for the shell, home, identity flows, settings, errors and common hints. Release completeness is enforced by parity tests — identical zh/en key sets, no empty values, matching placeholders.
- **Example catalogs**: each example ships bilingual texts in its own `ExampleContribution.messages`, keyed under the example's id namespace (such as `notes.page.title`).

At assembly, Core registers first and examples append; an example claiming a key another owner already registered fails assembly loudly — never a silent overwrite. Pages resolve texts through `useAppMessage()` (or the namespaced `useAppMessage('notes')`): a missing current-locale entry falls back to English, and a still-missing one renders an understandable hint such as "This interface text is unavailable." — never a bare key, never a throw. `{name}`-style parameter interpolation is the shared resolver's job.

Dates and numbers format through the current locale's `Intl.DateTimeFormat` / `Intl.NumberFormat` (`useAppFormat`); the time zone stays the device's. The settings page's tutorial link opens this chapter's locale-correct deep link (zh `/docs/`, en `/en/docs/`, joined against the site base).

## 5. Accessibility and narrow screens

The language and theme controls are real buttons (`aria-pressed` marks the active option); the settings page uses native `fieldset/legend` radios, so keyboard behavior is the platform's. Switching languages updates `html.lang`, the page `<title>` and meta description, and the navigation's accessible name ("主菜单 / Main menu") together. On narrow screens the sidebar folds into a drawer whose toggle announces state through `aria-expanded` / `aria-controls`, and Escape dismisses it; touch targets stay at or above 44px on narrow screens, while desktop rows compact to 36px. Notifications and API keys are signed-in capabilities, so the signed-out sidebar does not advertise them.

## 6. Verify it

```bash
pnpm exec vitest run packages/views/src/shell/preferences.test.tsx
pnpm exec vitest run packages/views/src/shell/core-messages.test.ts
pnpm exec vitest run apps/web/src/settings.test.tsx
just check
```

The preference tests cover the device-language order, theme resolution, persistence, invalid-value fallback, system-theme reactivity and unavailable storage; the Core catalog tests run the zh/en parity checks; the settings tests drive switching, persistence and kept input through the real Router. Browser verification happens once, concentrated: first-paint theme, refresh restore, OS light/dark reactivity and the narrow-screen drawer. Removing either example leaves this chapter's capabilities untouched — preferences and the Core catalog belong to no example.
