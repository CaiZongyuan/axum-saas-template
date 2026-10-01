import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib/process.mjs';

run('node', ['scripts/build-create-package.mjs']);
const destination = join(root, '.scratch/create-package');
mkdirSync(destination, { recursive: true });
const output = JSON.parse(
  execFileSync(
    'npm',
    [
      'pack',
      './tools/create-axum-saas',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      destination,
    ],
    { cwd: root, encoding: 'utf8' },
  ),
);
console.log(join(destination, Object.values(output)[0].filename));
