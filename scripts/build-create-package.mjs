import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { root } from './lib/process.mjs';
import {
  prepareCoreTemplate,
  regenerateCoreTemplate,
} from './lib/scaffold-template.mjs';

const packageDirectory = join(root, 'tools/create-axum-saas');
const excluded =
  /^(?:tools\/create-axum-saas\/|target(?:\/|$)|node_modules(?:\/|$)|scripts\/(?:build-create-package|pack-scaffold|scaffold-smoke)\.mjs$|scripts\/lib\/scaffold-template\.mjs$|tests\/tooling\/scaffold\.test\.mjs$)/;
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '-z', '--cached'], {
      cwd: root,
      encoding: 'utf8',
    }).split('\0'),
  ),
].filter(
  (file) => file && !excluded.test(file) && existsSync(join(root, file)),
);
const stage = mkdtempSync(join(tmpdir(), 'create-axum-saas-build-'));
try {
  for (const file of files) {
    const target = join(stage, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target, {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  const packageJson = JSON.parse(
    readFileSync(join(stage, 'package.json'), 'utf8'),
  );
  delete packageJson.scripts['scaffold:pack'];
  delete packageJson.scripts['scaffold:smoke'];
  writeFileSync(
    join(stage, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const path = join(stage, file);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /<!-- scaffold:creator:start -->[\s\S]*?<!-- scaffold:creator:end -->\n?/g,
        '',
      ),
    );
  }
  const sitePath = join(stage, 'docs/site.json');
  const site = JSON.parse(readFileSync(sitePath, 'utf8'));
  site.pages = site.pages.filter((page) => page.id !== 'create-project');
  for (const page of site.pages) {
    if (page.previous === 'create-project') page.previous = 'documentation';
    if (page.next === 'create-project') page.next = 'quickstart';
  }
  writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`);
  for (const file of [
    'docs/getting-started/create-project.md',
    'docs/getting-started/create-project.en.md',
  ])
    rmSync(join(stage, file), { force: true });
  execFileSync('tar', [
    '-czf',
    join(packageDirectory, 'template.tgz'),
    '-C',
    stage,
    '.',
  ]);
  prepareCoreTemplate(stage);
  execFileSync('cargo', ['fetch', '--locked'], { cwd: root, stdio: 'inherit' });
  regenerateCoreTemplate(
    stage,
    process.env.CARGO_TARGET_DIR || join(root, 'target'),
  );
  execFileSync('tar', [
    '-czf',
    join(packageDirectory, 'core.tgz'),
    '-C',
    stage,
    '.',
  ]);
  cpSync(join(root, 'LICENSE'), join(packageDirectory, 'LICENSE'));
  console.log('Creator template snapshot built');
} finally {
  rmSync(stage, { recursive: true, force: true });
}
