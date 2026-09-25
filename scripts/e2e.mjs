import { resolve } from 'node:path';
import { withTestPostgres } from './lib/postgres.mjs';
import { freePort, launch, root, run, stop, waitFor } from './lib/process.mjs';

run('cargo', ['build', '--locked', '-p', 'saas-api', '--bins'], {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
});
await withTestPostgres(async ({ name, url }) => {
  const apiPort = await freePort();
  const webPort = await freePort();
  const env = {
    ...process.env,
    DATABASE_URL: url,
    APP_BIND: `127.0.0.1:${apiPort}`,
    RUST_LOG: 'info',
    VITE_API_PROXY: `http://127.0.0.1:${apiPort}`,
    WEB_PORT: String(webPort),
    E2E_API_URL: `http://127.0.0.1:${apiPort}`,
    E2E_WEB_URL: `http://127.0.0.1:${webPort}`,
    TEST_PG_CONTAINER: name,
  };
  run(resolve(root, 'target/debug/migrate'), [], env);
  const api = launch(resolve(root, 'target/debug/saas-api'), [], env);
  let web;
  try {
    await waitFor(`${env.E2E_API_URL}/health/ready`, api);
    web = launch('pnpm', ['--filter', '@saas/web', 'dev'], env);
    await waitFor(env.E2E_WEB_URL, web);
    run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], env);
  } finally {
    await Promise.all([stop(web), stop(api)]);
  }
});
