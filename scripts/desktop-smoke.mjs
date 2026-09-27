import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withTestPostgres } from './lib/postgres.mjs';
import { withTestRustfs } from './lib/rustfs.mjs';
import { withTestMailpit } from './lib/mailpit.mjs';
import { withTestRedis } from './lib/redis.mjs';
import { freePort, launch, root, run, stop, waitFor } from './lib/process.mjs';

/**
 * Electron shell smoke: boots the real stack (PostgreSQL, RustFS, Redis,
 * Mailpit, API, Web) and drives the packaged shell against it. This is the
 * GUI smoke behind `just desktop-smoke`; the default `just check` only runs
 * type, build and IPC contract checks for the shell.
 */

const smokeEmail = 'desktop-smoke@example.test';
const smokePassword = 'desktop-smoke-password';
const documentTitle = '桌面壳冒烟文档';
const documentMarker = `桌面壳预览标记 ${Date.now()}`;

function displayAvailable() {
  return Boolean(process.env.DISPLAY);
}

// The knowledge example seeds a document for the shell's shared-view browsing
// step; when the example is removed the core shell smoke keeps running.
function knowledgeExampleActive() {
  try {
    const manifest = JSON.parse(
      readFileSync(
        resolve(root, 'examples/knowledge-base/manifest.json'),
        'utf8',
      ),
    );
    return manifest.status === 'active';
  } catch {
    return false;
  }
}

async function registerSmokeUser(apiUrl, webOrigin) {
  const response = await fetch(`${apiUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webOrigin },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 201)
    throw new Error(`Could not register the smoke user: ${response.status}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  const { csrf_token: csrfToken } = await response.json();
  if (!cookie || !csrfToken)
    throw new Error('Register did not return a session cookie and CSRF token');
  return { cookie, csrfToken };
}

async function createSmokeDocument(apiUrl, webOrigin, session) {
  const response = await fetch(`${apiUrl}/api/v1/knowledge/documents`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: webOrigin,
      cookie: session.cookie,
      'x-csrf-token': session.csrfToken,
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({
      title: documentTitle,
      markdown: `# ${documentTitle}\n\n${documentMarker}\n`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 201)
    throw new Error(`Could not create the smoke document: ${response.status}`);
}

run('cargo', ['build', '--locked', '--workspace', '--bins'], {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
});
run('pnpm', ['--filter', '@saas/desktop', 'build']);

await withTestPostgres(async ({ name, url }) => {
  await withTestRustfs(async ({ name: storageName, env: storage }) => {
    await withTestRedis(async ({ env: cacheEnv }) => {
      await withTestMailpit(async ({ env: mailEnv }) => {
        const apiPort = await freePort();
        const webPort = await freePort();
        const downloadsDir = mkdtempSync(join(tmpdir(), 'saas-desktop-dl-'));
        const webOrigin = `http://127.0.0.1:${webPort}`;
        const env = {
          ...process.env,
          ...storage,
          ...cacheEnv,
          ...mailEnv,
          TELEMETRY_ENDPOINT: '',
          TELEMETRY_LOG_DIRECTORY: '',
          CACHE_PREFIX: `desktop-smoke:${name}`,
          DATABASE_URL: url,
          APP_BIND: `127.0.0.1:${apiPort}`,
          RUST_LOG: 'info',
          VITE_API_PROXY: `http://127.0.0.1:${apiPort}`,
          WEB_PORT: String(webPort),
          E2E_API_URL: `http://127.0.0.1:${apiPort}`,
          E2E_WEB_URL: webOrigin,
          APP_ORIGIN: webOrigin,
          TEST_PG_CONTAINER: name,
          E2E_STORAGE_CONTAINER: storageName,
        };
        let api;
        let web;
        try {
          run(resolve(root, 'target/debug/migrate'), [], env);
          run(resolve(root, 'target/debug/bootstrap-storage'), [], env);
          api = launch(resolve(root, 'target/debug/saas-api'), [], env);
          await waitFor(`${env.E2E_API_URL}/health/ready`, api);
          const session = await registerSmokeUser(env.E2E_API_URL, webOrigin);
          const seedKnowledge = knowledgeExampleActive();
          if (seedKnowledge)
            await createSmokeDocument(env.E2E_API_URL, webOrigin, session);
          web = launch('pnpm', ['--filter', '@saas/web', 'dev'], env);
          await waitFor(env.E2E_WEB_URL, web);

          const specEnv = {
            ...env,
            DESKTOP_SMOKE_EMAIL: smokeEmail,
            DESKTOP_SMOKE_PASSWORD: smokePassword,
            ...(seedKnowledge
              ? {
                  DESKTOP_SMOKE_DOCUMENT_TITLE: documentTitle,
                  DESKTOP_SMOKE_DOCUMENT_MARKER: documentMarker,
                }
              : {}),
            SAAS_DESKTOP_DOWNLOADS_DIR: downloadsDir,
          };
          // Headless CI machines drive the shell under a fresh X server.
          const playwrightArgs = [
            'exec',
            'playwright',
            'test',
            '--config',
            'tests/desktop/playwright.config.ts',
          ];
          if (displayAvailable()) {
            run('pnpm', playwrightArgs, specEnv);
          } else {
            // xvfb-run computes and exports a fresh display for the shell.
            run(
              'xvfb-run',
              ['--auto-servernum', 'pnpm', ...playwrightArgs],
              specEnv,
            );
          }
        } finally {
          await Promise.all([stop(web), stop(api)]);
          rmSync(downloadsDir, { recursive: true, force: true });
        }
      });
    });
  });
});
console.log('desktop shell smoke passed');
