import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { load } from 'js-yaml';

const cli = resolve('scripts/publish-create-package.mjs');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'creator-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const packageDirectory = join(directory, 'tools/create-axum-saas');
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    JSON.stringify({ name: 'create-axum-saas', version: '9.9.9' }),
  );
  mkdirSync(join(directory, '.scratch/create-package'), { recursive: true });
  writeFileSync(
    join(directory, '.scratch/create-package/create-axum-saas-9.9.9.tgz'),
    'fixture-archive',
  );
  const npm = join(directory, 'npm');
  writeFileSync(
    npm,
    `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.RELEASE_COMMAND_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'whoami') console.log('fixture-publisher');
else if (args[0] === 'view') {
  if (process.env.RELEASE_LOOKUP_ERROR) { console.log(JSON.stringify({error:{code:process.env.RELEASE_LOOKUP_ERROR}})); process.exitCode = 1; }
  else if (process.env.RELEASE_EXISTS === 'true') console.log(JSON.stringify({integrity: 'existing'}));
  else if (existsSync(process.env.RELEASE_STATE)) console.log(JSON.stringify([{integrity: process.env.RELEASE_INTEGRITY}]));
  else { console.log(JSON.stringify({error:{code:'E404'}})); process.exitCode = 1; }
}
else if (args[0] === 'publish' && args.includes('--dry-run')) console.log('fixture dry run');
else if (args[0] === 'publish' && process.env.RELEASE_ALLOW_PUBLISH === 'true') {
  writeFileSync(process.env.RELEASE_STATE, 'published'); console.log('fixture published');
}
else { console.error('Unexpected npm operation'); process.exitCode = 1; }
`,
  );
  chmodSync(npm, 0o755);
  const log = join(directory, 'commands.jsonl');
  const run = (args = [], env = {}) =>
    spawnSync(
      process.execPath,
      [cli, '--root', directory, '--version', '9.9.9', ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          NODE_AUTH_TOKEN: 'fixture-auth-value',
          RELEASE_COMMAND_LOG: log,
          RELEASE_STATE: join(directory, 'published'),
          RELEASE_INTEGRITY:
            'sha512-tH3+Kn/2Ov5s20Oa2RA4rncViMGbN3RSoFjn0u4mmF9j/iGEDUlR4zsFuvu8dWM73cKf2LLQpkI5jICwZtdydA==',
          GITHUB_REF: 'refs/heads/test-release',
          ...env,
        },
      },
    );
  return {
    directory,
    run,
    commands: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
  };
}

test('the default release authenticates and previews without publishing', (t) => {
  const release = fixture(t);
  const result = release.run();
  assert.equal(result.status, 0, result.stderr);
  const publish = release.commands().find((args) => args[0] === 'publish');
  assert.ok(publish.includes('--dry-run'));
  assert.ok(publish.includes('--ignore-scripts'));
  assert.match(result.stdout, /Dry run completed/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-auth-value/);
});

test('a mismatched release version is rejected before contacting npm', (t) => {
  const release = fixture(t);
  const result = release.run(['--version', '9.9.8']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must match.*9\.9\.9/);
  assert.deepEqual(release.commands(), []);
});

test('a real publish is rejected outside the main branch', (t) => {
  const release = fixture(t);
  const result = release.run(['--publish']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /main branch/);
  assert.deepEqual(release.commands(), []);
});

test('an existing npm version cannot be overwritten', (t) => {
  const release = fixture(t);
  const result = release.run(['--publish'], {
    GITHUB_REF: 'refs/heads/main',
    RELEASE_EXISTS: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already published/);
  assert.ok(!release.commands().some((args) => args[0] === 'publish'));
});

test('publishing succeeds only when the registry serves the exact archive', (t) => {
  const release = fixture(t);
  const result = release.run(['--publish'], {
    GITHUB_REF: 'refs/heads/main',
    RELEASE_ALLOW_PUBLISH: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Registry integrity verified/);
  const publish = release.commands().filter((args) => args[0] === 'publish');
  assert.equal(publish.length, 1);
  assert.ok(!publish[0].includes('--dry-run'));
});

test('a registry lookup failure never permits a publish', (t) => {
  const release = fixture(t);
  const result = release.run(['--publish'], {
    GITHUB_REF: 'refs/heads/main',
    RELEASE_LOOKUP_ERROR: 'E503',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to query/);
  assert.ok(!release.commands().some((args) => args[0] === 'publish'));
});

test('a different archive on the registry fails release verification', (t) => {
  const release = fixture(t);
  const result = release.run(['--publish'], {
    GITHUB_REF: 'refs/heads/main',
    RELEASE_ALLOW_PUBLISH: 'true',
    RELEASE_INTEGRITY: 'sha512-wrong',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /integrity does not match/);
});

test('a missing archive stops before npm authentication', (t) => {
  const release = fixture(t);
  rmSync(
    join(
      release.directory,
      '.scratch/create-package/create-axum-saas-9.9.9.tgz',
    ),
  );
  const result = release.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /run pnpm scaffold:pack/);
  assert.deepEqual(release.commands(), []);
});

test('Actions releases are manual previews with credentials confined to the npm step', () => {
  const workflow = load(
    readFileSync('.github/workflows/npm-publish.yml', 'utf8'),
  );
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true);
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const steps = workflow.jobs.release.steps;
  const authenticated = steps.filter((step) => step.env?.NODE_AUTH_TOKEN);
  assert.equal(authenticated.length, 1);
  assert.equal(
    authenticated[0].env.NODE_AUTH_TOKEN,
    '${{ secrets.NPM_TOKEN }}',
  );
  assert.ok(!workflow.jobs.release.env.NODE_AUTH_TOKEN);
  assert.ok(
    steps.some(
      (step) => step.with?.['registry-url'] === 'https://registry.npmjs.org',
    ),
  );
  assert.ok(
    steps.some(
      (step) =>
        step.if === 'inputs.publish' && step.run?.includes('.name == "CI"'),
    ),
  );
});
