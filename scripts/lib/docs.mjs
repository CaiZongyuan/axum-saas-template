import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, posix, relative, resolve, sep } from 'node:path';
import { root } from './process.mjs';
import { sitePath, validateSiteModel } from './docs-locales.mjs';
import {
  expandMarkdownSnippets,
  transformMarkdownLinks,
} from './docs-content.mjs';
import {
  renderApiReference,
  renderConfigReference,
  renderCommandIndex,
} from './docs-references.mjs';

// Renders the public documentation in both locales from one declaration:
//
// - Chinese pages keep their published routes so existing deep links stay
//   valid; English pages mirror them under `en/` for chapters declared
//   bilingual in docs/site.json. Untranslated chapters are registered
//   migration items and appear in the Chinese navigation only.
// - Every generated page carries frontmatter (`docLocale` + `counterpart`)
//   so the site language switcher can land on the same chapter; chapters
//   without a translation fall back to the English documentation entry
//   instead of pretending one exists.
// - The API and configuration references are synthesized from the OpenAPI
//   contract and the Rust settings in both languages; operation ids, keys
//   and defaults stay the single facts they are generated from.

export function siteModel() {
  return validateSiteModel(
    JSON.parse(readFileSync(resolve(root, 'docs/site.json'), 'utf8')),
  );
}

function repositoryFile(source) {
  const absolute = resolve(root, source);
  if (!absolute.startsWith(root + sep) || !existsSync(absolute))
    throw new Error(
      `Missing/outside-repository documentation target: ${source}`,
    );
  return absolute;
}

const SNIPPET_LANGUAGES = {
  '.rs': 'rust',
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.mjs': 'js',
  '.sql': 'sql',
  '.json': 'json',
  '.toml': 'toml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'sh',
  '.md': 'md',
};

// The other-locale path of a route, used by the language switcher.
// Untranslated chapters point at the English documentation entry instead
// of a page that does not exist.
function counterpartPath(route, locale, routePairs) {
  if (locale === 'zh') {
    const pair = routePairs.get(route);
    return pair?.en ? sitePath(pair.en) : '/en/docs/';
  }
  const zh = [...routePairs.entries()].find(([, value]) => value.en === route);
  return zh ? sitePath(zh[0]) : '/docs/';
}

