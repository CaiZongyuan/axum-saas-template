import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkRemovalSafety,
  loadExampleManifest,
  planExampleRemoval,
  removeExample,
  retainedHistoryPaths,
  verifyExampleManifest,
  verifyExampleManifests,
} from '../../scripts/lib/example-remove.mjs';

// The removal tool operates on a template working copy described by the
// example ownership manifest. These tests exercise it against a synthetic
// miniature of the template so each contract is observable in isolation;
// the real-repository removal runs in the CI example-removal job.

// Fixture commits carry an explicit identity: CI runners have no global
// git user, so a commit without one fails there but not on a configured
// developer machine.
const gitIdentity = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
};

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'example-remove-'));
  const write = (path, content) => {
    const target = join(root, path);
    writeFileSync(target, content);
    return target;
  };
  for (const directory of [
    'examples/knowledge-base',
    'crates/app/src/modules/knowledge',
    'crates/app/src/modules/files',
    'packages/views/src/knowledge',
    'migrations',
    'docs/tutorials',
    'docs/getting-started',
    'apps/api/src',
  ])
    execFileSync('mkdir', ['-p', join(root, directory)]);
  write(
    'examples/knowledge-base/manifest.json',
    JSON.stringify(
      {
        id: 'knowledge-base',
        status: 'active',
        markerPrefix: 'knowledge',
        description: 'The removable reference domain.',
        ownedPaths: [
          'crates/app/src/modules/knowledge',
          'packages/views/src/knowledge',
          'migrations/0002_knowledge.sql',
          'docs/tutorials/04-example.md',
        ],
        compositionPoints: {
          api: 'apps/api/src/lib.rs',
          readme: 'README.md',
        },
        registrationMarkers: {
          'apps/api/src/lib.rs': ['routes'],
          'packages/views/src/index.ts': ['views'],
          'README.md': ['readme'],
          'docs/getting-started/quickstart.md': ['quickstart'],
          'docs/getting-started/quickstart.en.md': ['quickstart'],
        },
        ownedDependencies: {
          'packages/views/package.json': ['react-markdown'],
        },
        ownedCargoDependencies: {
          'Cargo.toml': ['pulldown-cmark'],
          'crates/app/Cargo.toml': ['pulldown-cmark'],
        },
      },
      null,
      2,
    ),
  );
  write(
    'crates/app/src/modules/knowledge/mod.rs',
    'pub fn example_only() {}\n',
  );
  write(
    'crates/app/src/modules/files/mod.rs',
    'pub fn core_file_service() {}\n',
  );
  write('packages/views/src/knowledge/index.ts', 'export const view = 1;\n');
  write(
    'packages/views/src/index.ts',
    'export * from "./shared";\n// example:knowledge:views:start\nexport * from "./knowledge";\n// example:knowledge:views:end\n',
  );
  write(
    'apps/api/src/lib.rs',
    [
      'pub fn router() -> Router {',
      '    let domain_routes = Router::new();',
      '    // example:knowledge:routes:start',
      '    let domain_routes = domain_routes.merge(example());',
      '    // example:knowledge:routes:end',
      '    domain_routes',
      '}',
      '',
    ].join('\n'),
  );
  write(
    'README.md',
    '# Template\n\n<!-- example:knowledge:readme:start -->\nExample pitch.\n<!-- example:knowledge:readme:end -->\n\nCore docs.\n',
  );
  write('migrations/0001_core.sql', 'CREATE TABLE saas_core.users;\n');
  write('migrations/0002_knowledge.sql', 'CREATE TABLE knowledge.documents;\n');
  write(
    'docs/site.json',
    JSON.stringify(
      {
        title: 'Docs',
        pages: [
          {
            id: 'quickstart',
            source: 'docs/getting-started/quickstart.md',
            sourceEn: 'docs/getting-started/quickstart.en.md',
            route: 'index.md',
            title: 'Quickstart',
            titleEn: 'Quick start',
            group: 'Start',
          },
          {
            id: 'example',
            source: 'docs/tutorials/04-example.md',
            route: 'tutorials/example.md',
            title: 'Example',
            group: 'Tutorial',
            translation: { status: 'pending', owner: 'UI14' },
          },
        ],
      },
      null,
      2,
    ),
  );
  write(
    'docs/getting-started/quickstart.md',
    '# 快速开始\n\nCore steps.\n\n<!-- example:knowledge:quickstart:start -->\n\n## 示例章节\n\n知识库内容。\n\n<!-- example:knowledge:quickstart:end -->\n\nClosing core steps.\n',
  );
  write(
    'docs/getting-started/quickstart.en.md',
    '# Quick start\n\nCore steps.\n\n<!-- example:knowledge:quickstart:start -->\n\n## Example section\n\nKnowledge content.\n\n<!-- example:knowledge:quickstart:end -->\n\nClosing core steps.\n',
  );
  write('docs/tutorials/04-example.md', '# Example\n');
  write(
    'package.json',
    JSON.stringify({ name: 'template', private: true }, null, 2),
  );
  write(
    'packages/views/package.json',
    JSON.stringify(
      {
        name: '@saas/views',
        dependencies: { react: '19.0.0', 'react-markdown': '10.0.0' },
      },
      null,
      2,
    ),
  );
  write(
    'Cargo.toml',
    '[workspace.dependencies]\nserde = "1"\npulldown-cmark = { version = "=0.13.4", default-features = false }\n',
  );
  write(
    'crates/app/Cargo.toml',
    '[dependencies]\nserde.workspace = true\npulldown-cmark.workspace = true\n',
  );
  execFileSync('git', ['init', '--quiet', '-b', 'main', root]);
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], {
      env: { ...process.env, ...gitIdentity },
    });
  git('add', '.');
  git('commit', '--quiet', '-m', 'template');
  return root;
}

