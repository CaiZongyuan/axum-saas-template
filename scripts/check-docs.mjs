import { renderDocs, siteModel } from './lib/docs.mjs';
import { sitePath } from './lib/docs-locales.mjs';
import { validateMarkdownContent } from './lib/docs-content.mjs';
import {
  commandRegistry,
  validateDocumentCommands,
} from './lib/docs-commands.mjs';

// The documentation check entry: besides fence/snippet integrity of every
// rendered page in both locales, it validates the bilingual contract that
// later chapters inherit — locale route pairing and counterpart
// frontmatter for the language switcher, including the public Landing at
// the site root. The generated site palette is intentionally not checked
// here: it is untracked derived content regenerated before every dev and
// build, so there is no committed file to drift, and its derivation
// contract (every mapped token exists in both tables) is enforced by
// tests/tooling/docs-palette.test.mjs.

const pages = renderDocs();
const site = siteModel();
const commands = commandRegistry();
const commandCounts = { just: 0, pnpm: 0, node: 0 };

const frontmatter = (route) => {
  const match = /^---\n(docLocale: .+)\n(counterpart: .+)\n/.exec(
    pages.get(route) ?? '',
  );
  if (!match)
    throw new Error(`Rendered page ${route} lacks locale frontmatter`);
  return {
    docLocale: match[1].slice('docLocale: '.length).trim(),
    counterpart: match[2].slice('counterpart: '.length).trim(),
  };
};

for (const [route, content] of pages) {
  if (!route.endsWith('.md')) continue;
  validateMarkdownContent(content, route);
  const checked = validateDocumentCommands(content, route, commands);
  for (const type of Object.keys(commandCounts))
    commandCounts[type] += checked[type];
}

for (const chapter of [...site.pages, ...site.references]) {
  if (!chapter.bilingual) {
    const pending = chapter.translation;
    if (!pending)
      throw new Error(`Unregistered translation migration: ${chapter.id}`);
    continue;
  }
  const zh = chapter.route;
  const en = chapter.routeEn;
  const zhMeta = frontmatter(zh);
  const enMeta = frontmatter(en);
  if (zhMeta.docLocale !== 'zh' || enMeta.docLocale !== 'en')
    throw new Error(`Wrong docLocale on the ${chapter.id} chapter pair`);
  if (zhMeta.counterpart !== sitePath(en))
    throw new Error(
      `Language switch of ${zh} must target the same English chapter (${sitePath(en)}), got ${zhMeta.counterpart}`,
    );
  if (enMeta.counterpart !== sitePath(zh))
    throw new Error(
      `Language switch of ${en} must target the same Chinese chapter (${sitePath(zh)}), got ${enMeta.counterpart}`,
    );
}

console.log(
  'Registered literal commands verified: ' +
    Object.entries(commandCounts)
      .map(([type, count]) => type + ' ' + count)
      .join(', ') +
    '.',
);
console.log(
  `Documentation navigation, source links, snippets, locale pairing and generated references verified (${pages.size} files).`,
);
