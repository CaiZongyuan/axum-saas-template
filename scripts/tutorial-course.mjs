import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { freePort, root } from './lib/process.mjs';

const stages = ['module', 'crud', 'files', 'jobs'];
const receiptPath = '.scratch/tutorial-course/state.json';
const modulePath = 'crates/app/src/modules/tickets';
const declarationPath = 'crates/app/src/modules/mod.rs';
const apiPath = 'apps/api/src/lib.rs';
const workerPath = 'apps/worker/src/main.rs';
const fixtureTestPath = 'crates/app/tests/tutorial_course.rs';
const migrationSources = [
  ['tickets', '0001_tickets.sql', 'support.tickets'],
  ['attachments', '0002_attachments.sql', 'support.uploads'],
  ['exports', '0003_exports.sql', 'support.exports'],
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitFiles = (directory) =>
  new Set(
    execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: directory, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean),
  );

function managedPath(directory, file) {
  const path = resolve(directory, file);
  if (!path.startsWith(directory + sep))
    throw new Error('Invalid course-managed path: ' + file);
  for (let current = path; current !== directory; current = dirname(current))
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error('Refusing a symlink in course-managed path: ' + file);
  return path;
}

function hashFile(directory, file) {
  const path = managedPath(directory, file);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile())
    throw new Error('Course-managed path is not a file: ' + file);
  return digest(readFileSync(path));
}

function readReceipt(directory) {
  try {
    const receipt = JSON.parse(
      readFileSync(join(directory, receiptPath), 'utf8'),
    );
    if (
      receipt.version !== 1 ||
      !stages.includes(receipt.stage) ||
      typeof receipt.files !== 'object' ||
      !receipt.files ||
      typeof receipt.migrations !== 'object' ||
      !receipt.migrations
    )
      throw new Error();
    return receipt;
  } catch {
    throw new Error('Existing target is not a valid course copy: ' + directory);
  }
}

function stripBlock(source, marker) {
  const start = '// tutorial:tickets:' + marker + ':start';
  const end = '// tutorial:tickets:' + marker + ':end';
  const lines = source.split('\n');
  const starts = lines.flatMap((line, index) =>
    line.trim() === start ? [index] : [],
  );
  const ends = lines.flatMap((line, index) =>
    line.trim() === end ? [index] : [],
  );
  if (starts.length === 0 && ends.length === 0) return source;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0])
    throw new Error('Course assembly block changed: ' + marker);
  lines.splice(starts[0], ends[0] - starts[0] + 1);
  return lines.join('\n');
}

function block(marker, source, indent = '    ') {
  return [
    indent + '// tutorial:tickets:' + marker + ':start',
    ...source.map((line) => indent + line),
    indent + '// tutorial:tickets:' + marker + ':end',
    '',
  ].join('\n');
}

function before(source, anchor, addition) {
  if (
    !source.includes(anchor) ||
    source.indexOf(anchor) !== source.lastIndexOf(anchor)
  )
    throw new Error('Tutorial composition point changed: ' + anchor.trim());
  return source.replace(anchor, addition + anchor);
}

