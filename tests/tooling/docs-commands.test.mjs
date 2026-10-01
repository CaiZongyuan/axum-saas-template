import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  commandRegistry,
  validateDocumentCommands,
} from '../../scripts/lib/docs-commands.mjs';

function fixture(t) {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'docs-commands-'));
  t.after(() => rmSync(rootDirectory, { recursive: true, force: true }));
  mkdirSync(join(rootDirectory, 'apps/web'), { recursive: true });
  mkdirSync(join(rootDirectory, 'scripts'));
  writeFileSync(
    join(rootDirectory, 'package.json'),
    JSON.stringify({
      name: 'root',
      scripts: { 'docs:check': 'node scripts/check.mjs', build: 'echo build' },
    }),
  );
  writeFileSync(
    join(rootDirectory, 'apps/web/package.json'),
    JSON.stringify({
      name: '@saas/web',
      scripts: { dev: 'vite', build: 'vite build' },
    }),
  );
  writeFileSync(
    join(rootDirectory, 'scripts/check.mjs'),
    'console.log("checked");\n',
  );
  return commandRegistry({
    rootDirectory,
    just: { recipes: { check: {}, dev: {} }, aliases: { verify: 'check' } },
    workspaces: [{ path: join(rootDirectory, 'apps/web') }],
  });
}

const bash = (commands) => '~~~bash\n' + commands + '\n~~~';
const fence = String.fromCharCode(96).repeat(3);

test('literal just recipes, pnpm scripts/scopes and node scripts are verified', (t) => {
  const registry = fixture(t);
  const result = validateDocumentCommands(
    bash(
      [
        'DOCS_BASE=/custom/ pnpm docs:check',
        'just --dry-run check',
        'just verify',
        'pnpm run docs:check',
        'pnpm --filter @saas/web build',
        'pnpm --filter=@saas/web dev',
        'node ./scripts/check.mjs',
        'pnpm install --frozen-lockfile',
        'pnpm exec playwright install chromium',
      ].join('\n'),
    ),
    'guide.md',
    registry,
  );
  assert.deepEqual(result, { just: 2, pnpm: 4, node: 1 });
});

test('missing recipes, root scripts, scoped scripts and files fail at the documented location', (t) => {
  const registry = fixture(t);
  assert.throws(
    () => validateDocumentCommands(bash('just missing'), 'guide.md', registry),
    /guide.md:2.*recipe.*missing/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(bash('pnpm docs:missing'), 'guide.md', registry),
    /pnpm.*docs:missing/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(bash('pnpm run install'), 'guide.md', registry),
    /pnpm.*install/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(
        bash('pnpm --filter @saas/web docs:check'),
        'guide.md',
        registry,
      ),
    /@saas\/web.*docs:check/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(
        bash('pnpm --filter @saas/missing build'),
        'guide.md',
        registry,
      ),
    /workspace.*@saas\/missing/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(
        bash('node scripts/missing.mjs'),
        'guide.md',
        registry,
      ),
    /Node script.*scripts\/missing.mjs/,
  );
  assert.throws(
    () =>
      validateDocumentCommands(
        bash('node scripts/../outside.mjs'),
        'guide.md',
        registry,
      ),
    /Node script/,
  );
});

test('comments, dynamic calls, non-shell fences and heredoc bodies are not commands', (t) => {
  const registry = fixture(t);
  const content = [
    '~~~md',
    fence + 'bash',
    'just missing',
    fence,
    '~~~',
    '',
    fence + 'js',
    'pnpm missing',
    fence,
    '',
    fence + 'bash',
    '# just missing',
    'echo "just missing; pnpm missing"',
    'just "$RECIPE"',
    'pnpm --filter "$PACKAGE" missing',
    'node "$SCRIPT"',
    "node --input-type=module <<'NODE'",
    'just missing',
    'pnpm missing',
    'node scripts/missing.mjs',
    'NODE',
    'cat <<-EOF',
    '\tjust missing',
    '\tEOF',
    'just check',
    fence,
  ].join('\n');
  assert.deepEqual(validateDocumentCommands(content, 'example.md', registry), {
    just: 1,
    pnpm: 0,
    node: 0,
  });
});

test('continuations and literal commands after shell separators remain visible', (t) => {
  const registry = fixture(t);
  const content =
    'pnpm --filter ' +
    String.fromCharCode(92) +
    '\n  @saas/web build\ntrue && just check; node scripts/check.mjs # inline comment';
  assert.deepEqual(
    validateDocumentCommands(bash(content), 'guide.md', registry),
    { just: 1, pnpm: 1, node: 1 },
  );
  assert.throws(
    () =>
      validateDocumentCommands(
        bash('true && just missing'),
        'guide.md',
        registry,
      ),
    /recipe.*missing/,
  );
});

test('multiline quoted data and multiple heredocs do not produce false commands', (t) => {
  const registry = fixture(t);
  const content = bash(
    [
      'echo "text',
      'just missing',
      '"',
      "cat <<A <<'B'",
      'pnpm missing',
      'A',
      'node scripts/missing.mjs',
      'B',
      'pnpm docs:check',
    ].join('\n'),
  );
  assert.deepEqual(validateDocumentCommands(content, 'guide.md', registry), {
    just: 0,
    pnpm: 1,
    node: 0,
  });
});
