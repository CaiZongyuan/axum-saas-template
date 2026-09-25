import { watch } from 'node:fs';
import { join } from 'node:path';
import { developmentEnv, launch, root, run, stop } from './lib/process.mjs';

const env = developmentEnv();
run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'rustfs'], env);
run('cargo', ['run', '--locked', '-p', 'saas-api', '--bin', 'migrate'], env);
run(
  'cargo',
  ['run', '--locked', '-p', 'saas-api', '--bin', 'bootstrap-storage'],
  env,
);
let api = launch(
  'cargo',
  ['run', '--locked', '-p', 'saas-api', '--bin', 'saas-api'],
  env,
);
const web = launch('pnpm', ['--filter', '@saas/web', 'dev'], env);
let closing = false;
let restarting = false;
let changed = false;
let debounce;

async function restartApi() {
  changed = true;
  if (restarting || closing) return;
  restarting = true;
  while (changed && !closing) {
    changed = false;
    await stop(api);
    if (!closing)
      api = launch(
        'cargo',
        ['run', '--locked', '-p', 'saas-api', '--bin', 'saas-api'],
        env,
      );
  }
  restarting = false;
}
const watchers = ['crates', 'apps/api'].map((directory) =>
  watch(join(root, directory), { recursive: true }, (_event, name) => {
    if (!name || !/\.(rs|toml)$/.test(name)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      void restartApi();
    }, 150);
  }),
);

async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(debounce);
  watchers.forEach((watcher) => watcher.close());
  await Promise.all([stop(api), stop(web)]);
  console.log(
    'API and Web stopped. Data is preserved; use just services-down to stop PostgreSQL/RustFS.',
  );
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
web.once('exit', () => {
  if (!closing) void close();
});
console.log(
  `Web: http://127.0.0.1:${env.WEB_PORT ?? 5173} | API: http://${env.APP_BIND} | docs: just docs`,
);