function composition(directory, stage) {
  const files = new Map();
  let declaration = stripBlock(
    readFileSync(join(directory, declarationPath), 'utf8'),
    'module',
  );
  if (/\bpub\s+mod\s+tickets\s*;/.test(declaration))
    throw new Error(
      'The template already has a tickets module outside the course',
    );
  declaration =
    declaration.trimEnd() + '\n' + block('module', ['pub mod tickets;'], '');
  files.set(declarationPath, declaration);

  let api = readFileSync(join(directory, apiPath), 'utf8');
  for (const marker of [
    'routes',
    'configured-routes',
    'openapi',
    'files',
    'configured-files',
  ])
    api = stripBlock(api, marker);
  const router =
    stage === 'module'
      ? 'saas_app::modules::tickets::router()'
      : 'saas_app::modules::tickets::router(pool.clone(), auth.clone(), tutorial_files)';
  if (stage !== 'module') {
    api = before(
      api,
      '    let domain_routes = Router::new();',
      block('files', ['let tutorial_files = _files.clone();']),
    );
    api = before(
      api,
      '    let routes = Router::new();',
      block('configured-files', ['let tutorial_files = _files.clone();']),
    );
  }
  api = before(
    api,
    '    saas_app::compose_routes_with_options(',
    block('routes', [
      'let domain_routes = domain_routes.merge(' + router + ');',
    ]),
  );
  api = before(
    api,
    '    Ok(saas_app::compose_routes_with_options(',
    block('configured-routes', ['let routes = routes.merge(' + router + ');']),
  );
  api = before(
    api,
    '    saas_app::modules::rate_limit::describe(document)',
    block('openapi', [
      'let mut document = document;',
      'document.merge(saas_app::modules::tickets::openapi());',
    ]),
  );
  files.set(apiPath, api);

  if (stage === 'jobs') {
    let worker = stripBlock(
      readFileSync(join(directory, workerPath), 'utf8'),
      'worker',
    );
    worker = worker.replaceAll(
      '    if let Some(files) = _files {',
      '    if let Some(files) = _files.clone() {',
    );
    worker = worker.replaceAll(
      '            settings.auth,',
      '            settings.auth.clone(),',
    );
    worker = before(
      worker,
      '    let worker = Arc::new(Worker::new(pool.clone(), handlers, policy));',
      block('worker', [
        'let mut maintenance = maintenance;',
        'maintenance.push(saas_app::modules::tickets::export_maintenance(pool.clone()));',
        'if let Some(files) = _files {',
        '    handlers.push(saas_app::modules::tickets::export_handler(',
        '        pool.clone(), files, settings.auth,',
        '    ));',
        '}',
      ]),
    );
    files.set(workerPath, worker);
  }
  return files;
}

function checkpoint(sourceRoot, stage) {
  const files = new Map();
  if (stage === 'module') {
    files.set(
      modulePath + '/mod.rs',
      readFileSync(join(sourceRoot, 'examples/tutorial-tickets/preview.rs')),
    );
  } else {
    const source =
      stage === 'jobs'
        ? 'examples/tutorial-tickets'
        : 'examples/tutorial-tickets/checkpoints/' + stage;
    const names = ['mod', 'application', 'domain'];
    if (stage === 'files' || stage === 'jobs') names.push('attachments');
    if (stage === 'jobs') names.push('exports');
    for (const name of names)
      files.set(
        modulePath + '/' + name + '.rs',
        readFileSync(join(sourceRoot, source, name + '.rs')),
      );
  }
  const tables = migrationSources
    .slice(0, stages.indexOf(stage))
    .map((entry) => entry[2]);
  files.set(
    modulePath + '/module.json',
    JSON.stringify({ kind: 'business', tables }, null, 2) + '\n',
  );
  return files;
}

function copyCurrentSource(sourceRoot, targetRoot) {
  const candidates = [...gitFiles(sourceRoot)]
    .map((file) => {
      file = file.replace(/\/$/, '');
      return {
        file,
        stat: lstatSync(join(sourceRoot, file), { throwIfNoEntry: false }),
      };
    })
    .filter(({ stat }) => stat?.isFile() || stat?.isSymbolicLink());
  const links = candidates
    .filter(({ stat }) => stat.isSymbolicLink())
    .map(({ file }) => file);
  const files = candidates.filter(
    ({ file }) => !links.some((link) => file.startsWith(link + '/')),
  );
  execFileSync(
    'git',
    ['clone', '--quiet', '--no-hardlinks', sourceRoot, targetRoot],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  // This is a newly-created clone: remove its worktree so changed directory links
  // cannot make an overlay write through to another directory.
  for (const file of readdirSync(targetRoot))
    if (file !== '.git')
      rmSync(join(targetRoot, file), { recursive: true, force: true });
  for (const { file, stat } of files) {
    const source = join(sourceRoot, file);
    const target = join(targetRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), target);
    else cpSync(source, target);
  }
  const exclude = join(targetRoot, '.git/info/exclude');
  writeFileSync(exclude, readFileSync(exclude, 'utf8') + '\n.course.env\n');
}

