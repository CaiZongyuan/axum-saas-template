import { developmentMailKey } from './development-mail-key.mjs';
import { readDevelopmentEnv } from './development-env.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const root = resolve(import.meta.dirname, '../..');

// Resolve a user-supplied path (absolute, or relative to the repository).
export function resolveRoot(path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

export function developmentEnv() {
  const env = {
    ...readDevelopmentEnv(root),
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
  };
  if (
    env.MAIL_SMTP_HOST &&
    env.MAIL_SMTP_TLS === 'local' &&
    !env.MAIL_ENCRYPTION_KEY
  )
    env.MAIL_ENCRYPTION_KEY = developmentMailKey(root);
  return env;
}

export function run(command, args, env = process.env) {
  execFileSync(command, args, { cwd: root, env, stdio: 'inherit' });
}

// run() blocks this event loop; when the process is itself serving
// (the public-site journeys host the docs server in-process) a synchronous
// child would leave the server unable to answer the browser. This variant
// awaits the child while the loop stays free.
export function runAsync(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  return new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveDone();
      else
        reject(
          new Error(`${command} ${args.join(' ')} exited with code ${code}`),
        );
    });
  });
}

export function launch(command, args, env) {
  return spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
}

export async function stop(child, graceMs = 5_000) {
  if (!child?.pid) return;
  const alive = () => {
    if (process.platform === 'win32')
      return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const signal = (value) => {
    try {
      if (process.platform === 'win32') child.kill(value);
      else process.kill(-child.pid, value);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  if (!alive()) return;
  signal('SIGTERM');
  const deadline = performance.now() + graceMs;
  while (alive() && performance.now() < deadline) await delay(25);
  // A wrapper exiting does not prove its process group has stopped.
  if (alive()) signal('SIGKILL');
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(1_000),
    ]);
  }
}

export async function freePort() {
  return (await freePorts(1))[0];
}

export async function freePorts(count) {
  const servers = [];
  try {
    // The OS may immediately recycle a closed probe's port. Keep the whole
    // group bound until every member has its own port.
    for (let index = 0; index < count; index++) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolveListen, reject) =>
        server.listen(0, '127.0.0.1', resolveListen).once('error', reject),
      );
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(
      servers
        .filter((server) => server.listening)
        .map((server) => new Promise((done) => server.close(done))),
    );
  }
}

export async function waitFor(url, child, timeoutMs = 30_000, request = {}) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error('Service exited before becoming ready');
    try {
      if (
        (await fetch(url, { ...request, signal: AbortSignal.timeout(1_000) }))
          .ok
      )
        return;
    } catch {
      /* retry only during bounded startup */
    }
    await delay(100);
  }
  throw new Error(
    `Service did not become ready within ${timeoutMs}ms: ${new URL(url).pathname}`,
  );
}
