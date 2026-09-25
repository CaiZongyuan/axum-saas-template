import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { withTestPostgres } from './lib/postgres.mjs';
import { withTestRustfs } from './lib/rustfs.mjs';
import { freePort, launch, root, run, stop, waitFor } from './lib/process.mjs';

// Remove legacy HTML reports that can contain authentication action arguments.
rmSync(resolve(root, 'playwright-report'), { recursive: true, force: true });

run('cargo', ['build', '--locked', '-p', 'saas-api', '--bins'], {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
});
await withTestPostgres(async ({ name, url }) => {
  await withTestRustfs(async ({ env: storage }) => {
    const apiPort = await freePort();
    const webPort = await freePort();
    const env = {
      ...process.env,
      ...storage,
      DATABASE_URL: url,
      APP_BIND: `127.0.0.1:${apiPort}`,
      RUST_LOG: 'info',
      VITE_API_PROXY: `http://127.0.0.1:${apiPort}`,
      WEB_PORT: String(webPort),
      E2E_API_URL: `http://127.0.0.1:${apiPort}`,
      E2E_WEB_URL: `http://127.0.0.1:${webPort}`,
      APP_ORIGIN: `http://127.0.0.1:${webPort}`,
      TEST_PG_CONTAINER: name,
      E2E_OWNER_EMAIL: 'bootstrap-owner@example.test',
      E2E_OWNER_PASSWORD: 'browser-test-owner-password',
    };
    run(resolve(root, 'target/debug/migrate'), [], env);
    run(resolve(root, 'target/debug/bootstrap-storage'), [], env);
    const api = launch(resolve(root, 'target/debug/saas-api'), [], env);
    let web;
    try {
      await waitFor(`${env.E2E_API_URL}/health/ready`, api);
      // All journeys start with a known Owner; newly registered accounts are Members.
      // This prevents test-file ordering from changing role expectations.
      const bootstrap = await fetch(`${env.E2E_API_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: env.APP_ORIGIN },
        body: JSON.stringify({
          email: env.E2E_OWNER_EMAIL,
          password: env.E2E_OWNER_PASSWORD,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (
        bootstrap.status !== 201 ||
        (await bootstrap.json()).user.role !== 'owner'
      )
        throw new Error('Could not initialize the isolated E2E Owner');
      web = launch('pnpm', ['--filter', '@saas/web', 'dev'], env);
      await waitFor(env.E2E_WEB_URL, web);
      run(
        'pnpm',
        ['exec', 'playwright', 'test', ...process.argv.slice(2)],
        env,
      );
    } finally {
      await Promise.all([stop(web), stop(api)]);
    }
  });
});
