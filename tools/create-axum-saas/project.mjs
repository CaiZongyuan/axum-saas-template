import { execFileSync, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

function renameTemplate(root, name, repository) {
  const snake = name.replaceAll('-', '_');
  const camel = name.replace(/-([a-z0-9])/g, (_, character) =>
    character.toUpperCase(),
  );
  const replacements = new Map([
    ['CaiZongyuan/axum-saas-template', repository],
    [
      'caizongyuan.github.io/axum-saas-template',
      `${repository.split('/')[0].toLowerCase()}.github.io/${repository.split('/')[1]}`,
    ],
    ['axum-saas-template', name],
    ['axum-saas', name],
    ['@saas/', `@${name}/`],
    ['saasDesktop', `${camel}Desktop`],
    ['SAAS', snake.toUpperCase()],
    ['saas_', `${snake}_`],
    ['saas-', `${name}-`],
    ['saas.', `${name}.`],
    ['Dougong', name],
    ['斗拱', name],
    ['SaaS Template', name],
    ['SaaS 模板', name],
    ['saas', snake],
  ]);
  const literalTokens = [...replacements.keys()]
    .filter((token) => token !== 'saas')
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tokens = new RegExp(
    `${literalTokens.join('|')}|@saas\\\\+/|saas\\\\+[.-]|saas`,
    'g',
  );
  const rewrite = (text) =>
    text.replace(
      tokens,
      (token) =>
        replacements.get(token) ??
        (token.startsWith('@')
          ? `@${name}${token.slice(5)}`
          : `${name}${token.slice(4)}`),
    );
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const buffer = readFileSync(path);
        if (entry.name !== 'LICENSE' && isUtf8(buffer) && !buffer.includes(0)) {
          const content = buffer.toString('utf8');
          const next = rewrite(content);
          if (next !== content) writeFileSync(path, next);
        }
      }
      const nextName = rewrite(entry.name);
      if (nextName !== entry.name) renameSync(path, join(directory, nextName));
    }
  }
  walk(root);
}

function updateDocumentationPorts(root, defaults, ports) {
  const mapping = new Map(
    Object.entries(ports).map(([key, value]) => [defaults[key], value]),
  );
  const site = JSON.parse(readFileSync(join(root, 'docs/site.json'), 'utf8'));
  const files = [
    'README.md',
    'README.zh-CN.md',
    ...site.pages
      .flatMap((page) => [page.source, page.sourceEn])
      .filter(Boolean),
  ];
  for (const file of files) {
    const path = join(root, file);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /127\.0\.0\.1:(\d+)\b/g,
        (match, port) =>
          mapping.has(port) ? `127.0.0.1:${mapping.get(port)}` : match,
      ),
    );
  }
}

async function reservePorts(env, variables, reserved) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const offset = randomInt(0, 10000);
    const ports = Object.fromEntries(
      variables.map((key) => [key, Number(env[key]) + offset]),
    );
    if (Object.values(ports).some((port) => reserved.has(port))) continue;
    const servers = [];
    try {
      for (const port of Object.values(ports)) {
        const server = createServer();
        servers.push(server);
        await new Promise((done, reject) =>
          server.listen(port, '127.0.0.1', done).once('error', reject),
        );
      }
      return {
        ports,
        close: () =>
          Promise.all(
            servers.map((server) => new Promise((done) => server.close(done))),
          ),
      };
    } catch (error) {
      await Promise.all(
        servers
          .filter((server) => server.listening)
          .map((server) => new Promise((done) => server.close(done))),
      );
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Could not find a free development port group');
}

function dockerPublishedPorts() {
  const options = {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const listed = spawnSync('docker', ['ps', '--quiet'], options);
  if (listed.status !== 0) return [];
  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const inspected = spawnSync(
    'docker',
    ['inspect', '--format', '{{json .NetworkSettings.Ports}}', ...ids],
    options,
  );
  // Docker is optional during creation; startup always performs mandatory checks.
  if (inspected.status !== 0) return [];
  return inspected.stdout
    .trim()
    .split('\n')
    .flatMap((line) =>
      Object.values(JSON.parse(line) ?? {})
        .flatMap((ports) => ports ?? [])
        .map((port) => Number(port.HostPort)),
    );
}

// Persist reservations for copies that have been created but are not running yet.
async function withPortRegistry(action) {
  const directory = join(
    process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    'create-axum-saas',
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'ports.lock');
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Port allocation is locked; retry after the other creator exits, or remove a stale ${lock}`,
          { cause: error },
        );
      await delay(50);
    }
  }
  try {
    const path = join(directory, 'ports.json');
    const registry = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : {};
    for (const project of Object.keys(registry))
      if (!existsSync(project)) delete registry[project];
    const result = await action(registry);
    const temporary = join(directory, `ports-${process.pid}.json`);
    writeFileSync(temporary, `${JSON.stringify(registry)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    return result;
  } finally {
    rmSync(lock, { recursive: true });
  }
}

export async function createProject(
  directory,
  { examples = true, repository } = {},
) {
  const target = resolve(directory || '');
  const name = basename(target);
  if (
    !directory ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 48
  )
    throw new Error(
      'Use a lowercase project name of at most 48 characters, for example my-app',
    );
  repository ??= `your-org/${name}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('Repository must be owner/repo');
  if (existsSync(target))
    throw new Error(`Directory already exists: ${target}`);
  const archive = join(
    import.meta.dirname,
    examples ? 'template.tgz' : 'core.tgz',
  );
  if (!existsSync(archive))
    throw new Error(
      'Template archive is missing; build the creator package before running it',
    );
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(join(dirname(target), `.${name}-`));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', stage]);
    renameTemplate(stage, name, repository);
    const { readDevelopmentEnv, portVariables, composeProjectName } =
      await import(
        pathToFileURL(join(stage, 'scripts/lib/development-env.mjs'))
      );
    const env = readDevelopmentEnv(stage, {});
    return await withPortRegistry(async (registry) => {
      const reserved = new Set([
        ...Object.values(registry).flat(),
        ...dockerPublishedPorts(),
      ]);
      const allocation = await reservePorts(env, portVariables, reserved);
      try {
        updateDocumentationPorts(stage, env, allocation.ports);
        writeFileSync(
          join(stage, '.env'),
          `COMPOSE_PROJECT_NAME=${composeProjectName(target)}\n${Object.entries(
            allocation.ports,
          )
            .map(([key, port]) => `${key}=${port}`)
            .join('\n')}\n`,
          { mode: 0o600 },
        );
        if (existsSync(target))
          throw new Error(`Directory already exists: ${target}`);
        renameSync(stage, target);
        registry[target] = Object.values(allocation.ports);
        return { name, ports: allocation.ports };
      } finally {
        await allocation.close();
      }
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
