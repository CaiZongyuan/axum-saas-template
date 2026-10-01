import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setupCourse } from '../../scripts/tutorial-course.mjs';

const cli = fileURLToPath(
  new URL('../../scripts/tutorial-course.mjs', import.meta.url),
);
const identity = {
  GIT_AUTHOR_NAME: 'course test',
  GIT_AUTHOR_EMAIL: 'course@example.test',
  GIT_COMMITTER_NAME: 'course test',
  GIT_COMMITTER_EMAIL: 'course@example.test',
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tutorial-course-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceRoot = join(directory, 'source');
  const targetRoot = join(directory, 'course');
  mkdirSync(sourceRoot);
  const write = (file, content) => {
    mkdirSync(dirname(join(sourceRoot, file)), { recursive: true });
    writeFileSync(join(sourceRoot, file), content);
  };
  write('.gitignore', '.env\n.secrets/\n.scratch/\n');
  write(
    '.env.example',
    'POSTGRES_PASSWORD=default-password\nS3_SECRET_KEY=default-storage\n',
  );
  write('crates/app/src/modules/mod.rs', 'pub mod identity;\n');
  write(
    'apps/api/src/lib.rs',
    [
      'pub fn router_with_cache(pool: PgPool, auth: AuthSettings, _files: Option<FileService>) -> Router {',
      '    let domain_routes = Router::new();',
      '    existing(_files);',
      '    saas_app::compose_routes_with_options(',
      '        pool, auth, domain_routes, openapi(), Default::default())',
      '}',
      'pub fn configured_router(pool: PgPool, auth: AuthSettings, _files: Option<FileService>) -> Result<Router, Error> {',
      '    let routes = Router::new();',
      '    Ok(saas_app::compose_routes_with_options(',
      '        pool, auth, routes, openapi(), Default::default()))',
      '}',
      'pub fn openapi() -> OpenApi {',
      '    let document = saas_app::openapi();',
      '    saas_app::modules::rate_limit::describe(document)',
      '}',
      '',
    ].join('\n'),
  );
  write(
    'apps/worker/src/main.rs',
    [
      'fn main() {',
      '    let maintenance = Vec::new();',
      '    if let Some(files) = _files {',
      '        existing(files, settings.auth);',
      '    }',
      '    let worker = Arc::new(Worker::new(pool.clone(), handlers, policy));',
      '}',
      '',
    ].join('\n'),
  );
  write(
    'crates/app/tests/tutorial_course.rs',
    '// region:crud-test\n#[test] fn existing_course() {}\n// endregion:crud-test\n',
  );
  write('migrations/0001_core.sql', 'CREATE SCHEMA saas_core;\n');
  write(
    'examples/tutorial-tickets/preview.rs',
    'pub fn router() {}\npub fn openapi() {}\n',
  );
  for (const stage of ['crud', 'files']) {
    const base = 'examples/tutorial-tickets/checkpoints/' + stage + '/';
    write(base + 'mod.rs', '// ' + stage + '\npub fn router() {}\n');
    write(base + 'application.rs', '// ' + stage + ' application\n');
    write(base + 'domain.rs', '// domain\n');
    if (stage === 'files') write(base + 'attachments.rs', '// files\n');
  }
  for (const name of ['mod', 'application', 'domain', 'attachments', 'exports'])
    write(
      'examples/tutorial-tickets/' + name + '.rs',
      '// jobs ' + name + '\n',
    );
  write(
    'examples/tutorial-tickets/migrations/0001_tickets.sql',
    'CREATE TABLE support.tickets (id text);\n',
  );
  write(
    'examples/tutorial-tickets/migrations/0002_attachments.sql',
    'CREATE TABLE support.uploads (id text);\n',
  );
  write(
    'examples/tutorial-tickets/migrations/0003_exports.sql',
    'CREATE TABLE support.exports (id text);\n',
  );
  write('current.rs', '// committed\n');
  write('removed.rs', '// removed from the working tree\n');
  execFileSync('git', ['init', '--quiet', '-b', 'main', sourceRoot]);
  execFileSync('git', ['-C', sourceRoot, 'add', '.']);
  execFileSync(
    'git',
    ['-C', sourceRoot, 'commit', '--quiet', '-m', 'template'],
    {
      env: { ...process.env, ...identity },
    },
  );
  write('current.rs', '// working source\n');
  write('added.rs', '// new source\n');
  write('.env', 'DATABASE_URL=operator-secret\n');
  write('.secrets/private', 'operator-secret\n');
  rmSync(join(sourceRoot, 'removed.rs'));
  return { sourceRoot, targetRoot, write };
}

