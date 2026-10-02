import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './lib/process.mjs';

function registryDist(directory, name, version) {
  try {
    const result = JSON.parse(
      execFileSync(
        'npm',
        [
          'view',
          `${name}@${version}`,
          'dist',
          '--json',
          '--registry=https://registry.npmjs.org',
        ],
        { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    const dist = Array.isArray(result) ? result[0] : result;
    if (typeof dist?.integrity !== 'string')
      throw new Error('Invalid registry metadata');
    return dist;
  } catch (error) {
    try {
      if (JSON.parse(error.stdout?.toString()).error?.code === 'E404')
        return null;
    } catch {
      /* Only an explicit missing version permits publishing. */
    }
    throw new Error(
      'Unable to query the npm registry; check authentication and connectivity',
      { cause: error },
    );
  }
}

try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: root },
      version: { type: 'string' },
      publish: { type: 'boolean', default: false },
    },
  });
  const directory = resolve(values.root);
  const { name, version } = JSON.parse(
    readFileSync(
      join(directory, 'tools/create-axum-saas/package.json'),
      'utf8',
    ),
  );
  if (values.version !== version)
    throw new Error(`Release version must match package metadata: ${version}`);
  if (values.publish && process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Publishing is restricted to the main branch');
  const archive = join(
    directory,
    `.scratch/create-package/${name}-${version}.tgz`,
  );
  if (!existsSync(archive))
    throw new Error('Release archive is missing; run pnpm scaffold:pack first');
  if (!process.env.NODE_AUTH_TOKEN)
    throw new Error('Set the GitHub NPM_TOKEN secret for npm authentication');
  const options = { cwd: directory, stdio: ['ignore', 'inherit', 'inherit'] };
  execFileSync(
    'npm',
    ['whoami', '--registry=https://registry.npmjs.org'],
    options,
  );
  if (values.publish && registryDist(directory, name, version))
    throw new Error(
      `${name}@${version} is already published; bump the package version first`,
    );
  execFileSync(
    'npm',
    [
      'publish',
      archive,
      '--access=public',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org',
      ...(values.publish ? [] : ['--dry-run']),
    ],
    options,
  );
  if (values.publish) {
    const expected = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    const deadline = Date.now() + 600_000;
    let verified = false;
    while (Date.now() < deadline) {
      const dist = registryDist(directory, name, version);
      if (dist) {
        if (dist.integrity !== expected)
          throw new Error('Published archive integrity does not match');
        verified = true;
        break;
      }
      console.log('Waiting for npm publication processing');
      await delay(15_000);
    }
    if (!verified)
      throw new Error(
        'npm did not make the version available; check processing status and token publish permissions',
      );
    console.log(`Registry integrity verified: ${name}@${version}`);
  }
  console.log(
    `${values.publish ? 'Publish' : 'Dry run'} completed: ${name}@${version}`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