async function configuration(sourceRoot) {
  const used = new Set();
  const port = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const value = await freePort();
      if (!used.has(value)) {
        used.add(value);
        return String(value);
      }
    }
    throw new Error('Unable to allocate distinct course ports');
  };
  const project = 'dougong-course-' + randomUUID().slice(0, 12);
  const api = await port(),
    worker = await port(),
    web = await port();
  const postgres = await port(),
    redis = await port(),
    storage = await port();
  const smtp = await port(),
    mail = await port();
  const password = randomBytes(16).toString('hex');
  const origin = 'http://127.0.0.1:' + web;
  const base = 'http://127.0.0.1:' + api;
  const environment = {
    ...parseEnv(readFileSync(join(sourceRoot, '.env.example'), 'utf8')),
    COMPOSE_PROJECT_NAME: project,
    POSTGRES_PASSWORD: password,
    POSTGRES_PORT: postgres,
    DATABASE_URL:
      'postgres://saas:' + password + '@127.0.0.1:' + postgres + '/saas',
    REDIS_PORT: redis,
    REDIS_URL: 'redis://127.0.0.1:' + redis + '/',
    CACHE_PREFIX: project,
    RATE_LIMIT_PREFIX: project,
    RUSTFS_PORT: storage,
    S3_ENDPOINT: 'http://127.0.0.1:' + storage,
    S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:' + storage,
    S3_BUCKET: project,
    S3_ACCESS_KEY: 'course-' + randomBytes(8).toString('hex'),
    S3_SECRET_KEY: randomBytes(24).toString('hex'),
    APP_BIND: '127.0.0.1:' + api,
    APP_ORIGIN: origin,
    VITE_API_PROXY: base,
    WEB_PORT: web,
    WORKER_BIND: '127.0.0.1:' + worker,
    MAIL_SMTP_HOST: '127.0.0.1',
    MAIL_SMTP_PORT: smtp,
    MAILPIT_SMTP_PORT: smtp,
    MAILPIT_HTTP_PORT: mail,
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    SAAS_DESKTOP_ORIGIN: origin,
    TELEMETRY_ENDPOINT: '',
  };
  const config = {
    BASE_URL: base,
    ORIGIN: origin,
    WORKER_URL: 'http://127.0.0.1:' + worker,
  };
  return {
    private:
      Object.entries(environment)
        .map(([key, value]) => key + '=' + JSON.stringify(value))
        .join('\n') + '\n',
    public:
      Object.entries(config)
        .map(([key, value]) => 'export ' + key + '=' + JSON.stringify(value))
        .join('\n') + '\n',
  };
}

export function courseConfig(targetRoot) {
  const parsed = parseEnv(
    readFileSync(join(targetRoot, '.course.env'), 'utf8'),
  );
  const config = {};
  for (const key of ['BASE_URL', 'ORIGIN', 'WORKER_URL']) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(parsed[key] ?? ''))
      throw new Error('Invalid public course address: ' + key);
    config[key] = parsed[key];
  }
  return config;
}

