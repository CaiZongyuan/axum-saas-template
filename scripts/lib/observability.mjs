import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, run, waitFor } from './process.mjs';
import { startDevelopmentServices } from './development-services.mjs';
export const observabilityServices = [
  'collector',
  'prometheus',
  'loki',
  'tempo',
  'grafana',
];
export function observabilityEnv(env) {
  const next = {
    ...env,
    TELEMETRY_ENDPOINT:
      env.TELEMETRY_ENDPOINT || `http://127.0.0.1:${env.TELEMETRY_HTTP_PORT}`,
    MONITORING_PROMETHEUS_URL:
      env.MONITORING_PROMETHEUS_URL ||
      `http://127.0.0.1:${env.PROMETHEUS_PORT}`,
    MONITORING_WORKER_URL:
      env.MONITORING_WORKER_URL || `http://127.0.0.1:${env.WORKER_PORT}`,
    MONITORING_GRAFANA_URL:
      env.MONITORING_GRAFANA_URL || `http://127.0.0.1:${env.GRAFANA_PORT}`,
    TELEMETRY_LOG_DIRECTORY: resolve(
      root,
      env.TELEMETRY_LOG_DIRECTORY || '.runtime/telemetry',
    ),
  };
  mkdirSync(next.TELEMETRY_LOG_DIRECTORY, { recursive: true, mode: 0o700 });
  return next;
}
export function observabilityCompose(args, env) {
  run(
    'docker',
    [
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose.observability.yaml',
      '--profile',
      'observability',
      ...args,
    ],
    env,
  );
}
export async function startObservability(env) {
  await startDevelopmentServices(env, {
    services: observabilityServices,
    files: ['compose.yaml', 'compose.observability.yaml'],
    profiles: ['observability'],
  });
  await Promise.all([
    waitFor(
      `${env.TELEMETRY_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
      undefined,
      60_000,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-protobuf' },
        body: new Uint8Array(),
      },
    ),
    waitFor(`http://127.0.0.1:${env.TEMPO_PORT}/ready`, undefined, 60_000),
    waitFor(`http://127.0.0.1:${env.LOKI_PORT}/ready`, undefined, 60_000),
    waitFor(
      `http://127.0.0.1:${env.PROMETHEUS_PORT}/-/ready`,
      undefined,
      60_000,
    ),
    waitFor(
      `http://127.0.0.1:${env.GRAFANA_PORT}/api/health`,
      undefined,
      60_000,
    ),
  ]);
  console.log(
    `Observability ready: Grafana http://127.0.0.1:${env.GRAFANA_PORT}`,
  );
}
