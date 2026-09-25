import { renderDocs } from './lib/docs.mjs';

const pages = renderDocs();
for (const [route, content] of pages) {
  if (!route.endsWith('.md')) continue;
  const fences = content
    .split('\n')
    .filter((line) => line.startsWith('```')).length;
  if (fences % 2) throw new Error(`Unclosed code fence in ${route}`);
  if (/^<<< /m.test(content)) throw new Error(`Unresolved snippet in ${route}`);
}
console.log(
  `Documentation navigation, source links, snippets and generated references verified (${pages.size} files).`,
);
