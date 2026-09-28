import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * Shared launch helpers for the Electron shell smoke. The shell always loads
 * the same-origin web entry from a stack started by scripts/desktop-smoke.mjs.
 */

export const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');
export const desktopDir = join(repoRoot, 'apps/desktop');

/** Read a required smoke variable by name so failures name the variable. */
export function requireSmokeEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing smoke environment variable: ${name}`);
  return value;
}

export async function launchApp(): Promise<{
  app: ElectronApplication;
  window: Page;
  cleanup: () => Promise<void>;
}> {
  // Resolve the binary through apps/desktop so the shell is always launched
  // with the pinned Electron version of this checkout.
  const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
  const executablePath = requireFromDesktop('electron') as string;
  const extraArgs = (process.env.DESKTOP_ELECTRON_ARGS ?? '')
    .split(' ')
    .filter(Boolean);
  // Every launch gets its own user-data directory: tests must not touch the
  // developer's real shell profile, and the single-instance lock stays
  // scoped to this run.
  const userDataDir = mkdtempSync(join(tmpdir(), 'saas-desktop-profile-'));
  const app = await _electron.launch({
    executablePath,
    args: [desktopDir, ...extraArgs],
    env: {
      ...process.env,
      SAAS_DESKTOP_ORIGIN: requireSmokeEnv('E2E_WEB_URL'),
      SAAS_DESKTOP_DOWNLOADS_DIR: requireSmokeEnv('SAAS_DESKTOP_DOWNLOADS_DIR'),
      SAAS_DESKTOP_USER_DATA_DIR: userDataDir,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  const window = await app.firstWindow();
  // First visit follows the device language, and CI machines report en-US;
  // this suite's labels are zh, so pin the manual choice through the same
  // storage the app itself reads, then reload for a clean zh first paint.
  await window.evaluate(() => {
    window.localStorage.setItem('saas.locale', 'zh');
  });
  await window.reload();
  const cleanup = async () => {
    // Quit gracefully first; on headless CI a stalled quit must not hang the
    // whole Playwright worker, so bound the wait and force-kill the shell.
    // The warning keeps that path visible instead of silently hiding it.
    const exited = new Promise<void>((resolve) => {
      app.process().once('exit', () => resolve());
      const timer = setTimeout(() => {
        console.warn('[desktop-smoke] shell did not exit in time; killing');
        try {
          app.process().kill('SIGKILL');
        } catch {
          // The process may already be gone.
        }
        resolve();
      }, 20_000);
      app.process().once('exit', () => clearTimeout(timer));
    });
    // Whichever side settles first wins; a rejected close must not become an
    // unhandled error that crashes the worker after the kill.
    await Promise.race([exited, app.close().catch(() => {})]);
    rmSync(userDataDir, { recursive: true, force: true });
  };
  return { app, window, cleanup };
}

export async function emitOpenUrl(
  app: ElectronApplication,
  url: string,
): Promise<void> {
  await app.evaluate(({ app: electronApp }, deepLink) => {
    electronApp.emit('open-url', { preventDefault: () => {} }, deepLink);
  }, url);
}

export async function emitSecondInstance(
  app: ElectronApplication,
  url: string,
): Promise<void> {
  await app.evaluate(({ app: electronApp }, deepLink) => {
    // Electron passes (event, argv, workingDirectory) to the handler.
    electronApp.emit(
      'second-instance',
      { preventDefault: () => {} },
      [deepLink],
      process.cwd(),
    );
  }, url);
}

/** Sign in through the shared identity views and wait for the home surface. */
export async function signIn(window: Page): Promise<void> {
  // The shell entry is the home route; signed-out it offers a login link.
  await visible(window.getByRole('heading', { name: '欢迎使用企业空间' }));
  await window.getByRole('link', { name: '登录', exact: true }).click();
  await visible(window.getByRole('heading', { name: '登录企业空间' }));
  await window.fill('#login-email', requireSmokeEnv('DESKTOP_SMOKE_EMAIL'));
  await window.fill(
    '#login-password',
    requireSmokeEnv('DESKTOP_SMOKE_PASSWORD'),
  );
  await window.getByRole('button', { name: '登录', exact: true }).click();
  // The assembly decides where login lands (a business default entry when an
  // example declares one, the universal home otherwise). Wait for that
  // landing, then take the Core home explicitly: its view owns the logout
  // control this helper's contract promises.
  await window.waitForURL((url) => url.pathname !== '/login', {
    timeout: 15_000,
  });
  await window.goto(`${new URL(requireSmokeEnv('E2E_WEB_URL')).origin}/`);
  await visible(window.getByRole('button', { name: '退出登录' }));
}

async function visible(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 15_000 });
}
