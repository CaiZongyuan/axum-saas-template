import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { setupCourse } from './tutorial-course.mjs';
import { root } from './lib/process.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const { values } = parseArgs({ options: { report: { type: 'string' } } });
const id = randomUUID().slice(0, 12);
const production = `dougong-course-recovery-${id}`;
const restore = `dougong-course-restored-${id}`;
const image = `dougong-course-recovery:drill-${id}`;
const scratch = mkdtempSync(join(tmpdir(), 'dougong-course-recovery-'));
const target = join(scratch, 'project');
const envPath = join(scratch, 'private.env');
const reportPath = values.report
  ? isAbsolute(values.report)
    ? values.report
    : resolve(root, values.report)
  : join(
      root,
      '.scratch/documentation-rebuild/validation',
      `tutorial-recovery-${id}.json`,
    );
if (existsSync(reportPath)) {
  rmSync(scratch, { recursive: true, force: true });
  throw new Error('Recovery report already exists; select a new report path.');
}
mkdirSync(dirname(reportPath), { recursive: true, mode: 0o700 });

let stage = 'preflight';
class RecoveryFailure extends Error {}
let active;
let interrupted = false;
const taskEnv = {
  ...process.env,
  TMPDIR: scratch,
  NODE_TLS_REJECT_UNAUTHORIZED: '1',
};
for (const file of ['.env.example', 'deploy/production/env.production.example'])
  for (const key of Object.keys(
    parseEnv(readFileSync(join(root, file), 'utf8')),
  ))
    delete taskEnv[key];
delete taskEnv.COMPOSE_PROJECT_NAME;
delete taskEnv.COMPOSE_FILE;
delete taskEnv.COMPOSE_PROFILES;