function snapshot(root) {
  const paths = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--others', '--cached', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .sort();
  return paths
    .map(
      (path) =>
        `${path}:${execFileSync('git', ['-C', root, 'hash-object', path], { cwd: root, encoding: 'utf8' })}`,
    )
    .join('\n');
}

test('verifies the manifest against the working copy and names the drift', () => {
  const root = buildFixture();
  try {
    verifyExampleManifest(root);
    rmSync(join(root, 'docs/tutorials/04-example.md'));
    assert.throws(() => verifyExampleManifest(root), /04-example\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unregistered marker may be wholly absent, never half-present', () => {
  const root = buildFixture();
  try {
    // Declare the quickstart marker as shipping unregistered: scripts that
    // register the example install it, so its absence is the shipped state.
    const manifestPath = join(root, 'examples/knowledge-base/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.unregisteredMarkers = {
      'docs/getting-started/quickstart.md': ['quickstart'],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(join(root, 'docs/getting-started/quickstart.md'));
    verifyExampleManifest(root);
    // Half-present drift (start without end) is still refused.
    writeFileSync(
      join(root, 'docs/getting-started/quickstart.md'),
      'unregistered\n// example:knowledge:quickstart:start\n',
    );
    assert.throws(
      () => verifyExampleManifest(root),
      /quickstart is not a start\/end pair/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plans the removal without writing anything', () => {
  const root = buildFixture();
  try {
    const before = snapshot(root);
    const plan = planExampleRemoval(root, {});
    assert.deepEqual(plan.delete.sort(), [
      'crates/app/src/modules/knowledge',
      'docs/tutorials/04-example.md',
      'packages/views/src/knowledge',
    ]);
    assert.equal(plan.edits.length, 5);
    assert.deepEqual(plan.edits.map((edit) => edit.file).sort(), [
      'README.md',
      'apps/api/src/lib.rs',
      'docs/getting-started/quickstart.en.md',
      'docs/getting-started/quickstart.md',
      'packages/views/src/index.ts',
    ]);
    assert.deepEqual(plan.navigation.removeSources, [
      'docs/tutorials/04-example.md',
    ]);
    assert.equal(
      plan.migrations.trim.length,
      0,
      'migrations are kept by default',
    );
    const after = snapshot(root);
    assert.equal(after, before, 'planning must not modify the copy');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies the removal: owned paths, markers, navigation and dependencies', () => {
  const root = buildFixture();
  try {
    const { summary } = removeExample(root, {
      run: (command, args) => ({ command, args }),
    });
    assert(!existsSync(join(root, 'crates/app/src/modules/knowledge')));
    assert(!existsSync(join(root, 'packages/views/src/knowledge')));
    assert(!existsSync(join(root, 'docs/tutorials/04-example.md')));
    assert(
      existsSync(join(root, 'migrations/0002_knowledge.sql')),
      'history stays by default',
    );
    assert.equal(
      readFileSync(join(root, 'apps/api/src/lib.rs'), 'utf8'),
      [
        'pub fn router() -> Router {',
        '    let domain_routes = Router::new();',
        '    domain_routes',
        '}',
        '',
      ].join('\n'),
    );
    assert.equal(
      readFileSync(join(root, 'README.md'), 'utf8'),
      '# Template\n\nCore docs.\n',
    );
    const views = readFileSync(
      join(root, 'packages/views/src/index.ts'),
      'utf8',
    );
    assert(!views.includes('knowledge'), 'marker content is removed');
    assert(views.includes('export * from "./shared";'));
    const site = JSON.parse(readFileSync(join(root, 'docs/site.json'), 'utf8'));
    assert.deepEqual(
      site.pages.map((page) => page.source),
      ['docs/getting-started/quickstart.md'],
    );
    // The bilingual Core quick start survives with its example blocks
    // stripped from both locales; the knowledge chapter entry is gone.
    assert.equal(
      readFileSync(join(root, 'docs/getting-started/quickstart.md'), 'utf8'),
      '# 快速开始\n\nCore steps.\n\nClosing core steps.\n',
    );
    assert.equal(
      readFileSync(join(root, 'docs/getting-started/quickstart.en.md'), 'utf8'),
      '# Quick start\n\nCore steps.\n\nClosing core steps.\n',
    );
    assert(
      !site.pages.some((page) => page.source?.includes('quickstart.en')),
      'the English source shares the Chinese page entry instead of duplicating it',
    );
    const manifest = JSON.parse(
      readFileSync(join(root, 'examples/knowledge-base/manifest.json'), 'utf8'),
    );
    assert.equal(manifest.status, 'removed');
    assert.deepEqual(manifest.ownedPaths, []);
    assert.deepEqual(manifest.registrationMarkers, {});
    assert.deepEqual(
      manifest.retainedMigrations,
      ['migrations/0002_knowledge.sql'],
      'the kept-history path records which migrations stay',
    );
    const viewsPackage = JSON.parse(
      readFileSync(join(root, 'packages/views/package.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(viewsPackage.dependencies), ['react']);
    assert.equal(
      readFileSync(join(root, 'crates/app/Cargo.toml'), 'utf8'),
      '[dependencies]\nserde.workspace = true\n',
    );
    assert.equal(
      readFileSync(join(root, 'Cargo.toml'), 'utf8'),
      '[workspace.dependencies]\nserde = "1"\n',
    );
    const commands = summary.regenerated;
    assert.deepEqual(
      commands.map(([command]) => command),
      ['pnpm', 'cargo', 'pnpm', 'node'],
    );
    verifyExampleManifest(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trims example migrations only when the copy asks for a fresh database', () => {
  const root = buildFixture();
  try {
    removeExample(root, { trimMigrations: true, run: () => undefined });
    assert(!existsSync(join(root, 'migrations/0002_knowledge.sql')));
    assert(existsSync(join(root, 'migrations/0001_core.sql')));
    const manifest = JSON.parse(
      readFileSync(join(root, 'examples/knowledge-base/manifest.json'), 'utf8'),
    );
    assert.deepEqual(
      manifest.retainedMigrations,
      [],
      'the trimmed path retains nothing',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained history is only a removed-manifest concept', () => {
  assert.equal(retainedHistoryPaths({ status: 'active' }).size, 0);
  assert.deepEqual(
    [
      ...retainedHistoryPaths({
        status: 'removed',
        retainedMigrations: ['migrations/0003_knowledge.sql'],
      }),
    ],
    ['migrations/0003_knowledge.sql'],
  );
  assert.equal(retainedHistoryPaths({ status: 'removed' }).size, 0);
});

test('refuses a copy with uncommitted changes and modifies nothing', () => {
  const root = buildFixture();
  try {
    writeFileSync(
      join(root, 'crates/app/src/modules/knowledge/mod.rs'),
      'pub fn customized() {}\n',
    );
    const before = snapshot(root);
    const { problems } = checkRemovalSafety(root, planExampleRemoval(root, {}));
    assert(problems.some((problem) => /uncommitted/i.test(problem.detail)));
    assert.throws(
      () => removeExample(root, { run: () => undefined }),
      /uncommitted/i,
    );
    assert.equal(
      snapshot(root),
      before,
      'a refused removal must not touch the copy',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a copy whose registration markers were restructured', () => {
  const root = buildFixture();
  try {
    execFileSync('git', ['-C', root, 'rm', '--quiet', 'README.md']);
    writeFileSync(join(root, 'README.md'), '# Template without the marker\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    const { problems } = checkRemovalSafety(root, planExampleRemoval(root, {}));
    assert(problems.some((problem) => /marker/.test(problem.detail)));
    assert.throws(
      () => removeExample(root, { run: () => undefined }),
      /marker/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A miniature second example so the multi-example contract is observable:
// removing one example leaves the other's registration and owned files
// untouched, and the manifests stay independently verifiable.
function addNotesExample(root) {
  const write = (path, content) => {
    writeFileSync(join(root, path), content);
    return join(root, path);
  };
  execFileSync('mkdir', [
    '-p',
    join(root, 'examples/notes'),
    join(root, 'packages/views/src/notes'),
  ]);
  write(
    'examples/notes/manifest.json',
    JSON.stringify(
      {
        id: 'notes',
        status: 'active',
        markerPrefix: 'notes',
        description: 'The composition proving example.',
        ownedPaths: ['packages/views/src/notes'],
        compositionPoints: { views: 'packages/views/src/index.ts' },
        registrationMarkers: {
          'packages/views/src/index.ts': ['views'],
        },
      },
      null,
      2,
    ),
  );
  write('packages/views/src/notes/index.ts', 'export const note = 1;\n');
  write(
    'packages/views/src/index.ts',
    [
      'export * from "./shared";',
      '// example:knowledge:views:start',
      'export * from "./knowledge";',
      '// example:knowledge:views:end',
      '// example:notes:views:start',
      'export * from "./notes";',
      '// example:notes:views:end',
    ].join('\n'),
  );
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync(
    'git',
    ['-C', root, 'commit', '--quiet', '-m', 'notes example'],
    {
      env: { ...process.env, ...gitIdentity },
    },
  );
}

test('removing one example leaves the other registered and untouched', () => {
  const root = buildFixture();
  try {
    addNotesExample(root);
    verifyExampleManifests(root);
    removeExample(root, { exampleId: 'notes', run: () => undefined });
    // The knowledge example keeps everything...
    assert(existsSync(join(root, 'packages/views/src/knowledge/index.ts')));
    assert.equal(loadExampleManifest(root, 'knowledge-base').status, 'active');
    verifyExampleManifest(root, 'knowledge-base');
    // ...its views marker block survives the notes removal...
    const views = readFileSync(
      join(root, 'packages/views/src/index.ts'),
      'utf8',
    );
    assert(views.includes('example:knowledge:views:start'));
    assert(views.includes('export * from "./knowledge";'));
    // ...and the notes example is gone with an emptied manifest.
    assert(!existsSync(join(root, 'packages/views/src/notes')));
    const notes = loadExampleManifest(root, 'notes');
    assert.equal(notes.status, 'removed');
    assert.deepEqual(notes.ownedPaths, []);
    assert.deepEqual(
      [...retainedHistoryPaths(notes)],
      [],
      'notes owns no migrations',
    );
    verifyExampleManifest(root, 'notes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planning targets the requested example only', () => {
  const root = buildFixture();
  try {
    addNotesExample(root);
    const notesPlan = planExampleRemoval(root, { exampleId: 'notes' });
    assert.deepEqual(notesPlan.delete, ['packages/views/src/notes']);
    assert.deepEqual(
      notesPlan.edits.map((edit) => edit.file),
      ['packages/views/src/index.ts'],
    );
    assert.equal(notesPlan.edits[0].prefix, 'notes');
    assert.equal(
      notesPlan.manifest.file,
      join('examples', 'notes', 'manifest.json'),
    );
    const knowledgePlan = planExampleRemoval(root, {
      exampleId: 'knowledge-base',
    });
    assert.deepEqual(
      knowledgePlan.delete.sort(),
      [
        'crates/app/src/modules/knowledge',
        'docs/tutorials/04-example.md',
        'packages/views/src/knowledge',
      ],
      'the knowledge plan is unchanged by a second example',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown example id fails, naming the registered ids', () => {
  const root = buildFixture();
  try {
    assert.throws(
      () => loadExampleManifest(root, 'no-such-example'),
      /unknown example id: no-such-example \(registered: knowledge-base\)/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('overlapping owned paths fail verification', () => {
  const root = buildFixture();
  try {
    addNotesExample(root);
    writeFileSync(
      join(root, 'examples', 'notes', 'manifest.json'),
      JSON.stringify(
        {
          id: 'notes',
          status: 'active',
          markerPrefix: 'notes',
          description: 'The composition proving example.',
          ownedPaths: [
            'packages/views/src/notes',
            'packages/views/src/knowledge',
          ],
          compositionPoints: { views: 'packages/views/src/index.ts' },
          registrationMarkers: {
            'packages/views/src/index.ts': ['views'],
          },
        },
        null,
        2,
      ),
    );
    assert.throws(
      () => verifyExampleManifests(root),
      /knowledge-base and notes both own packages\/views\/src\/knowledge/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('overlapping owned dependencies fail verification', () => {
  const root = buildFixture();
  try {
    addNotesExample(root);
    const claimSharedDependency = (id) => {
      const path = join(root, 'examples', id, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      manifest.ownedDependencies = {
        'packages/views/package.json': ['react-markdown'],
      };
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    };
    claimSharedDependency('knowledge-base');
    claimSharedDependency('notes');
    assert.throws(
      () => verifyExampleManifests(root),
      /knowledge-base and notes both own react-markdown in packages\/views\/package\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the removal command refuses a copy whose manifests conflict', () => {
  const root = buildFixture();
  try {
    addNotesExample(root);
    const claimSharedDependency = (id) => {
      const path = join(root, 'examples', id, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      manifest.ownedDependencies = {
        'packages/views/package.json': ['react-markdown'],
      };
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    };
    claimSharedDependency('knowledge-base');
    claimSharedDependency('notes');
    assert.throws(
      () => removeExample(root, { exampleId: 'notes', run: () => undefined }),
      /ownership manifests/,
    );
    // The refusal precedes any deletion: the contested copy is untouched.
    assert(existsSync(join(root, 'packages/views/src/notes')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
