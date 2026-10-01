import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { siteModel } from './lib/docs.mjs';
import { checkBuiltLinks } from './lib/docs-links.mjs';

// Post-build verification of the real site: every internal link in the
// built HTML must land on a built page, and every page's locale switcher
// must land on a built page of the other locale. This closes the gap the
// rendered-source checks cannot see — wrong hrefs that only appear after
// VitePress applies the base path and the locale routes.

const dist = new URL('../apps/docs/.vitepress/dist', import.meta.url).pathname;
if (!existsSync(dist))
  throw new Error(
    'Built site not found; run the docs build before this check.',
  );

// The base path must mirror apps/docs/.vitepress/config.mts.
const repository = process.env.GITHUB_REPOSITORY ?? siteModel().repository;
const project = repository.split('/')[1];
const base =
  process.env.DOCS_BASE ??
  (project.endsWith('.github.io') ? '/' : `/${project}/`);

const pages = new Set();
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith('.html')) pages.add(relative(dist, path));
  }
};
walk(dist);

const has404 = pages.has('404.html');
if (!has404 || !pages.has('index.html'))
  throw new Error('Built site lacks the root page or 404 fallback.');

const { checked, broken } = checkBuiltLinks(
  new Map(
    [...pages].map((file) => [file, readFileSync(join(dist, file), 'utf8')]),
  ),
  base,
  (file) => existsSync(join(dist, file)),
);

if (broken.length) {
  throw new Error(
    `Built-site navigation broken:\n${broken.map((line) => `- ${line}`).join('\n')}`,
  );
}
console.log(
  `Built site navigation verified: ${pages.size - (has404 ? 1 : 0)} pages, ${checked.size} distinct internal targets resolve under base ${base}.`,
);
