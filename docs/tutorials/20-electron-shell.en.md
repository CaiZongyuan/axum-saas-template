# Connect an existing Web client through Electron

Once your backend API and Web pages work, Electron can load the same pages, generated SDK and Session protocol. The shell handles platform wiring without adding separate business or authorization rules. Offline editing is not provided.

Prerequisites are [quick start](../getting-started/quickstart.md), a client using your backend and Electron's desktop dependencies with a display. Run commands from the repository root.

## Load the existing application

Start the app in one terminal and the shell in another:

```bash
just dev
```

```bash
just desktop
```

The default Web address is `http://127.0.0.1:5173`; change it through `.env` values `SAAS_DESKTOP_ORIGIN` or `WEB_PORT`. The [main process](../../apps/desktop/src/main.ts) loads that same-origin entrance, while the [Web Router](../../apps/web/src/router.tsx) and shared pages implement business. Verify sign-in, a resource read and a write, then restart the shell and read the resource again.

Cookies live in persistent partition `persist:saas-desktop`, separate from the system browser. Sign-out revokes the current server Session; only clients using that same Session lose access. An independently signed-in browser Session is not revoked by it.

## Preserve the IPC capability boundary

[Preload](../../apps/desktop/src/preload.ts) and the [IPC contract](../../apps/desktop/src/ipc-contract.ts) expose shell version/platform, load retry, download directory, download events and language/theme preferences. Both sides validate payloads. Business objects, credentials, Session secrets and file bytes never travel through IPC.

The window enables `contextIsolation` and `sandbox`, disables `nodeIntegration` and prohibits webviews. Navigation stays on the app origin; external http/https links open in the system browser. Popups, website permission requests and other schemes are rejected, with no certificate-error bypass. Define narrow IPC types and validation before adding platform capabilities rather than exposing arbitrary Node calls.

[desktop-preferences.tsx](../../apps/web/src/desktop-preferences.tsx) mirrors only language and theme enums inside Electron so the `file://` error page preserves appearance. It contains no account or business data and is a no-op in a browser.

## Wire deep links and downloads

A deep link looks like `saas://open/notifications`; substitute your registered absolute route. The parser rejects external URLs, protocol-relative paths, backslashes and raw whitespace. A single-instance lock sends valid targets to the existing window. The destination API still authenticates and authorizes; the link is not a credential.

Downloads initiated by same-origin pages go to the `SaasTemplate` subdirectory of system downloads, overridden by `SAAS_DESKTOP_DOWNLOADS_DIR`. Main-process filename sanitization and numbered collisions prevent overwriting. Cross-origin page downloads are canceled. Your Files client obtains authorized bytes through the backend and triggers a page download without placing content in IPC.

## Failures and checks

Connectivity failure or renderer crashes show a local error page. Reconnect returns to the failed application address using the shell's saved language and theme. Check load failure, retry, invalid deep links and cross-origin download rejection:

```bash
pnpm exec vitest run apps/desktop/src/ipc-contract.test.ts
pnpm --filter @saas/desktop build
just desktop-smoke
```

Contract tests need no GUI. `desktop-smoke` creates a real isolated application stack and drives Electron with Playwright to check Sessions, navigation, downloads and recovery; it needs a display or xvfb. Add a focused journey for your business pages while keeping complete role matrices in backend tests.

Backend-only and documentation-content changes do not need Electron validation. Select these checks when changing platform wiring or delivering a desktop journey. Installers, automatic updates and platform signing are not provided; connect the built `dist/main.cjs` to a separate Electron packaging pipeline.

Next: [Application-shell contribution contract](27-add-example.md). Long-term client resource observation is a separate soak task.
