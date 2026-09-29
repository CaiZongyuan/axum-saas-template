import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The add tool splices a shipped-but-unregistered example back into a
// clean template working copy (UI-R5). These tests run the CLI against a
// synthetic miniature so each refusal path is observable in isolation;
// the real-repository re-add runs in the CI example-removal job.

const addScript = fileURLToPath(
  new URL('../../scripts/example-add.mjs', import.meta.url),
);

// Fixture commits carry an explicit identity: CI runners have no global
// git user, so a commit without one fails there but not on a configured
// developer machine.
const gitIdentity = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
};

function run(root, example = 'notes') {
  return execFileSync(
    'node',
    [addScript, '--example', example, '--root', root],
    { encoding: 'utf8', stderr: 'pipe' },
  );
}

// Runs the CLI expecting a refusal; returns stderr so each test asserts on
// the named problem instead of just the non-zero exit.
function runRefused(root, example = 'notes') {
  try {
    run(root, example);
  } catch (error) {
    return error.stderr.toString();
  }
  assert.fail('the add tool should have refused');
}

const manifest = () =>
  JSON.stringify(
    {
      id: 'notes',
      status: 'active',
      markerPrefix: 'notes',
      description: 'The composition proving example.',
      ownedPaths: ['examples/notes/registration.mjs'],
      compositionPoints: { web: 'src/app.tsx' },
      registrationMarkers: { 'src/app.tsx': ['assembly', 'entries'] },
      unregisteredMarkers: { 'src/app.tsx': ['assembly', 'entries'] },
    },
    null,
    2,
  );

const registration = () =>
  [
    '// The registration blocks the notes example contributes.',
    'export default {',
    "  'src/app.tsx': [",
    '    {',
    "      marker: 'assembly',",
    "      afterLastMatch: '^// example:\\\\w+:assembly:end',",
    '      text: [',
    "        '// example:notes:assembly:start',",
    '        "import { createNotesExample } from \'@saas/views\';",',
    "        '// example:notes:assembly:end',",
    "      ].join('\\n'),",
    '    },',
    '    {',
    "      marker: 'entries',",
    "      beforeLine: '];',",
    '      text: [',
    "        '  // example:notes:entries:start',",
    "        '  createNotesExample(),',",
    "        '  // example:notes:entries:end',",
    "      ].join('\\n'),",
    '    },',
    '  ],',
    '};',
    '',
  ].join('\n');

const composition = () =>
  [
    '// example:knowledge:assembly:start',
    "import { createKnowledgeExample } from '@saas/views';",
    '// example:knowledge:assembly:end',
    '',
    'export const entries = [',
    '  // example:knowledge:entries:start',
    '  createKnowledgeExample(),',
    '  // example:knowledge:entries:end',
    '];',
    '',
  ].join('\n');

// The assembled result: notes rides directly after the last example's
// assembly block — never inside it — and joins the entries list before
// the closing bracket.
const assembled = () =>
  [
    '// example:knowledge:assembly:start',
    "import { createKnowledgeExample } from '@saas/views';",
    '// example:knowledge:assembly:end',
    '// example:notes:assembly:start',
    "import { createNotesExample } from '@saas/views';",
    '// example:notes:assembly:end',
    '',
    'export const entries = [',
    '  // example:knowledge:entries:start',
    '  createKnowledgeExample(),',
    '  // example:knowledge:entries:end',
    '  // example:notes:entries:start',
    '  createNotesExample(),',
    '  // example:notes:entries:end',
    '];',
    '',
  ].join('\n');

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'example-add-'));
  const write = (path, content) => writeFileSync(join(root, path), content);
  for (const directory of ['examples/notes', 'src'])
    execFileSync('mkdir', ['-p', join(root, directory)]);
  write('examples/notes/manifest.json', `${manifest()}\n`);
  write('examples/notes/registration.mjs', registration());
  write('src/app.tsx', composition());
  execFileSync('git', ['init', '--quiet', '-b', 'main', root]);
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], {
      env: { ...process.env, ...gitIdentity },
    });
  git('add', '.');
  git('commit', '--quiet', '-m', 'template');
  return root;
}

const commitAll = (root) => {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'add notes'], {
    env: { ...process.env, ...gitIdentity },
  });
};

test('splices every block at its anchor and is idempotent under re-run', () => {
  const root = buildFixture();
  try {
    assert.match(run(root), /added notes to 1 composition point\(s\)/);
    assert.equal(readFileSync(join(root, 'src/app.tsx'), 'utf8'), assembled());
    // After committing the assembly, a second add refuses: the example is
    // already registered and must not be spliced twice.
    commitAll(root);
    assert.match(
      runRefused(root),
      /already carries example:notes:assembly:start/,
    );
    assert.equal(readFileSync(join(root, 'src/app.tsx'), 'utf8'), assembled());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses template markers the manifest does not declare', () => {
  const root = buildFixture();
  try {
    writeFileSync(
      join(root, 'examples/notes/registration.mjs'),
      registration().replaceAll("marker: 'assembly'", "marker: 'bogus'"),
    );
    commitAll(root); // the tool only edits clean copies
    const stderr = runRefused(root);
    assert.match(stderr, /bogus is not declared in/);
    // The refusal is transactional: any problem aborts every write, so the
    // valid entries block is not spliced in either.
    assert.equal(
      readFileSync(join(root, 'src/app.tsx'), 'utf8'),
      composition(),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses an ambiguous anchor instead of guessing', () => {
  const root = buildFixture();
  try {
    // A second exact `];` line makes the entries anchor ambiguous.
    const ambiguous = `${composition()}export const other = [\n];\n`;
    writeFileSync(join(root, 'src/app.tsx'), ambiguous);
    commitAll(root); // the tool only edits clean copies
    assert.match(runRefused(root), /anchor "\];" for entries is ambiguous/);
    assert.equal(readFileSync(join(root, 'src/app.tsx'), 'utf8'), ambiguous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses an anchor that matches no line', () => {
  const root = buildFixture();
  try {
    writeFileSync(
      join(root, 'examples/notes/registration.mjs'),
      registration().replaceAll(
        "beforeLine: '];'",
        "beforeLine: 'no such line'",
      ),
    );
    commitAll(root); // the tool only edits clean copies
    assert.match(runRefused(root), /anchor for entries matched no line/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a dirty copy and a missing or inactive example', () => {
  const root = buildFixture();
  try {
    writeFileSync(join(root, 'src/app.tsx'), `${composition()}// custom\n`);
    assert.match(runRefused(root), /uncommitted changes/);
    assert.match(
      runRefused(root, 'no-such-example'),
      /missing: .*no-such-example/,
    );
    const manifestPath = join(root, 'examples/notes/manifest.json');
    const removed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    removed.status = 'removed';
    writeFileSync(manifestPath, `${JSON.stringify(removed, null, 2)}\n`);
    assert.match(runRefused(root), /not active; nothing to register/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
