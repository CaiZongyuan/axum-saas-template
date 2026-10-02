import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  composeProjectName,
  readDevelopmentEnv,
} from '../../scripts/lib/development-env.mjs';
import { createServer } from 'node:net';
import {
  preflightPorts,
  verifyBindings,
} from '../../scripts/lib/development-services.mjs';

test('a copy derives every local endpoint from its port settings', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'development-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(resolve('.env.example'), join(directory, '.env.example'));
  writeFileSync(
    join(directory, '.env'),
    [
      'POSTGRES_PORT=24532',
      'REDIS_PORT=24379',
      'RUSTFS_PORT=24000',
      'APP_PORT=24001',
      'WORKER_PORT=24002',
      'WEB_PORT=24003',
      'MAILPIT_SMTP_PORT=24004',
    ].join('\n'),
  );
  const env = readDevelopmentEnv(directory, {});
  assert.equal(
    env.DATABASE_URL,
    'postgres://saas:saas-local@127.0.0.1:24532/saas',
  );
  assert.equal(env.REDIS_URL, 'redis://127.0.0.1:24379/');
  assert.equal(env.S3_ENDPOINT, 'http://127.0.0.1:24000');
  assert.equal(env.S3_PUBLIC_ENDPOINT, env.S3_ENDPOINT);
  assert.equal(env.APP_BIND, '127.0.0.1:24001');
  assert.equal(env.WORKER_BIND, '127.0.0.1:24002');
  assert.equal(env.MONITORING_WORKER_URL, 'http://127.0.0.1:24002');
  assert.equal(env.APP_ORIGIN, 'http://127.0.0.1:24003');
  assert.equal(env.VITE_API_PROXY, 'http://127.0.0.1:24001');
  assert.equal(env.SAAS_DESKTOP_ORIGIN, env.APP_ORIGIN);
  assert.equal(env.MAIL_SMTP_PORT, '24004');
  assert.match(env.COMPOSE_PROJECT_NAME, /^development-env-.*-[a-f0-9]{8}$/);
});

test('even directories with the same name get separate Docker namespaces', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'development-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = join(directory, 'first', 'my-app');
  const second = join(directory, 'second', 'my-app');
  cpSync(resolve('.env.example'), join(directory, '.env.example'));
  // Namespace derivation does not rely on a randomly named temporary directory.
  assert.notEqual(composeProjectName(first), composeProjectName(second));
});

test('startup names a Docker owner even when the host listener is invisible', async () => {
  const container = {
    Name: '/previous-postgres-1',
    State: { Running: true },
    Config: {
      Labels: {
        'com.docker.compose.project': 'previous',
        'com.docker.compose.service': 'postgres',
      },
    },
    NetworkSettings: {
      Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '25432' }] },
    },
  };
  await assert.rejects(
    preflightPorts(
      [
        {
          service: 'postgres',
          host: '127.0.0.1',
          port: 25432,
          target: '5432/tcp',
        },
      ],
      [container],
      'current',
    ),
    /previous-postgres-1[\s\S]*docker compose -p previous down/,
  );
  await assert.doesNotReject(
    preflightPorts(
      [
        {
          service: 'postgres',
          host: '127.0.0.1',
          port: 25432,
          target: '5432/tcp',
        },
      ],
      [container],
      'previous',
    ),
  );
});

test('startup identifies a host listener before running migrations', async (t) => {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  await assert.rejects(
    preflightPorts(
      [{ service: 'web', host: '127.0.0.1', port: server.address().port }],
      [],
    ),
    /web.*occupied[\s\S]*(pid|listener)/i,
  );
});

test('healthy containers without the requested host binding fail startup', () => {
  const binding = {
    service: 'postgres',
    host: '127.0.0.1',
    port: 25432,
    target: '5432/tcp',
  };
  const container = {
    Name: '/my-app-postgres-1',
    State: { Running: true },
    Config: { Labels: { 'com.docker.compose.service': 'postgres' } },
    NetworkSettings: { Ports: { '5432/tcp': [] } },
  };
  assert.throws(
    () => verifyBindings([binding], [container]),
    /postgres.*25432.*binding/,
  );
  container.NetworkSettings.Ports['5432/tcp'] = [
    { HostIp: '127.0.0.1', HostPort: '25432' },
  ];
  assert.doesNotThrow(() => verifyBindings([binding], [container]));
});