test('installs the current module source in an isolated copy without operator configuration', async (t) => {
  const options = fixture(t);
  const result = await setupCourse({ ...options, stage: 'module' });
  assert.equal(
    readFileSync(join(result.root, 'current.rs'), 'utf8'),
    '// working source\n',
  );
  assert.equal(
    readFileSync(join(result.root, 'added.rs'), 'utf8'),
    '// new source\n',
  );
  assert.equal(existsSync(join(result.root, 'removed.rs')), false);
  assert.equal(existsSync(join(result.root, '.secrets/private')), false);
  const environment = parseEnv(readFileSync(join(result.root, '.env'), 'utf8'));
  assert.notEqual(environment.POSTGRES_PASSWORD, 'default-password');
  assert.match(environment.COMPOSE_PROJECT_NAME, /^dougong-course-/);
  assert.ok(!environment.DATABASE_URL.includes('operator-secret'));
  assert.notEqual(environment.S3_SECRET_KEY, 'default-storage');
  const ports = [
    'POSTGRES_PORT',
    'REDIS_PORT',
    'RUSTFS_PORT',
    'WEB_PORT',
    'MAILPIT_SMTP_PORT',
    'MAILPIT_HTTP_PORT',
  ].map((key) => environment[key]);
  ports.push(
    environment.APP_BIND.split(':')[1],
    environment.WORKER_BIND.split(':')[1],
  );
  assert.equal(new Set(ports).size, ports.length);
  assert.deepEqual(result.migrations, []);
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(result.root, 'crates/app/src/modules/tickets/module.json'),
        'utf8',
      ),
    ).tables,
    [],
  );
  const api = readFileSync(join(result.root, 'apps/api/src/lib.rs'), 'utf8');
  assert.equal((api.match(/tickets::router\(\)/g) ?? []).length, 2);
  assert.match(
    api,
    /document.merge\(saas_app::modules::tickets::openapi\(\)\)/,
  );
  assert.ok(
    readFileSync(
      join(result.root, 'crates/app/tests/tutorial_course.rs'),
      'utf8',
    ).includes('#![cfg(any())]'),
  );
  assert.equal(
    readFileSync(
      join(options.sourceRoot, 'crates/app/src/modules/mod.rs'),
      'utf8',
    ),
    'pub mod identity;\n',
  );
});

