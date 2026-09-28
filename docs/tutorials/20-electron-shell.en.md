# Walkthrough: Reusing the same pages in an Electron desktop shell

This chapter answers "where does the desktop app come from". The desktop shell is not a second product: it loads the same-origin web entry that browsers use into an Electron window, and the pages, the API contract and the session cookie all come from shared code. There is no offline editing and no second sign-in protocol.

## 1. Start the stack and open the shell

```bash
just dev
just desktop
```

`just dev` starts PostgreSQL/RustFS/Redis, the API and the Web entry as usual; `just desktop` loads that same web entry into an Electron window (default http://127.0.0.1:5173, adjustable through `SAAS_DESKTOP_ORIGIN` or `WEB_PORT` in `.env`). Registering, signing in, opening "My documents" and previewing Markdown inside the shell behaves exactly like the browser: the pages are rendered by the same [web router](../../apps/web/src/router.tsx) and the requests go through the same generated SDK.

The session cookie lives in the shell's dedicated persistent partition `persist:saas-desktop`, independent of the system browser; the login survives a shell restart. Signing out revokes the server session, so the matching sessions in the shell and in browsers end together.

## 2. The shell only wires the platform, never the business

The shell is three parts: the [main process](../../apps/desktop/src/main.ts), the [preload bridge](../../apps/desktop/src/preload.ts) and one local error page. The window is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and `<webview>` disabled. The renderer never touches Node or the session secret — it only loads same-origin pages; the cookie stays in Chromium's network stack and never enters IPC.

Navigation constraints are enforced in the shell:

- Only the app's same-origin address may load. Links to external sites do not take the window anywhere; they open in the system browser (http/https only, other schemes are ignored).
- `window.open`/`target="_blank"` popups are always refused; external targets still go to the system browser.
- Website permission requests (camera, notifications, …) are all denied by default.
- Certificate errors follow Chromium's default strict handling; the shell allows nothing through.

The preload exposes exactly six capabilities through the [IPC contract](../../apps/desktop/src/ipc-contract.ts): reading the shell version/platform, retrying the load, opening the downloads folder, subscribing to download state events, and reading and writing the appearance preferences (the language and theme enums). Every payload is contract-validated on both sides, malformed events are dropped and illegal preference values are rejected; the http/https-only policy for the system-browser handoff is part of the same contract. The contract has no secret fields and no file contents — files are written by the main process and never travel over IPC.

The preference channels are the one cross-origin channel, and they exist for the local error page: the error page loads from `file://` and cannot read the app origin's localStorage, so a platform adapter in the web entry ([desktop-preferences.tsx](../../apps/web/src/desktop-preferences.tsx) — active only inside the desktop shell, a no-op in browsers) mirrors the current language and theme to the shell, which stores them in a small JSON file in the user-data directory. Only the two enum values ever cross — session data, credentials, business objects and file paths never do. The desktop shell and the system browser persist their preferences independently. This wiring lives in the shell and the shared web entry, so it is composition-agnostic: the Core-only combination and the combination with the knowledge example behave identically.

## 3. Controlled deep-link and download entries

Deep links look like `saas://open/<in-app-path>`. After parsing, the main process requires the `saas:` protocol, the `open` host and an absolute same-origin in-app path (absolute URLs, protocol-relative paths, backslash bypasses and raw whitespace are all rejected). A valid deep link focuses the existing window and navigates it — sending `saas://open/notifications` to a running shell focuses the window and opens the notifications page. Invalid deep links are ignored silently, with no navigation and no logging of the target. The shell holds a single-instance lock: a second launch only focuses the existing window and delivers the deep link instead of opening a second window.

The download entry listens to the partition's `will-download` event: only downloads started by an app-origin page are accepted, saved into the `SaasTemplate` subdirectory of the system downloads folder (override with `SAAS_DESKTOP_DOWNLOADS_DIR`); same-named files get a sequence suffix and existing files are never overwritten. The shared pages' attachment and export downloads take exactly this path through in-page blobs; downloads from any other origin are cancelled outright. Progress and results reach the page as contract events, and the filename is sanitized so it is always a single safe path segment.

When the main document fails to load, the window switches to the local error page, and "Reconnect" returns to the address that failed. A renderer crash returns to the error page too, so there is never a blank window. The error page continues the app's appearance language: it reads the saved language and theme from the shell and renders accordingly — bilingual title, description, button and accessible names, with reachable focus and contrast in both themes. Before the app has ever run it falls back to the device preferences, and "system" follows the operating system's light/dark switch live. Closing the last window quits the app; a failed protocol registration does not affect development (deep links still arrive through second-instance arguments).

## 4. Tests and CI split

- The [IPC contract tests](../../apps/desktop/src/ipc-contract.test.ts) (Vitest) cover the bridge shape, deep-link path normalization, filename sanitization, download event validation and the preference enum validation — no GUI required, part of the default `just check`.
- The shell GUI smoke: `just desktop-smoke` boots the real stack (PostgreSQL/RustFS/Redis/Mailpit/API/Web) and drives a real Electron with Playwright: launch, sign-in/out, knowledge document browsing with Markdown preview, app-page download to disk and cross-origin download refusal, external-link handoff to the system browser, valid and invalid deep links, the offline error page with retry recovery, and the error page's preference continuity — after switching language and theme in settings and cutting the connection, the error page renders in the chosen look, the choice survives a restart on the same user-data directory, and "system" follows the emulated OS switch. Business role matrices are not repeated here; they stay in the backend and shared view tests.
- CI runs the GUI smoke as a separate `desktop-smoke` job (`xvfb-run` provides the X server on headless runners); the default main gate only includes the shell's type, build and contract checks.

## 5. Run this chapter's checks

```bash
pnpm exec vitest run apps/desktop
just desktop-smoke
just check
```

The points that matter: the secret-free IPC contract, same-origin navigation constraints, deep links that reject external targets, downloads that come only from app pages and never overwrite files, and a recoverable error page that keeps the chosen look. The shell depends on Electron and a desktop environment, so it is an optional runtime: default development and `just check` require nothing beyond the desktop toolchain.

Packaging and distribution (installers, auto-update, multi-platform signing) are out of scope for template v1; the `dist/main.cjs` produced by `pnpm --filter @saas/desktop build` can go straight into any standard Electron packaging flow.
