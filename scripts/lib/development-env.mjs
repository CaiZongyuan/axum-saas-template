import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';

export const portVariables = [
  'POSTGRES_PORT',
  'REDIS_PORT',
  'RUSTFS_PORT',
  'APP_PORT',
  'WORKER_PORT',
  'WEB_PORT',
  'MAILPIT_SMTP_PORT',
  'MAILPIT_HTTP_PORT',
  'TELEMETRY_HTTP_PORT',
  'PROMETHEUS_PORT',
  'LOKI_PORT',
  'TEMPO_PORT',
  'GRAFANA_PORT',
];

export function readDevelopmentEnv(root, overrides = process.env) {
  const defaults = parseEnv(
    readFileSync(resolve(root, '.env.example'), 'utf8'),
  );
  let local = {};
  try {
    local = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const env = { ...defaults, ...local, ...overrides };
  for (const name of portVariables) {
    if (
      !/^[0-9]+$/.test(env[name]) ||
      Number(env[name]) < 1024 ||
      Number(env[name]) > 65535
    )
      throw new Error(`${name} must be a port between 1024 and 65535`);
  }
  const derived = developmentEndpoints(env);
  for (const [name, value] of Object.entries(derived))
    env[name] = overrides[name] ?? local[name] ?? value;
  env.COMPOSE_PROJECT_NAME =
    overrides.COMPOSE_PROJECT_NAME || composeProjectName(root);
  return env;
}

export function composeProjectName(root) {
  const name =
    basename(resolve(root))
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^[^a-z0-9]+/, '') || 'app';
  return `${name}-${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8)}`;
}

export function developmentEndpoints(env) {
  return {
    DATABASE_URL: `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT}/${encodeURIComponent(env.POSTGRES_DB)}`,
    REDIS_URL: `redis://127.0.0.1:${env.REDIS_PORT}/`,
    APP_BIND: `127.0.0.1:${env.APP_PORT}`,
    WORKER_BIND: `127.0.0.1:${env.WORKER_PORT}`,
    APP_ORIGIN: `http://127.0.0.1:${env.WEB_PORT}`,
    VITE_API_PROXY: `http://127.0.0.1:${env.APP_PORT}`,
    S3_ENDPOINT: `http://127.0.0.1:${env.RUSTFS_PORT}`,
    S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${env.RUSTFS_PORT}`,
    MAIL_SMTP_PORT: env.MAILPIT_SMTP_PORT,
    SAAS_DESKTOP_ORIGIN: `http://127.0.0.1:${env.WEB_PORT}`,
  };
}