test('advances all checkpoints without changing addresses, secrets or applied migration identities', async (t) => {
  const options = fixture(t);
  const initial = await setupCourse({ ...options, stage: 'module' });
  const environment = readFileSync(join(initial.root, '.env'), 'utf8');
  const addresses = readFileSync(join(initial.root, '.course.env'), 'utf8');
  const crud = await setupCourse({ ...options, stage: 'crud' });
  assert.equal(crud.migrations.length, 1);
  const firstMigration = readFileSync(
    join(crud.root, crud.migrations[0]),
    'utf8',
  );
  assert.equal(
    existsSync(
      join(crud.root, 'crates/app/src/modules/tickets/attachments.rs'),
    ),
    false,
  );
  const files = await setupCourse({ ...options, stage: 'files' });
  assert.equal(files.migrations.length, 2);
  assert.equal(
    existsSync(join(files.root, 'crates/app/src/modules/tickets/exports.rs')),
    false,
  );
  assert.ok(
    !readFileSync(join(files.root, 'apps/worker/src/main.rs'), 'utf8').includes(
      'tickets::',
    ),
  );
  const jobs = await setupCourse({ ...options, stage: 'jobs' });
  assert.equal(jobs.migrations.length, 3);
  assert.equal(
    readFileSync(join(jobs.root, jobs.migrations[0]), 'utf8'),
    firstMigration,
  );
  assert.equal(readFileSync(join(jobs.root, '.env'), 'utf8'), environment);
  assert.equal(readFileSync(join(jobs.root, '.course.env'), 'utf8'), addresses);
  assert.deepEqual(jobs.config, initial.config);
  const worker = readFileSync(
    join(jobs.root, 'apps/worker/src/main.rs'),
    'utf8',
  );
  assert.match(worker, /tickets::export_handler/);
  assert.match(worker, /tickets::export_maintenance/);
  const same = await setupCourse({ ...options, stage: 'jobs' });
  assert.deepEqual(same.migrations, jobs.migrations);
  assert.equal(
    (
      readFileSync(
        join(same.root, 'crates/app/src/modules/mod.rs'),
        'utf8',
      ).match(/pub mod tickets;/g) ?? []
    ).length,
    1,
  );
  await assert.rejects(setupCourse({ ...options, stage: 'crud' }), /downgrade/);
});

test('refuses modified course code before writing another file', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'module' });
  const api = readFileSync(join(installed.root, 'apps/api/src/lib.rs'), 'utf8');
  const module = join(installed.root, 'crates/app/src/modules/tickets/mod.rs');
  writeFileSync(module, '// my business changes\n');
  await assert.rejects(
    setupCourse({ ...options, stage: 'crud' }),
    /modified.*mod\.rs|mod\.rs.*modified/,
  );
  assert.equal(readFileSync(module, 'utf8'), '// my business changes\n');
  assert.equal(
    readFileSync(join(installed.root, 'apps/api/src/lib.rs'), 'utf8'),
    api,
  );
  assert.equal(
    existsSync(join(installed.root, 'migrations/0002_tutorial_tickets.sql')),
    false,
  );
});

test('preserves unrelated files but refuses a new-stage filename collision', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'crud' });
  writeFileSync(join(installed.root, 'my-notes.txt'), 'keep my notes\n');
  await setupCourse({ ...options, stage: 'crud' });
  assert.equal(
    readFileSync(join(installed.root, 'my-notes.txt'), 'utf8'),
    'keep my notes\n',
  );
  const attachment = join(
    installed.root,
    'crates/app/src/modules/tickets/attachments.rs',
  );
  writeFileSync(attachment, '// my attachment implementation\n');
  await assert.rejects(
    setupCourse({ ...options, stage: 'files' }),
    /attachments\.rs/,
  );
  assert.equal(
    readFileSync(attachment, 'utf8'),
    '// my attachment implementation\n',
  );
});

test('does not rewrite migration history when teaching SQL changes', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'crud' });
  const original = readFileSync(
    join(installed.root, installed.migrations[0]),
    'utf8',
  );
  options.write(
    'examples/tutorial-tickets/migrations/0001_tickets.sql',
    original + '-- a new change\n',
  );
  await assert.rejects(
    setupCourse({ ...options, stage: 'files' }),
    /migration.*changed/i,
  );
  assert.equal(
    readFileSync(join(installed.root, installed.migrations[0]), 'utf8'),
    original,
  );
});

test('refuses arbitrary existing directories and the original source repository', async (t) => {
  const options = fixture(t);
  mkdirSync(options.targetRoot);
  writeFileSync(join(options.targetRoot, 'keep.txt'), 'my file\n');
  await assert.rejects(
    setupCourse({ ...options, stage: 'module' }),
    /existing|course copy/,
  );
  assert.equal(
    readFileSync(join(options.targetRoot, 'keep.txt'), 'utf8'),
    'my file\n',
  );
  await assert.rejects(
    setupCourse({
      sourceRoot: options.sourceRoot,
      targetRoot: options.sourceRoot,
      stage: 'module',
    }),
    /source|original/,
  );
  await assert.rejects(setupCourse({ ...options, stage: 'unknown' }), /stage/);
});

