import assert from 'node:assert/strict';
import { isUtf8 } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseEnv } from 'node:util';

const cli = resolve('tools/create-axum-saas/index.mjs');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}
execFileSync(process.execPath, ['scripts/build-create-package.mjs'], {
  stdio: 'inherit',
});
test('the packaged creator emits renamed, history-free copies with disjoint ports', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'scaffold-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const create = (name) =>
    execFileSync(process.execPath, [cli, name], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: join(directory, 'cache') },
    });
  assert.match(create('red-maple'), /pnpm install/);
  assert.match(create('blue-oak'), /just dev/);
  const first = join(directory, 'red-maple');
  assert.ok(!existsSync(join(first, '.git')));
  for (const path of [
    '.github/workflows/npm-publish.yml',
    'scripts/publish-create-package.mjs',
    'tests/tooling/publish-create-package.test.mjs',
  ])
    assert.ok(!existsSync(join(first, path)), path);
  assert.equal(
    readFileSync(join(first, 'LICENSE'), 'utf8'),
    readFileSync(resolve('LICENSE'), 'utf8'),
  );
  assert.equal(
    JSON.parse(readFileSync(join(first, 'packages/ui/package.json'))).name,
    '@red-maple/ui',
  );
  assert.match(
    readFileSync(join(first, 'crates/platform/Cargo.toml'), 'utf8'),
    /name = "red-maple-platform"/,
  );
  assert.match(
    readFileSync(join(first, 'migrations/0001_core.sql'), 'utf8'),
    /red_maple_core/,
  );
  const ports = (name) =>
    Object.entries(
      parseEnv(readFileSync(join(directory, name, '.env'), 'utf8')),
    )
      .filter(([key]) => key.endsWith('_PORT'))
      .map(([, value]) => value);
  const red = ports('red-maple'),
    blue = ports('blue-oak');
  assert.ok(red.length >= 13);
  const firstEnv = parseEnv(readFileSync(join(first, '.env'), 'utf8'));
  assert.ok(
    readFileSync(join(first, 'README.md'), 'utf8').includes(
      `http://127.0.0.1:${firstEnv.APP_PORT}/health/ready`,
    ),
  );
  assert.equal(new Set([...red, ...blue]).size, red.length + blue.length);
  const legacy =
    /saas_core|@saas\/|saas-api|saas[.]locale|SAAS_DESKTOP|saasDesktop/;
  for (const path of files(first)) {
    assert.doesNotMatch(path, legacy);
    const content = readFileSync(path);
    if (isUtf8(content))
      assert.doesNotMatch(content.toString('utf8'), legacy, path);
  }
  const secondAttempt = spawnSync(process.execPath, [cli, 'red-maple'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.notEqual(secondAttempt.status, 0);
  assert.match(secondAttempt.stderr, /already exists/);
});

test('names and repositories containing source tokens are preserved literally', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'scaffold-name-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync(
    process.execPath,
    [cli, 'my-saas', '--repository', 'saas-labs/saas-project'],
    {
      cwd: directory,
      env: { ...process.env, XDG_CACHE_HOME: join(directory, 'cache') },
    },
  );
  const project = join(directory, 'my-saas');
  assert.equal(
    JSON.parse(readFileSync(join(project, 'packages/ui/package.json'))).name,
    '@my-saas/ui',
  );
  assert.equal(
    JSON.parse(readFileSync(join(project, 'docs/site.json'))).repository,
    'saas-labs/saas-project',
  );
});

test('the creator refuses ports published by Docker even without host listeners', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'scaffold-docker-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const command = join(directory, 'docker');
  writeFileSync(
    command,
    `#!${process.execPath}\nif (process.argv[2] === 'ps') console.log('fixture');\nelse console.log(JSON.stringify({'5432/tcp': Array.from({length:65535}, (_, i) => ({HostPort:String(i+1)}))}));\n`,
  );
  chmodSync(command, 0o755);
  const result = spawnSync(process.execPath, [cli, 'no-ports'], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      XDG_CACHE_HOME: join(directory, 'cache'),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not find a free development port group/);
  assert.ok(!existsSync(join(directory, 'no-ports')));
});

test('a core-only copy contains no example sources or removal tooling', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'scaffold-core-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync(process.execPath, [cli, 'plain-app', '--no-examples'], {
    cwd: directory,
    env: { ...process.env, XDG_CACHE_HOME: join(directory, 'cache') },
  });
  const project = join(directory, 'plain-app');
  for (const path of [
    'examples',
    'scripts/example-remove.mjs',
    'scripts/example-add.mjs',
    'scripts/lib/example-remove.mjs',
    'apps/api/tests/tutorial_module.rs',
    'crates/app/tests/tutorial_course.rs',
    'crates/app/src/modules/knowledge',
    '.github/workflows/perf-nightly.yml',
    '.github/workflows/npm-publish.yml',
    'scripts/publish-create-package.mjs',
    'tests/tooling/publish-create-package.test.mjs',
  ])
    assert.ok(!existsSync(join(project, path)), path);
  assert.ok(
    existsSync(join(project, 'crates/app/src/modules/identity/mod.rs')),
  );
  assert.ok(
    !JSON.parse(readFileSync(join(project, 'package.json'))).scripts[
      'tutorial:check'
    ],
  );
  assert.ok(
    !readFileSync(join(project, '.github/workflows/ci.yml'), 'utf8').includes(
      'example-removal:',
    ),
  );
  assert.deepEqual(
    Object.keys(
      JSON.parse(readFileSync(join(project, 'packages/contracts/openapi.json')))
        .paths,
    ).filter((path) => /knowledge|documents/.test(path)),
    [],
  );
});
