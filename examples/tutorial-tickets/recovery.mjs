import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  drainLogPresent,
  migrationState,
  originRootCa,
  psql,
  readEnvFile,
  request,
  runCompose,
  stopWithBudget,
} from '../../scripts/lib/production-stack.mjs';
import { root } from '../../scripts/lib/process.mjs';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['env-file', 'production', 'restore', 'scratch', 'report', 'image'].map(
      (name) => [name, { type: 'string' }],
    ),
  ),
});
for (const key of [
  'env-file',
  'production',
  'restore',
  'scratch',
  'report',
  'image',
])
  if (!values[key]) throw new Error(`Missing recovery argument: ${key}`);
const receipt = JSON.parse(
  readFileSync(join(root, '.scratch/tutorial-course/state.json'), 'utf8'),
);
if (receipt.stage !== 'jobs')
  throw new Error('Production recovery requires the jobs checkpoint.');
const production = values.production;
const restore = values.restore;
if (
  !/^dougong-course-recovery-[a-f0-9-]+$/.test(production) ||
  !/^dougong-course-restored-[a-f0-9-]+$/.test(restore) ||
  production === restore
)
  throw new Error(
    'Recovery projects must be distinct disposable course projects.',
  );
const envPath = values['env-file'];
const env = readEnvFile(envPath);
if (env.APP_ORIGIN !== 'https://localhost')
  throw new Error('Course recovery uses local HTTPS.');
const archive = join(values.scratch, 'archive');
let project = production;
let rootCa;
let cookie;
let csrf;
let stage = 'production stack';
let imageDigest;
let failure;
class RecoveryAssertion extends Error {}
const checks = {};
const ids = {};

function ensure(value, label) {
  if (!value) throw new RecoveryAssertion(label);
}
function record(status) {
  writeFileSync(
    values.report,
    JSON.stringify(
      {
        status,
        stage,
        verifiedAt: new Date().toISOString(),
        scope:
          'Disposable local production composition with Caddy local CA; no public domain or online deployment.',
        sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        courseReceiptSha256: createHash('sha256')
          .update(JSON.stringify(receipt))
          .digest('hex'),
        image: values.image,
        imageDigest,
        failure,
        projects: { production, restore },
        checks,
        ids,
      },
      null,
      2,
    ) + '\n',
  );
}
async function application(path, method = 'GET', body, expected = 200) {
  const response = await request(method, `${env.APP_ORIGIN}${path}`, {
    headers: {
      origin: env.APP_ORIGIN,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    rootCa,
  });
  ensure(
    response.status === expected,
    `Application expected status ${expected}, observed ${response.status}.`,
  );
  const data =
    response.status === 204
      ? undefined
      : JSON.parse(response.buffer.toString());
  const setCookie = response.headers['set-cookie'];
  if (setCookie?.length) {
    cookie = setCookie[0].split(';')[0];
    csrf = data?.csrf_token;
  }
  return data;
}
async function eventually(action, label) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const value = await action();
    if (value) return value;
    await delay(500);
  }
  throw new RecoveryAssertion(label);
}

