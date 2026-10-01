import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root, stop, waitFor } from './lib/process.mjs';
import { amzDateNow, signRequest } from './lib/sigv4.mjs';

const archive = join(
  root,
  '.scratch/create-package/create-axum-saas-0.1.0.tgz',
);
const scratch = join(root, '.scratch/create-package');
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(join(scratch, 'smoke-'));
const apps = [];
const target = process.env.CARGO_TARGET_DIR || join(root, 'target');
const runAt = (command, args, cwd, env = process.env) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const browser = (session, args) => {
  const result = spawnSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(
      `Browser validation failed during ${args[0]}; authentication action parameters were discarded`,
    );
  return result.stdout;
};
const report = {
  copies: [],
  registration: false,
  apiKey: false,
  storage: false,
  mail: false,
  conflict: false,
  migrationError: false,
};

async function poll(check) {
  const deadline = Date.now() + 30000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error('Scaffold smoke readiness deadline exceeded');
    await delay(100);
  }
}

async function storageRequest(env, method, bucket, body) {
  const url = `${env.S3_ENDPOINT}/${bucket}/isolation-marker`;
  const signed = signRequest({
    method,
    url,
    body,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
    service: 's3',
    amzDate: amzDateNow(),
  });
  return fetch(url, {
    method,
    body,
    headers: signed.headers,
    signal: AbortSignal.timeout(10000),
  });
}