test('copies directory symlinks literally even when HEAD had a directory at the same path', async (t) => {
  const options = fixture(t);
  options.write('skills/source/SKILL.md', 'current skill\n');
  options.write('skills/link/old.md', 'old directory\n');
  execFileSync('git', ['-C', options.sourceRoot, 'add', 'skills']);
  execFileSync(
    'git',
    ['-C', options.sourceRoot, 'commit', '--quiet', '-m', 'skill directories'],
    {
      env: { ...process.env, ...identity },
    },
  );
  rmSync(join(options.sourceRoot, 'skills/link'), { recursive: true });
  symlinkSync('source', join(options.sourceRoot, 'skills/link'));
  symlinkSync('missing', join(options.sourceRoot, 'skills/missing-link'));
  execFileSync('git', ['-C', options.sourceRoot, 'add', '-A', 'skills']);
  const installed = await setupCourse({ ...options, stage: 'module' });
  assert.equal(readlinkSync(join(installed.root, 'skills/link')), 'source');
  assert.equal(
    readFileSync(join(installed.root, 'skills/link/SKILL.md'), 'utf8'),
    'current skill\n',
  );
  assert.equal(
    readlinkSync(join(installed.root, 'skills/missing-link')),
    'missing',
  );
  assert.equal(readlinkSync(join(options.sourceRoot, 'skills/link')), 'source');
  assert.equal(
    readFileSync(join(options.sourceRoot, 'skills/source/SKILL.md'), 'utf8'),
    'current skill\n',
  );
});

test('refuses edited installed migration history before an upgrade', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'crud' });
  const migration = join(installed.root, installed.migrations[0]);
  writeFileSync(migration, '-- my migration edit\n');
  await assert.rejects(
    setupCourse({ ...options, stage: 'files' }),
    /modified course file.*migrations/,
  );
  assert.equal(readFileSync(migration, 'utf8'), '-- my migration edit\n');
});

test('installed Rust passes formatting and ordinary formatting does not block stage upgrades', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'module' });
  const files = [
    'apps/api/src/lib.rs',
    'crates/app/src/modules/mod.rs',
    'crates/app/src/modules/tickets/mod.rs',
    'crates/app/tests/tutorial_course.rs',
  ];
  for (const file of files)
    execFileSync(
      'rustfmt',
      [
        '--check',
        '--edition',
        '2024',
        '--config',
        'skip_children=true',
        join(installed.root, file),
      ],
      { stdio: 'pipe' },
    );
  await setupCourse({ ...options, stage: 'crud' });
});

test('a dangling new-stage link cannot create a file outside the course copy', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'crud' });
  const external = join(dirname(installed.root), 'external-attachment.rs');
  const attachment = join(
    installed.root,
    'crates/app/src/modules/tickets/attachments.rs',
  );
  symlinkSync(external, attachment);
  const api = readFileSync(join(installed.root, 'apps/api/src/lib.rs'), 'utf8');
  await assert.rejects(
    setupCourse({ ...options, stage: 'files' }),
    /symlink.*attachments\.rs/,
  );
  assert.equal(existsSync(external), false);
  assert.equal(readlinkSync(attachment), external);
  assert.equal(
    readFileSync(join(installed.root, 'apps/api/src/lib.rs'), 'utf8'),
    api,
  );
});

test('print-config returns only the public course addresses', async (t) => {
  const options = fixture(t);
  const installed = await setupCourse({ ...options, stage: 'module' });
  const output = execFileSync(
    'node',
    [cli, '--root', installed.root, '--print-config'],
    { encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(output), installed.config);
  assert.deepEqual(Object.keys(JSON.parse(output)).sort(), [
    'BASE_URL',
    'ORIGIN',
    'WORKER_URL',
  ]);
  assert.ok(!output.includes('DATABASE_URL'));
  assert.ok(!output.includes('S3_SECRET_KEY'));
});