try {
  record('running');
  runCompose(project, envPath, [
    'up',
    '-d',
    '--wait',
    'postgres',
    'redis',
    'rustfs',
  ]);
  runCompose(project, envPath, ['run', '--rm', 'migrate'], 'ops');
  runCompose(project, envPath, ['run', '--rm', 'storage-init'], 'ops');
  runCompose(project, envPath, [
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '180',
    'api',
    'worker',
    'caddy',
  ]);
  stage = 'verified localhost TLS';
  rootCa = originRootCa(project, envPath, env.APP_ORIGIN, values.scratch);
  ensure(
    (await request('GET', `${env.APP_ORIGIN}/health/ready`, { rootCa }))
      .status === 200,
    'Production readiness must pass with certificate verification.',
  );
  checks.localTlsReadiness = 'pass';

  stage = 'seed ticket and attachment';
  const registered = await application(
    '/api/v1/auth/register',
    'POST',
    {
      email: `course-recovery-${randomBytes(8).toString('hex')}@example.test`,
      password: `recovery-${randomBytes(24).toString('hex')}`,
    },
    201,
  );
  ensure(
    registered.user.role === 'owner',
    'First account must initialize Owner.',
  );
  ids.user = registered.user.id;
  const created = await application(
    '/api/v1/tickets',
    'POST',
    { title: 'Recovery ticket', description: 'Original request' },
    201,
  );
  const ticketPath = `/api/v1/tickets/${created.id}`;
  ids.ticket = created.id;
  const updated = await application(ticketPath, 'PUT', {
    title: 'Updated recovery ticket',
    description: 'Persisted business state',
    status: 'closed',
    version: created.version,
  });
  ensure(
    updated.version === created.version + 1,
    'Update must increment the business version.',
  );
  const attachmentBytes = Buffer.from(
    `course-recovery-attachment-${randomUUID()}`,
  );
  const attachmentHash = createHash('sha256')
    .update(attachmentBytes)
    .digest('hex');
  const upload = await application(
    `${ticketPath}/uploads`,
    'POST',
    {
      file_name: 'recovery-evidence.txt',
      content_type: 'text/plain',
      size: attachmentBytes.length,
      sha256: attachmentHash,
    },
    201,
  );
  ids.file = upload.upload_id;
  const transferred = await request('PUT', upload.upload.url, {
    headers: upload.upload.headers,
    body: attachmentBytes,
    rootCa,
  });
  ensure(
    transferred.status >= 200 && transferred.status < 300,
    'Presigned upload must transfer actual bytes through TLS.',
  );
  await application(
    `${ticketPath}/uploads/${upload.upload_id}/complete`,
    'POST',
    {},
  );
  checks.ticketMutation = 'pass';
  checks.attachmentUpload = 'pass';

  stage = 'queue after Worker drain';
  stopWithBudget(project, envPath, 'worker', 40);
  ensure(
    drainLogPresent(project, envPath, 'worker'),
    'Worker must drain normally.',
  );
  const queued = await application(`${ticketPath}/exports`, 'POST', {}, 202);
  ensure(
    queued.status === 'queued',
    'Export must remain queued during the window.',
  );
  ids.export = queued.id;
  ids.job = queued.job_id;
  checks.queuedExport = 'pass';

  stage = 'public production backup';
  execFileSync(
    process.execPath,
    [
      'scripts/production-backup.mjs',
      '--project',
      project,
      '--env-file',
      envPath,
      '--archive',
      archive,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  const manifest = JSON.parse(
    readFileSync(join(archive, 'manifest.json'), 'utf8'),
  );
  imageDigest = manifest.application.image_digest;
  ensure(
    manifest.objects.entries.some(
      (entry) => entry.file_id === ids.file && entry.sha256 === attachmentHash,
    ),
    'Backup manifest must include the verified attachment.',
  );
  ensure(
    psql(
      project,
      envPath,
      `SELECT status FROM saas_core.jobs WHERE id = '${ids.job}'`,
    ) === 'queued',
    'Backup must preserve a queued export.',
  );
  checks.publicBackup = 'pass';
  const originalMigrations = migrationState(project, envPath);
  runCompose(project, envPath, [
    'down',
    '-v',
    '--remove-orphans',
    '--timeout',
    '60',
  ]);

  stage = 'public independent restore';
  execFileSync(
    process.execPath,
    [
      'scripts/production-restore.mjs',
      '--project',
      restore,
      '--env-file',
      envPath,
      '--archive',
      archive,
      '--report',
      join(archive, 'restore-report.md'),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  project = restore;
  rootCa = originRootCa(project, envPath, env.APP_ORIGIN, values.scratch);
  const restoredMigrations = migrationState(project, envPath);
  ensure(
    restoredMigrations.version === originalMigrations.version &&
      restoredMigrations.count === originalMigrations.count,
    'Restore must retain the complete embedded migration ledger.',
  );
  checks.publicIndependentRestore = 'pass';

  stage = 'verify restored business';
  const reread = await application(ticketPath);
  for (const field of [
    'id',
    'created_by',
    'title',
    'description',
    'status',
    'version',
    'created_at',
    'updated_at',
  ])
    ensure(
      reread[field] === updated[field],
      'Restored ticket fields/version must match.',
    );
  const attachments = await application(`${ticketPath}/attachments`);
  ensure(
    attachments.some(
      (entry) => entry.id === ids.file && entry.sha256 === attachmentHash,
    ),
    'Restored attachment association and digest must match.',
  );
  const download = await application(
    `${ticketPath}/attachments/${ids.file}/download`,
  );
  const downloaded = await request(download.method, download.url, {
    headers: download.headers,
    rootCa,
  });
  ensure(
    downloaded.status === 200 &&
      downloaded.buffer.equals(attachmentBytes) &&
      createHash('sha256').update(downloaded.buffer).digest('hex') ===
        attachmentHash,
    'Restored attachment bytes and SHA-256 must match.',
  );
  checks.restoredTicketFieldsAndVersion = 'pass';
  checks.restoredAttachmentBytesAndDigest = 'pass';

  stage = 'verify restored Worker output and notice';
  await eventually(async () => {
    const exported = await application(`${ticketPath}/exports/${ids.export}`);
    ensure(exported.status !== 'failed', 'Restored export must not fail.');
    return exported.status === 'succeeded';
  }, 'Restored queued export did not succeed.');
  const capability = await application(
    `${ticketPath}/exports/${ids.export}/download`,
  );
  const generated = await request(capability.method, capability.url, {
    headers: capability.headers,
    rootCa,
  });
  ensure(generated.status === 200, 'Worker result must be downloadable.');
  const exported = JSON.parse(generated.buffer.toString());
  ensure(
    exported.ticket.version === updated.version &&
      exported.ticket.title === updated.title &&
      exported.ticket.description === updated.description &&
      exported.attachments.length === 1 &&
      exported.attachments[0].sha256 === attachmentHash,
    'Worker JSON must retain the request-time ticket and attachment metadata.',
  );
  ensure(
    !JSON.stringify(exported).includes('object_key') &&
      !JSON.stringify(exported).includes('bucket'),
    'Worker JSON must omit storage locations.',
  );
  const notice = await eventually(async () => {
    const inbox = await application('/api/v1/notifications');
    return inbox.data.find(
      (entry) =>
        entry.target.kind === 'tickets.export' &&
        entry.target.resource_id === ids.export &&
        entry.outcome === 'succeeded',
    );
  }, 'Restored export success notice was not visible.');
  ids.notice = notice.id;
  checks.restoredQueuedWorkerJson = 'pass';
  checks.restoredSuccessNotice = 'pass';
  stage = 'complete';
  record('pass');
  console.log(
    'Course HTTPS backup and independent restore business assertions passed.',
  );
} catch (error) {
  failure =
    error instanceof RecoveryAssertion
      ? error.message
      : 'Recovery procedure or transport did not succeed.';
  record('fail');
  console.error(`Course recovery assertion failed at stage: ${stage}.`);
  process.exitCode = 1;
}
