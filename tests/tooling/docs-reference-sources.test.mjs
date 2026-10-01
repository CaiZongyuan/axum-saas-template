import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { markdownTokens } from '../../scripts/lib/docs-content.mjs';
import { root } from '../../scripts/lib/process.mjs';

function symbolLinks(sourcePath) {
  const links = [];
  for (const block of markdownTokens(readFileSync(sourcePath, 'utf8'))) {
    const tokens = block.children ?? [];
    for (const [index, token] of tokens.entries()) {
      const href = token.attrGet('href');
      if (
        token.type !== 'link_open' ||
        !href?.endsWith('.rs') ||
        tokens[index + 1]?.type !== 'code_inline'
      )
        continue;
      links.push({
        path: resolve(dirname(sourcePath), href),
        name: tokens[index + 1].content,
      });
    }
  }
  return links;
}

test('both Rust integration maps link current public declarations', () => {
  const zh = symbolLinks(resolve(root, 'docs/reference/rust.md'));
  const en = symbolLinks(resolve(root, 'docs/reference/rust.en.md'));
  assert.deepEqual(zh, en);
  assert.ok(zh.length > 20, 'the map covers actual Core integration entries');
  for (const { path, name } of zh) {
    const source = readFileSync(path, 'utf8');
    const declaration = new RegExp(
      `pub (?:async )?(?:fn|struct|enum|trait) ${name}\\b`,
    );
    assert.match(
      source,
      declaration,
      `${name} no longer exists as a public declaration in ${path}`,
    );
  }
});

test('both error references link stable codes that still exist in their declared sources', () => {
  const zh = symbolLinks(resolve(root, 'docs/reference/errors.md')).filter(
    ({ name }) => name.includes('.'),
  );
  const en = symbolLinks(resolve(root, 'docs/reference/errors.en.md')).filter(
    ({ name }) => name.includes('.'),
  );
  assert.deepEqual(zh, en);
  assert.ok(zh.length > 20);
  for (const { path, name } of zh)
    assert.ok(
      readFileSync(path, 'utf8').includes(JSON.stringify(name)),
      `stable error code ${name} disappeared from ${path}`,
    );
});

test('reference source links all point at current repository files', () => {
  for (const name of ['rust', 'commands', 'errors', 'configuration-sources'])
    for (const suffix of ['.md', '.en.md']) {
      const sourcePath = resolve(root, `docs/reference/${name}${suffix}`);
      for (const block of markdownTokens(readFileSync(sourcePath, 'utf8')))
        for (const token of block.children ?? []) {
          const href = token.attrGet('href');
          if (token.type !== 'link_open' || !href || /^(?:\w+:|#)/.test(href))
            continue;
          assert.ok(
            existsSync(resolve(dirname(sourcePath), href.split('#')[0])),
            `${name}${suffix} links missing ${href}`,
          );
        }
    }
});
