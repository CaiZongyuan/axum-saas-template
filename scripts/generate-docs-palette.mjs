import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { root } from './lib/process.mjs';
import {
  assertPaletteCurrent,
  parseTokenTables,
  palettePath,
  renderPalette,
  sourcePath,
} from './lib/docs-palette.mjs';

// Regenerates the public-site palette from the application token tables.
// Runs before the docs dev/build so the site always renders the current
// palette; `--check` (wired into docs:check via the library) refuses a
// stale generated file instead. The generated file is derived content and
// stays untracked, like the rest of apps/docs/.generated.

const target = palettePath(root);

if (process.argv.includes('--check')) {
  assertPaletteCurrent(root);
  console.log('Generated palette matches the application token tables.');
} else {
  const rendered = renderPalette(
    parseTokenTables(readFileSync(sourcePath(root), 'utf8')),
  );
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rendered);
  console.log(
    `Projected ${resolve(target).replace(`${root}/`, '')} from ${resolve(sourcePath(root)).replace(`${root}/`, '')}.`,
  );
}