function run(command, args, cwd = target) {
  if (interrupted)
    return Promise.reject(new RecoveryFailure('Recovery interrupted.'));
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: taskEnv,
      stdio: 'inherit',
      detached: true,
    });
    active = child;
    child.once('error', () =>
      rejectRun(new RecoveryFailure('Unable to start recovery command.')),
    );
    child.once('close', (status) => {
      active = undefined;
      if (status === 0) resolveRun();
      else rejectRun(new RecoveryFailure('Recovery command did not succeed.'));
    });
  });
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = true;
    if (active?.pid) {
      try {
        process.kill(-active.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
  });

async function vacant(port) {
  const listener = createServer();
  try {
    await new Promise((resolveListen, rejectListen) => {
      listener.once('error', rejectListen);
      listener.listen(
        { port, host: '0.0.0.0', exclusive: true },
        resolveListen,
      );
    });
  } catch (error) {
    // Docker binds privileged ports through its daemon; the invoking user may not.
    if (
      error.code === 'EACCES' &&
      execFileSync('ss', ['-H', '-ltn', `sport = :${port}`], {
        encoding: 'utf8',
      }).trim() === ''
    )
      return;
    throw new RecoveryFailure(`Recovery requires free localhost port ${port}.`);
  }
  await new Promise((resolveClose) => listener.close(resolveClose));
}

let failed = false;
let cleanupFailed = false;
let localDocker = false;
try {
  await vacant(80);
  await vacant(443);
  const endpoint =
    (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
    execFileSync(
      'docker',
      [
        'context',
        'inspect',
        '--format',
        '{{(index .Endpoints "docker").Host}}',
      ],
      { encoding: 'utf8' },
    ).trim();
  if (
    !/^(?:unix:|npipe:|tcp:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$))/.test(
      endpoint,
    )
  )
    throw new RecoveryFailure('Recovery requires a local Docker daemon.');
  localDocker = true;
  stage = 'materialize jobs checkpoint';
  await setupCourse({ targetRoot: target, stage: 'jobs' });
  const composition = yaml.load(
    readFileSync(join(target, 'compose.production.yaml'), 'utf8'),
  );
  const previousImage = composition['x-application'].image;
  composition.name = production;
  composition['x-application'].image = image;
  for (const service of Object.values(composition.services))
    if (service.image === previousImage) service.image = image;
  composition.services.caddy.ports = ['127.0.0.1:80:80', '127.0.0.1:443:443'];
  writeFileSync(
    join(target, 'compose.production.yaml'),
    yaml.dump(composition, { lineWidth: -1 }),
  );

  const password = randomBytes(24).toString('hex');
  writeFileSync(
    envPath,
    [
      'DOMAIN=localhost',
      'APP_ORIGIN=https://localhost',
      `POSTGRES_PASSWORD=${password}`,
      `DATABASE_URL=postgres://saas:${password}@postgres:5432/saas`,
      'REDIS_URL=redis://redis:6379/',
      'RUST_LOG=info',
      'S3_ENDPOINT=http://rustfs:9000',
      'S3_PUBLIC_ENDPOINT=https://localhost',
      `S3_BUCKET=${production}`,
      'S3_REGION=us-east-1',
      `S3_ACCESS_KEY=drill-${randomBytes(16).toString('hex')}`,
      `S3_SECRET_KEY=${randomBytes(32).toString('hex')}`,
      'MAIL_SMTP_HOST=',
      'TELEMETRY_ENDPOINT=',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  if ((statSync(envPath).mode & 0o777) !== 0o600)
    throw new RecoveryFailure(
      'Private recovery environment permissions must be 0600.',
    );
  stage = 'build web assets';
  await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
  await run('pnpm', ['--filter', '@saas/web', 'build']);
  stage = 'build unique production image';
  await run('docker', [
    'build',
    '-f',
    'deploy/production/Dockerfile',
    '-t',
    image,
    '.',
  ]);
  stage = 'production backup and independent restore';
  await run(process.execPath, [
    'examples/tutorial-tickets/recovery.mjs',
    '--env-file',
    envPath,
    '--production',
    production,
    '--restore',
    restore,
    '--scratch',
    scratch,
    '--report',
    reportPath,
    '--image',
    image,
  ]);
} catch (error) {
  failed = true;
  const prior = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : {};
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...prior,
        status: 'fail',
        stage: prior.stage ?? stage,
        failure:
          prior.failure ??
          (error instanceof RecoveryFailure
            ? error.message
            : 'Recovery setup or command did not succeed.'),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    `Course recovery did not pass at stage: ${stage}. Safe report: ${reportPath}`,
  );
} finally {
  if (
    existsSync(join(target, 'compose.production.yaml')) &&
    existsSync(envPath)
  ) {
    const { composeArgs, dockerEnv } = await import(
      pathToFileURL(join(target, 'scripts/lib/production-stack.mjs'))
    );
    for (const project of [restore, production]) {
      try {
        execFileSync(
          'docker',
          [
            ...composeArgs(project, envPath),
            'down',
            '-v',
            '--remove-orphans',
            '--timeout',
            '60',
          ],
          { ...dockerEnv(envPath), stdio: ['ignore', 'ignore', 'pipe'] },
        );
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (localDocker)
    try {
      execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
      execFileSync('docker', ['image', 'rm', image], { stdio: 'ignore' });
    } catch {
      try {
        execFileSync('docker', ['image', 'inspect', image], {
          stdio: 'ignore',
        });
        cleanupFailed = true;
      } catch {
        /* No image was produced. */
      }
    }
  rmSync(scratch, { recursive: true, force: true });
  const prior = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : { status: 'fail', stage };
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...prior,
        status: cleanupFailed ? 'fail' : prior.status,
        cleanup: cleanupFailed ? 'fail' : 'pass',
      },
      null,
      2,
    ) + '\n',
  );
  if (cleanupFailed) {
    failed = true;
    console.error(
      `Course recovery cleanup needs attention for projects ${production}, ${restore} or image ${image}.`,
    );
  }
}
process.exitCode = failed ? 1 : 0;
if (!failed)
  console.log(`Course production recovery passed. Safe report: ${reportPath}`);