// Page frontmatter: the locale pairing always, plus the layout page's own
// meta (declared per chapter in docs/site.json) so the Landing and the
// Coming soon pages carry honest titles and descriptions in both locales.
// `sidebar: false` is required beside `layout: page`: this VitePress
// version only drops the sidebar column for `layout: home` otherwise.
function frontmatter(docLocale, counterpart, page = {}, navigation = {}) {
  const lines = [`docLocale: ${docLocale}`, `counterpart: ${counterpart}`];
  lines.push(`contentType: ${page.type ?? 'reference'}`);
  lines.push(`prev: ${JSON.stringify(navigation.previous ?? false)}`);
  lines.push(`next: ${JSON.stringify(navigation.next ?? false)}`);
  if (page.layout !== undefined) {
    lines.push(`layout: ${page.layout}`, 'sidebar: false');
  }
  const title = docLocale === 'en' ? page.pageTitleEn : page.pageTitle;
  const description =
    docLocale === 'en' ? page.pageDescriptionEn : page.pageDescription;
  if (title !== undefined) lines.push(`title: "${title}"`);
  if (description !== undefined) lines.push(`description: "${description}"`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

// Resolves one Markdown link of one rendered page to its published href.
// Links resolve against the repository-relative source directory (the
// English `.en.md` files sit next to their Chinese siblings, so sibling
// links keep resolving to the canonical source). When rendering an English
// page whose destination is bilingual, the English route wins; a missing
// translation falls back to the Chinese page and never fabricates one.
function resolveLink({
  target,
  sourceDir,
  locale,
  currentRoute,
  routes,
  sourceLink,
}) {
  if (/^(https?:|mailto:|#)/.test(target)) return target;
  const [path, fragment] = target.split('#');
  const withFragment = (href) => (fragment ? `${href}#${fragment}` : href);
  if (path.startsWith('site:')) {
    const route = path.slice(5);
    const pair = routes.get(route);
    const destination = pair
      ? locale === 'en'
        ? (pair.en ?? pair.zh)
        : pair.zh
      : undefined;
    if (!destination) throw new Error(`Unknown generated reference: ${route}`);
    return withFragment(crossLocaleHref(destination, locale, currentRoute));
  }
  const destination = relative(
    root,
    repositoryFile(resolve(sourceDir, decodeURIComponent(path))),
  );
  const pair = routes.get(destination);
  const route = pair
    ? locale === 'en'
      ? (pair.en ?? pair.zh)
      : pair.zh
    : undefined;
  if (!route) return withFragment(sourceLink(destination));
  return withFragment(crossLocaleHref(route, locale, currentRoute));
}

// A rendered link stays relative inside its own locale (VitePress resolves
// `.md` links against the source file path, which the `en/` mirror keeps
// aligned). A link that crosses locales — an English reader opening a
// chapter without a translation — uses the site-absolute Chinese path so
// the reader lands on the real page instead of a broken en/ mirror.
function crossLocaleHref(route, locale, currentRoute) {
  const inLocale = locale === 'zh' || route.startsWith('en/');
  return inLocale
    ? posix.relative(posix.dirname(currentRoute), route)
    : sitePath(route);
}

function transformContent({
  sourcePath,
  route,
  locale,
  routes,
  sourceRef,
  sourceLink,
  taskRunner,
}) {
  let content = readFileSync(sourcePath, 'utf8');
  content = content.replace('<!-- generated:task-runner -->', () =>
    renderCommandIndex(taskRunner.just, taskRunner.scripts, locale, sourceLink),
  );
  content = expandMarkdownSnippets(content, (target) => {
    const snippet = repositoryFile(
      relative(root, resolve(dirname(sourcePath), target.trim())),
    );
    const language = SNIPPET_LANGUAGES[extname(snippet)] ?? 'text';
    return { source: readFileSync(snippet, 'utf8'), language };
  });
  content = transformMarkdownLinks(content, (target) =>
    resolveLink({
      target,
      sourceDir: dirname(sourcePath),
      locale,
      currentRoute: route,
      routes,
      sourceLink,
    }),
  );
  const footerLabel = locale === 'en' ? 'Source version' : '源码版本';
  const markdownLabel = locale === 'en' ? 'Page Markdown' : '本页 Markdown';
  content += `\n\n---\n${footerLabel}：\`${sourceRef.slice(0, 12)}\` · [${markdownLabel}](${sourceLink(relative(root, sourcePath))})\n`;
  return content;
}

function loadConfigFields() {
  return JSON.parse(
    execFileSync(
      'cargo',
      [
        'run',
        '--quiet',
        '--locked',
        '-p',
        'saas-api',
        '--bin',
        'config-reference',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
        },
      },
    ),
  );
}

export function renderDocs() {
  const site = siteModel();
  const chapters = new Map(
    [...site.pages, ...site.references].map((page) => [page.id, page]),
  );
  const navigationFor = (page, locale) =>
    Object.fromEntries(
      ['previous', 'next'].map((direction) => {
        const target = chapters.get(page[direction]);
        const english = locale === 'en' && target?.bilingual;
        return [
          direction,
          target
            ? {
                text: english ? target.titleEn : target.title,
                link: sitePath(english ? target.routeEn : target.route),
              }
            : false,
        ];
      }),
    );
  const pages = new Map();
  const put = (route, content) => {
    if (pages.has(route))
      throw new Error(`duplicate rendered documentation route: ${route}`);
    pages.set(route, content);
  };

  const repo = process.env.GITHUB_REPOSITORY ?? site.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('Invalid documentation repository');
  let sourceRef = process.env.DOCS_SOURCE_REF;
  if (!sourceRef) {
    try {
      const repositoryRoot = execFileSync(
        'git',
        ['rev-parse', '--show-toplevel'],
        {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      sourceRef =
        resolve(repositoryRoot) === root
          ? execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: root,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            }).trim()
          : 'main';
    } catch {
      sourceRef = 'main';
    }
  }
  const sourceLink = (source) => {
    repositoryFile(source);
    return `https://github.com/${repo}/blob/${sourceRef}/${source}`;
  };
  const taskRunner = {
    just: JSON.parse(
      execFileSync('just', ['--dump', '--dump-format', 'json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    ),
    scripts: JSON.parse(readFileSync(repositoryFile('package.json'), 'utf8'))
      .scripts,
  };

  // Route tables for the full published set: `routes` maps a repository
  // source path (and each reference route) to its { zh, en } pair so every
  // locale's links resolve against it; `routePairs` indexes the same pairs
  // by Chinese route for counterpart lookup.
  const routes = new Map();
  const routePairs = new Map();
  for (const page of site.pages) {
    if (
      !page.route.endsWith('.md') ||
      page.route.startsWith('/') ||
      page.route.includes('..')
    )
      throw new Error(`Invalid documentation route: ${page.route}`);
    if (page.source === undefined) continue;
    const pair = { zh: page.route, en: page.bilingual ? page.routeEn : null };
    routes.set(page.source, pair);
    if (page.bilingual)
      routes.set(page.sourceEn, { zh: page.route, en: page.routeEn });
    routePairs.set(page.route, pair);
  }
  for (const reference of site.references) {
    const pair = { zh: reference.route, en: reference.routeEn };
    routes.set(reference.route, pair);
    routePairs.set(reference.route, pair);
  }

  for (const page of site.pages) {
    if (page.source === undefined) continue;
    put(
      page.route,
      frontmatter(
        'zh',
        counterpartPath(page.route, 'zh', routePairs),
        page,
        navigationFor(page, 'zh'),
      ) +
        transformContent({
          sourcePath: repositoryFile(page.source),
          route: page.route,
          locale: 'zh',
          routes,
          sourceRef,
          sourceLink,
          taskRunner,
        }),
    );
    if (page.bilingual)
      put(
        page.routeEn,
        frontmatter(
          'en',
          counterpartPath(page.routeEn, 'en', routePairs),
          page,
          navigationFor(page, 'en'),
        ) +
          transformContent({
            sourcePath: repositoryFile(page.sourceEn),
            route: page.routeEn,
            locale: 'en',
            routes,
            sourceRef,
            sourceLink,
            taskRunner,
          }),
      );
  }

  const contractPath = repositoryFile('packages/contracts/openapi.json');
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const fields = loadConfigFields();
  const example = readFileSync(repositoryFile('.env.example'), 'utf8');
  const api = site.references.find((r) => r.id === 'api-reference');
  const config = site.references.find((r) => r.id === 'config-reference');
  for (const locale of ['zh', 'en']) {
    const apiRoute = locale === 'en' ? api.routeEn : api.route;
    const configRoute = locale === 'en' ? config.routeEn : config.route;
    put(
      apiRoute,
      frontmatter(
        locale,
        counterpartPath(apiRoute, locale, routePairs),
        api,
        navigationFor(api, locale),
      ) +
        renderApiReference(contract, locale, {
          downloadHref: posix.relative(posix.dirname(apiRoute), 'openapi.json'),
          sourceLink,
        }),
    );
    put(
      configRoute,
      frontmatter(
        locale,
        counterpartPath(configRoute, locale, routePairs),
        config,
        navigationFor(config, locale),
      ) + renderConfigReference(fields, example, locale, sourceLink),
    );
  }
  put('public/openapi.json', readFileSync(contractPath, 'utf8'));

  for (const page of [...site.pages, ...site.references])
    if (!pages.has(page.route) || (page.bilingual && !pages.has(page.routeEn)))
      throw new Error(`Navigation points at a missing page: ${page.route}`);
  return pages;
}