try {
  for (const [name, noExamples] of [
    ['first-app', false],
    ['second-app', true],
  ]) {
    const cwd = join(directory, name);
    runAt(
      'npx',
      [
        '--yes',
        '--package',
        archive,
        'create-axum-saas',
        cwd,
        ...(noExamples ? ['--no-examples'] : []),
      ],
      root,
      { ...process.env, XDG_CACHE_HOME: join(directory, 'cache') },
    );
    runAt(
      'pnpm',
      ['install', '--frozen-lockfile', '--offline', '--silent'],
      cwd,
      { ...process.env, CI: 'true' },
    );
    const { readDevelopmentEnv } = await import(
      pathToFileURL(join(cwd, 'scripts/lib/development-env.mjs'))
    );
    const env = { ...readDevelopmentEnv(cwd), CARGO_TARGET_DIR: target };
    const log = openSync(join(directory, `${name}.log`), 'w', 0o600);
    const child = spawn('just', ['dev'], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    const session = `scaffold-${name}-${process.pid}`;
    apps.push({ cwd, env, child, session });
    await waitFor(`http://${env.APP_BIND}/health/ready`, child, 180000);
    await waitFor(env.APP_ORIGIN, child, 60000);
    const config = JSON.parse(
      execFileSync('docker', ['compose', 'config', '--format', 'json'], {
        cwd,
        env,
        encoding: 'utf8',
      }),
    );
    report.copies.push({
      name,
      examples: !noExamples,
      namespace: config.name,
      webPort: env.WEB_PORT,
      apiPort: env.APP_PORT,
      volumes: Object.values(config.volumes).map((volume) => volume.name),
    });
    if (noExamples) {
      runAt(
        'cargo',
        ['check', '--locked', '--workspace', '--all-targets'],
        cwd,
        env,
      );
      runAt('pnpm', ['boundaries:check'], cwd, env);
      runAt('pnpm', ['typecheck'], cwd, env);
      runAt('pnpm', ['test:tooling'], cwd, env);
      runAt('pnpm', ['docs:check'], cwd, env);
      runAt('node', ['scripts/project-docs.mjs'], cwd, {
        ...env,
        DOCS_SOURCE_REF: '',
      });
      assert.match(
        readFileSync(
          join(cwd, 'apps/docs/.generated/getting-started/quickstart.md'),
          'utf8',
        ),
        /\/blob\/main\/docs\/getting-started\/quickstart.md/,
      );
    }
  }
  const [first, second] = apps;
  assert.notEqual(report.copies[0].namespace, report.copies[1].namespace);
  assert.equal(
    new Set(report.copies.flatMap((copy) => copy.volumes)).size,
    report.copies.flatMap((copy) => copy.volumes).length,
  );
  for (const app of apps) {
    const password = `Smoke-${randomUUID()}`;
    browser(app.session, ['open', `${app.env.APP_ORIGIN}/register`]);
    browser(app.session, [
      'eval',
      `localStorage.setItem('${app.cwd.split('/').at(-1)}.locale', 'en')`,
    ]);
    browser(app.session, ['open', `${app.env.APP_ORIGIN}/register`]);
    browser(app.session, [
      'fill',
      'input[type=email]',
      'same-user@example.test',
    ]);
    browser(app.session, ['fill', 'input[type=password]', password]);
    browser(app.session, ['click', 'button[type=submit]']);
    browser(app.session, ['wait', '--fn', "location.pathname !== '/register'"]);
    browser(app.session, ['open', app.env.APP_ORIGIN]);
    browser(app.session, ['wait', '--text', 'Sign out']);
    browser(app.session, [
      'find',
      'role',
      'button',
      'click',
      '--name',
      'Sign out',
    ]);
    browser(app.session, ['wait', '--text', 'Sign in']);
    browser(app.session, ['open', `${app.env.APP_ORIGIN}/login`]);
    browser(app.session, [
      'fill',
      'input[type=email]',
      'same-user@example.test',
    ]);
    browser(app.session, ['fill', 'input[type=password]', password]);
    browser(app.session, ['click', 'button[type=submit]']);
    browser(app.session, ['wait', '--fn', "location.pathname !== '/login'"]);
    browser(app.session, ['open', app.env.APP_ORIGIN]);
    browser(app.session, ['wait', '--text', 'Sign out']);
    const user = browser(app.session, [
      'eval',
      "fetch('/api/v1/auth/session').then(r=>r.json()).then(s=>({role:s.user.role}))",
    ]);
    assert.match(user, /owner/);
    const key = browser(app.session, [
      'eval',
      `(async () => {
      const session = await (await fetch('/api/v1/auth/session')).json();
      const created = await fetch('/api/v1/api-keys', {
        method: 'POST', headers: {'content-type':'application/json','x-csrf-token':session.csrf_token},
        body: JSON.stringify({name:'Scaffold smoke',scopes:['profile:read'],expires_in_days:1})
      });
      if (created.status !== 201) return {created:created.status};
      const key = await created.json();
      const profile = await fetch('/api/v1/profile', {headers:{authorization:'Bearer '+key.secret}});
      return {keyAuthentication:profile.status};
    })()`,
    ]);
    assert.match(key, /"keyAuthentication"\s*:\s*200/);
    browser(app.session, ['set', 'viewport', '1440', '900']);
    const brandFit = () =>
      browser(app.session, [
        'eval',
        `(() => {
      const label = document.querySelector('.app-brand > span:not(.app-brand-mark)');
      label.textContent = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv';
      return {fits: label.clientWidth > 0 && label.scrollWidth <= label.clientWidth + 1};
    })()`,
      ]);
    assert.match(brandFit(), /"fits"\s*:\s*true/);
    browser(app.session, ['set', 'viewport', '390', '844']);
    browser(app.session, [
      'find',
      'role',
      'button',
      'click',
      '--name',
      'Open navigation menu',
    ]);
    assert.match(brandFit(), /"fits"\s*:\s*true/);
    browser(app.session, ['set', 'viewport', '1280', '720']);
  }
  report.registration = true;
  report.apiKey = true;
  assert.equal(
    (
      await storageRequest(
        first.env,
        'PUT',
        first.env.S3_BUCKET,
        'first project only',
      )
    ).status,
    200,
  );
  assert.equal(
    await (await storageRequest(first.env, 'GET', first.env.S3_BUCKET)).text(),
    'first project only',
  );
  assert.equal(
    (await storageRequest(second.env, 'GET', first.env.S3_BUCKET)).status,
    404,
  );
  report.storage = true;
  const reset = await fetch(
    `http://${first.env.APP_BIND}/api/v1/auth/password-reset`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: first.env.APP_ORIGIN,
      },
      body: JSON.stringify({ email: 'same-user@example.test', locale: 'en' }),
    },
  );
  assert.equal(reset.status, 202);
  await poll(
    async () =>
      (
        await (
          await fetch(
            `http://127.0.0.1:${first.env.MAILPIT_HTTP_PORT}/api/v1/messages`,
          )
        ).json()
      ).total === 1,
  );
  assert.equal(
    (
      await (
        await fetch(
          `http://127.0.0.1:${second.env.MAILPIT_HTTP_PORT}/api/v1/messages`,
        )
      ).json()
    ).total,
    0,
  );
  report.mail = true;
  const conflict = spawnSync('node', ['scripts/dev.mjs'], {
    cwd: second.cwd,
    env: { ...second.env, APP_PORT: first.env.APP_PORT },
    encoding: 'utf8',
  });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /api:.*occupied[\s\S]*pid=/);
  report.conflict = true;
  const database = new URL(first.env.DATABASE_URL);
  database.password = 'intentionally-wrong-test-password';
  const migrate = spawnSync(
    'cargo',
    ['run', '--quiet', '--locked', '-p', 'first-app-api', '--bin', 'migrate'],
    {
      cwd: first.cwd,
      env: { ...first.env, DATABASE_URL: database.href },
      encoding: 'utf8',
    },
  );
  assert.notEqual(migrate.status, 0);
  assert.match(migrate.stderr, /password authentication failed/);
  report.migrationError = true;
  writeFileSync(
    join(scratch, 'smoke-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    'Scaffold smoke passed: packed npx, both dev stacks, browser registration/login, storage/mail isolation, conflicts and migration diagnostics.',
  );
} finally {
  for (const app of apps) {
    try {
      browser(app.session, ['close']);
    } catch {
      /* session may not have started */
    }
    await stop(app.child, 25000);
    runAt(
      'docker',
      ['compose', 'down', '--volumes', '--remove-orphans'],
      app.cwd,
      app.env,
    );
  }
  // Only the disposable copies and their fixtures are removed.
  if (report.migrationError)
    rmSync(directory, { recursive: true, force: true });
  else
    console.error(
      `Scaffold smoke failed; inspect protected logs in ${directory}`,
    );
}
