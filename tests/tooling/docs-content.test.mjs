import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  expandMarkdownSnippets,
  transformMarkdownLinks,
  validateMarkdownContent,
} from '../../scripts/lib/docs-content.mjs';

test('Markdown destinations are parsed without rewriting code examples', () => {
  const source =
    '# Links\n\n[real](guide(with-parentheses).md "title") and `[example](fake.md)`\n\n```md\n[example](fake.md)\n<<< fake.rs\n```\n\n- [list](list.md#part)\n\n> ![image](image.png)\n\n| Link |\n| --- |\n| [table](table.md) |\n\n[ref][r]\n\n[r]: <reference.md> "title"\n';
  const targets = [];
  const rendered = transformMarkdownLinks(source, (href) => {
    targets.push(href);
    return `published/${href}`;
  });
  assert.deepEqual(targets, [
    'guide(with-parentheses).md',
    'list.md#part',
    'image.png',
    'table.md',
    'reference.md',
  ]);
  assert.match(rendered, /guide\(with-parentheses\)\.md "title"/);
  assert.match(rendered, /`\[example\]\(fake.md\)`/);
  assert.match(rendered, /\[r\]: <published\/reference.md>/);
  assert.doesNotMatch(rendered, /published\/fake/);
});

test('source regions and full files expand, including long fences in source', () => {
  const source = '// region:handler\nfn handler() {}\n// endregion:handler\n';
  const rendered = expandMarkdownSnippets(
    '<<< ticket.rs#handler\n\n```md\n<<< fake.rs\n```\n\n<<< ticket.rs',
    () => ({ source, language: 'rust' }),
  );
  assert.match(rendered, /```rust\nfn handler\(\) \{\}\n```/);
  assert.match(rendered, /```md\n<<< fake.rs\n```/);
  assert.match(rendered, /region:handler/);
  assert.throws(
    () =>
      expandMarkdownSnippets('<<< ticket.rs#missing', () => ({
        source,
        language: 'rust',
      })),
    /snippet region: missing/,
  );
  assert.match(
    expandMarkdownSnippets('<<< doc.md', () => ({
      source: '```text\nx\n```',
      language: 'md',
    })),
    /````md/,
  );
});

test('fence validation follows Markdown tokens, including tildes and nested backticks', () => {
  validateMarkdownContent(
    '````md\n```rs\nfn f() {}\n```\n````\n\n~~~sh\ntrue\n~~~',
    'valid.md',
  );
  validateMarkdownContent('> ```md\n> content\n> ```', 'quoted.md');
  assert.throws(
    () => validateMarkdownContent('```rs\nfn f() {}', 'broken.md'),
    /Unclosed code fence in broken.md/,
  );
});