export async function setupCourse({ sourceRoot = root, targetRoot, stage }) {
  if (!stages.includes(stage))
    throw new Error('Use --stage module|crud|files|jobs');
  if (!targetRoot)
    throw new Error('Provide --root for the isolated course copy');
  sourceRoot = realpathSync(sourceRoot);
  targetRoot = isAbsolute(targetRoot)
    ? resolve(targetRoot)
    : resolve(sourceRoot, targetRoot);
  let ancestor = targetRoot;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  targetRoot = resolve(realpathSync(ancestor), relative(ancestor, targetRoot));
  if (
    targetRoot === sourceRoot ||
    sourceRoot.startsWith(targetRoot + sep) ||
    targetRoot === join(sourceRoot, '.git') ||
    targetRoot.startsWith(join(sourceRoot, '.git') + sep)
  )
    throw new Error(
      'Course target must be independent of the original source repository',
    );

  const upgrading = existsSync(targetRoot);
  let receipt;
  if (upgrading) {
    receipt = readReceipt(targetRoot);
    if (receipt.sourceRoot !== sourceRoot)
      throw new Error('Course copy belongs to a different source repository');
    if (stages.indexOf(stage) < stages.indexOf(receipt.stage))
      throw new Error(
        'Cannot downgrade a course copy with installed migration history',
      );
  }
  const plan = checkpoint(sourceRoot, stage);
  const assembled = composition(upgrading ? targetRoot : sourceRoot, stage);
  for (const [file, content] of assembled) plan.set(file, content);
  const migrations = { ...(receipt?.migrations ?? {}) };
  const directory = join(upgrading ? targetRoot : sourceRoot, 'migrations');
  let next =
    Math.max(
      0,
      ...readdirSync(directory).map((name) =>
        Number(/^(\d+)_.*\.sql$/.exec(name)?.[1] ?? 0),
      ),
    ) + 1;
  for (const [name, file] of migrationSources.slice(0, stages.indexOf(stage))) {
    const content = readFileSync(
      join(sourceRoot, 'examples/tutorial-tickets/migrations', file),
    );
    if (migrations[name]) {
      if (digest(content) !== receipt.files[migrations[name]])
        throw new Error('Course migration changed after installation: ' + file);
    } else {
      const installed =
        'migrations/' +
        String(next++).padStart(4, '0') +
        '_tutorial_' +
        name +
        '.sql';
      migrations[name] = installed;
      plan.set(installed, content);
    }
  }
  const fixture = join(upgrading ? targetRoot : sourceRoot, fixtureTestPath);
  if (existsSync(fixture)) {
    const source = readFileSync(fixture, 'utf8');
    if (!source.includes('#![cfg(any())]'))
      plan.set(fixtureTestPath, '#![cfg(any())]\n\n' + source);
  }

  for (const [file, content] of plan)
    if (file.endsWith('.rs'))
      plan.set(
        file,
        execFileSync(
          'rustfmt',
          [
            '--edition',
            '2024',
            '--config',
            'skip_children=true',
            '--emit',
            'stdout',
          ],
          { input: content, encoding: 'utf8' },
        ),
      );

  if (upgrading) {
    const protectedFiles = new Set([
      ...plan.keys(),
      ...Object.values(migrations),
      '.env',
      '.course.env',
    ]);
    for (const file of protectedFiles) {
      const current = hashFile(targetRoot, file);
      const expected = receipt.files[file] ?? null;
      if (current !== expected)
        throw new Error(
          'Refusing modified course file: ' +
            file +
            '; preserve your changes or use a new copy',
        );
    }
  } else {
    const config = await configuration(sourceRoot);
    plan.set('.env', config.private);
    plan.set('.course.env', config.public);
    try {
      copyCurrentSource(sourceRoot, targetRoot);
    } catch (error) {
      rmSync(targetRoot, { recursive: true, force: true });
      throw error;
    }
  }
  const hashes = { ...(receipt?.files ?? {}) };
  for (const [file, content] of plan) {
    const path = managedPath(targetRoot, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, file === '.env' ? { mode: 0o600 } : undefined);
    hashes[file] = digest(content);
  }
  // Keep future assembly changes protected even before the jobs checkpoint touches Worker.
  for (const file of [workerPath, fixtureTestPath])
    if (!(file in hashes) && existsSync(join(targetRoot, file)))
      hashes[file] = hashFile(targetRoot, file);
  const state = managedPath(targetRoot, receiptPath);
  mkdirSync(dirname(state), { recursive: true });
  writeFileSync(
    state,
    JSON.stringify(
      {
        version: 1,
        sourceRoot,
        stage,
        migrations,
        files: hashes,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    root: targetRoot,
    stage,
    config: courseConfig(targetRoot),
    migrations: Object.values(migrations),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        stage: { type: 'string' },
        root: { type: 'string' },
        'print-config': { type: 'boolean', default: false },
      },
    });
    if (!values.root || (!values.stage && !values['print-config']))
      throw new Error(
        'Usage: node scripts/tutorial-course.mjs --stage module|crud|files|jobs --root <copy> [--print-config]',
      );
    const targetRoot = isAbsolute(values.root)
      ? resolve(values.root)
      : resolve(root, values.root);
    const installed = values.stage
      ? await setupCourse({ targetRoot, stage: values.stage })
      : null;
    if (values['print-config']) {
      console.log(
        JSON.stringify(installed?.config ?? courseConfig(targetRoot), null, 2),
      );
    } else {
      console.log(
        'Installed ' +
          installed.stage +
          ' course checkpoint in ' +
          installed.root,
      );
      console.log(
        'Run pnpm install --frozen-lockfile and just dev from that copy.',
      );
      console.log(
        'Source .course.env in the request terminal for its public API addresses.',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
