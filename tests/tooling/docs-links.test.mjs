import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBuiltLinks } from '../../scripts/lib/docs-links.mjs';

const page = (body, counterpart) =>
  `<a href="${counterpart}" class="docs-locale-link">language</a>${body}`;
test('built links validate encoded localized anchors, same-page links, downloads and bases', () => {
  const pages = new Map([
    [
      'index.html',
      page(
        '<a href="guide#%E7%BB%93%E6%9E%9C">guide</a><a href="openapi.json">download</a>',
        '/custom/en/',
      ),
    ],
    [
      'guide.html',
      page(
        '<h2 id="结果">result</h2><a href="#%E7%BB%93%E6%9E%9C">local</a><a href="/custom/">home</a>',
        '/custom/en/',
      ),
    ],
    [
      'en/index.html',
      page('<a href="../guide#结果">Chinese guide</a>', '/custom/'),
    ],
  ]);
  assert.deepEqual(
    checkBuiltLinks(pages, '/custom/', (file) => file === 'openapi.json')
      .broken,
    [],
  );
  pages.set('guide.html', page('<a href="#missing">broken</a>', '/custom/en/'));
  assert.match(
    checkBuiltLinks(
      pages,
      '/custom/',
      (file) => file === 'openapi.json',
    ).broken.join('\n'),
    /missing anchor guide.html#missing/,
  );
});

test('links outside deployment base and missing page targets are rejected', () => {
  const pages = new Map([
    [
      'index.html',
      page(
        '<a href="/guide">outside</a><a href="missing">missing</a>',
        '/custom/',
      ),
    ],
  ]);
  const { broken } = checkBuiltLinks(pages, '/custom/', () => false);
  assert.match(broken.join('\n'), /outside base \/custom\//);
  assert.match(broken.join('\n'), /missing missing.html/);
});
