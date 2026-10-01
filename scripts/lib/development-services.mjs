import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { root, run } from './process.mjs';

export const developmentServices = ['postgres', 'rustfs', 'redis', 'mailpit'];

function docker(args, env) {
  return execFileSync('docker', args, {
    cwd: root,
    env,
    encoding: 'utf8',
  }).trim();
}

export function composeConfiguration(env, files = ['compose.yaml']) {
  const args = ['compose', ...files.flatMap((file) => ['-f', file])];
  const config = JSON.parse(
    docker([...args, 'config', '--format', 'json'], env),
  );
  return { args, config };
}

export function composeBindings(config, services) {
  return services.flatMap((service) =>
    (config.services[service].ports ?? []).map((port) => ({
      service,
      host: port.host_ip ?? '0.0.0.0',
      port: Number(port.published),
      target: `${port.target}/${port.protocol ?? 'tcp'}`,
    })),
  );
}

export function runningContainers(env) {
  const ids = docker(['ps', '--quiet'], env).split(/\s+/).filter(Boolean);
  return ids.length ? JSON.parse(docker(['inspect', ...ids], env)) : [];
}

function ownsBinding(container, binding) {
  return (
    container.State?.Running &&
    container.Config.Labels?.['com.docker.compose.service'] ===
      binding.service &&
    (container.NetworkSettings.Ports?.[binding.target] ?? []).some(
      (port) =>
        port.HostIp === binding.host && Number(port.HostPort) === binding.port,
    )
  );
}

function listenerDescription(port) {
  for (const [command, args] of [
    ['ss', ['-ltnp', `sport = :${port}`]],
    ['lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']],
  ]) {
    try {
      return execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      /* another platform may provide the other command */
    }
  }
  return `host listener on TCP ${port} (use ss -ltnp or lsof to find its PID)`;
}

async function canBind({ host, port }) {
  const server = createServer();
  try {
    await new Promise((done, reject) =>
      server
        .listen({ host, port, exclusive: true }, done)
        .once('error', reject),
    );
    return true;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return false;
  } finally {
    if (server.listening) await new Promise((done) => server.close(done));
  }
}

export async function preflightPorts(bindings, containers, project) {
  const claimed = new Set();
  for (const binding of bindings) {
    const { service, host, port } = binding;
    if (claimed.has(port))
      throw new Error(
        `TCP ${port} is configured for more than one development service`,
      );
    claimed.add(port);
    const owners = containers.filter((container) =>
      Object.values(container.NetworkSettings.Ports ?? {})
        .flatMap((ports) => ports ?? [])
        .some((published) => Number(published.HostPort) === port),
    );
    if (
      owners.length === 1 &&
      project &&
      owners[0].Config.Labels?.['com.docker.compose.project'] === project &&
      ownsBinding(owners[0], binding)
    )
      continue;
    if (owners.length || !(await canBind(binding))) {
      const details = owners.length
        ? owners
            .map((owner) => {
              const name = owner.Name.replace(/^\//, '');
              const oldProject =
                owner.Config.Labels?.['com.docker.compose.project'];
              const projectArgument = /^[a-z0-9_-]+$/.test(oldProject ?? '')
                ? oldProject
                : `'${(oldProject ?? '').replaceAll("'", "'\\''")}'`;
              return `container ${name}${oldProject ? `; stop it with: docker compose -p ${projectArgument} down (preserves volumes)` : '; stop the owning container'}`;
            })
            .join('\n')
        : listenerDescription(port);
      throw new Error(
        `${service}: ${host}:${port} is occupied.\n${details}\nStop the owner or change the corresponding port in .env, then retry just dev.`,
      );
    }
  }
}

export function verifyBindings(bindings, containers) {
  for (const binding of bindings)
    if (!containers.some((container) => ownsBinding(container, binding)))
      throw new Error(
        `${binding.service}: ${binding.host}:${binding.port} has no live Docker port binding. Stop the conflicting owner, then run just services-up --force-recreate. Migrations were not started.`,
      );
}

export async function startDevelopmentServices(
  env,
  {
    services = developmentServices,
    files = ['compose.yaml'],
    hostProcesses = false,
    forceRecreate = false,
  } = {},
) {
  const { args, config } = composeConfiguration(env, files);
  const bindings = composeBindings(config, services);
  const hostBindings = hostProcesses
    ? [
        {
          service: 'api',
          host: env.APP_BIND.slice(0, env.APP_BIND.lastIndexOf(':')).replace(
            /^\[|\]$/g,
            '',
          ),
          port: Number(env.APP_BIND.split(':').at(-1)),
        },
        {
          service: 'worker',
          host: env.WORKER_BIND.slice(
            0,
            env.WORKER_BIND.lastIndexOf(':'),
          ).replace(/^\[|\]$/g, ''),
          port: Number(env.WORKER_BIND.split(':').at(-1)),
        },
        { service: 'web', host: '127.0.0.1', port: Number(env.WEB_PORT) },
      ]
    : [];
  await preflightPorts(
    [...bindings, ...hostBindings],
    runningContainers(env),
    config.name,
  );
  run(
    'docker',
    [
      ...args,
      'up',
      '-d',
      '--wait',
      ...(forceRecreate ? ['--force-recreate'] : []),
      ...services,
    ],
    env,
  );
  const ids = docker([...args, 'ps', '--all', '--quiet', ...services], env)
    .split(/\s+/)
    .filter(Boolean);
  verifyBindings(
    bindings,
    ids.length ? JSON.parse(docker(['inspect', ...ids], env)) : [],
  );
}
