import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  classifyChanges,
  verifyJobResults,
} from '../../scripts/ci-change-scope.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const workflow = () =>
  yaml.load(
    readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    ),
  );

test('documentation and website tooling never select application or desktop checks', () => {
  assert.deepEqual(
    classifyChanges([
      'docs/learn/tickets.md',
      'README.md',
      'apps/docs/.vitepress/theme/index.ts',
      'scripts/lib/docs-content.mjs',
      'tests/docs/public-site.spec.ts',
    ]),
    {
      docs: true,
      backend: false,
      teaching: false,
      frontend: false,
      desktop: false,
      removal: false,
    },
  );
});

test('backend teaching sources select their public tests without Electron', () => {
  assert.deepEqual(
    classifyChanges([
      'examples/tutorial-tickets/exports.rs',
      'examples/tutorial-tickets/migrations/0003_exports.sql',
      'crates/app/tests/tutorial_course.rs',
      'scripts/tutorial-course.mjs',
      'scripts/check-tutorial-recovery.mjs',
      'tests/tooling/tutorial-course.test.mjs',
      'docs/tutorials/13-export-notifications.md',
      'docs/tutorials/14-audit-history.en.md',
    ]),
    {
      docs: true,
      backend: false,
      teaching: true,
      frontend: false,
      desktop: false,
      removal: false,
    },
  );
});

test('shared server changes retain backend and removal checks without shell tests', () => {
  const scope = classifyChanges([
    'crates/app/src/modules/files/mod.rs',
    'Cargo.lock',
  ]);
  assert.equal(scope.backend, true);
  assert.equal(scope.teaching, true);
  assert.equal(scope.removal, true);
  assert.equal(scope.desktop, false);
});

test('client and shell runtime changes select desktop smoke', () => {
  for (const path of [
    'packages/views/src/shell/home.tsx',
    'apps/desktop/src/main.ts',
    'scripts/desktop-smoke.mjs',
    'tests/desktop/shell.spec.ts',
  ])
    assert.equal(classifyChanges([path]).desktop, true, path);
  assert.equal(
    classifyChanges(['examples/knowledge-base/manifest.json']).desktop,
    false,
  );
});

test('unknown paths and manual full runs conservatively select every check', () => {
  for (const scope of [
    classifyChanges(['future-runtime/new.bin']),
    classifyChanges([], { all: true }),
    classifyChanges(['.github/workflows/ci.yml']),
  ])
    assert.ok(Object.values(scope).every(Boolean));
});

test('CLI diffs preserve renamed source ownership and newline filenames, and emit stable job outputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'saas-ci-scope-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'scope-test@example.test');
    git('config', 'user.name', 'Scope test');
    mkdirSync(join(directory, 'crates/app/src'), { recursive: true });
    writeFileSync(
      join(directory, 'crates/app/src/old.rs'),
      'pub fn example() {}\n',
    );
    git('add', '.');
    git('commit', '-qm', 'Fixture base');
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(directory, 'docs'));
    renameSync(
      join(directory, 'crates/app/src/old.rs'),
      join(directory, 'docs/renamed.md'),
    );
    writeFileSync(join(directory, 'docs/new\nline.md'), '# A document\n');
    git('add', '-A');
    git('commit', '-qm', 'Fixture rename');
    const output = join(directory, 'job-output');
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('../../scripts/ci-change-scope.mjs', import.meta.url),
          ),
          '--base',
          base,
          '--head',
          git('rev-parse', 'HEAD'),
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_OUTPUT: output,
          },
        },
      ),
    );
    assert.ok(report.paths.includes('crates/app/src/old.rs'));
    assert.ok(report.paths.includes('docs/renamed.md'));
    assert.ok(report.paths.includes('docs/new\nline.md'));
    assert.equal(report.scope.backend, true);
    assert.equal(report.scope.desktop, false);
    assert.match(readFileSync(output, 'utf8'), /backend=true\n/);
    assert.match(readFileSync(output, 'utf8'), /desktop=false\n/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function results(scope) {
  const jobFor = {
    docs: 'documentation',
    backend: 'backend',
    teaching: 'teaching-backend',
    frontend: 'frontend',
    desktop: 'desktop-smoke',
    removal: 'example-removal',
  };
  return {
    changes: {
      result: 'success',
      outputs: Object.fromEntries(
        Object.entries(scope).map(([key, value]) => [key, String(value)]),
      ),
    },
    tooling: { result: 'success' },
    ...Object.fromEntries(
      Object.entries(scope).map(([key, selected]) => [
        jobFor[key],
        { result: selected ? 'success' : 'skipped' },
      ]),
    ),
  };
}

test('required verify accepts only successful selected jobs and propagates failures and unexpected skips', () => {
  const scope = classifyChanges(['docs/index.md']);
  verifyJobResults(results(scope));
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const failed = results(scope);
    failed.documentation.result = result;
    assert.throws(() => verifyJobResults(failed), /documentation/);
  }
  const failedClassifier = results(scope);
  failedClassifier.changes.result = 'failure';
  assert.throws(() => verifyJobResults(failedClassifier), /changes/);
  const absentOutput = results(scope);
  delete absentOutput.changes.outputs.desktop;
  assert.throws(() => verifyJobResults(absentOutput), /desktop/);
});

test('workflow routes expensive checks through scope and keeps verify as the publication gate', () => {
  const { jobs } = workflow();
  assert.match(
    jobs['desktop-smoke'].if,
    /needs.changes.outputs.desktop == 'true'/,
  );
  assert.match(
    jobs['teaching-backend'].if,
    /needs.changes.outputs.teaching == 'true'/,
  );
  assert.match(
    jobs['example-removal'].if,
    /needs.changes.outputs.removal == 'true'/,
  );
  assert.match(jobs.verify.if, /always\(\)/);
  assert.deepEqual(
    new Set(jobs.verify.needs),
    new Set(
      Object.keys(jobs).filter(
        (id) => !['verify', 'publish-docs'].includes(id),
      ),
    ),
  );
  assert.deepEqual(jobs['publish-docs'].needs, ['verify', 'documentation']);
  assert.match(
    jobs['publish-docs'].if,
    /needs.documentation.result == 'success'/,
  );
  const docsCommands = jobs.documentation.steps
    .map((step) => step.run ?? '')
    .join('\n');
  assert.match(docsCommands, /docs:check/);
  assert.match(docsCommands, /docs:build/);
  assert.doesNotMatch(docsCommands, /desktop-smoke|just check|test-backend/);
  assert.ok(
    jobs.documentation.steps.some((step) => step.with?.name === 'docs-site'),
  );
});
