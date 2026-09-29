#!/usr/bin/env node
// Add a shipped-but-unregistered example back to the assembled app — the
// mechanical inverse of scripts/example-remove.mjs, under the same marker
// contract (UI-R5). Each example that ships unregistered declares its
// registration blocks and anchors in examples/<id>/registration.mjs; this
// script splices them in, refusing anything it cannot do mechanically and
// writing only after every block has verified.
//
// Usage: node scripts/example-add.mjs --example notes [--root <dir>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    example: { type: 'string' },
    root: { type: 'string', default: scriptRoot },
  },
});
if (!values.example) {
  console.error(
    'usage: node scripts/example-add.mjs --example <id> [--root <dir>]',
  );
  process.exit(1);
}
const root = resolve(values.root);
const manifestPath = join(root, 'examples', values.example, 'manifest.json');
const templatePath = join(root, 'examples', values.example, 'registration.mjs');
for (const path of [manifestPath, templatePath])
  if (!existsSync(path)) {
    console.error(`missing: ${path}`);
    process.exit(1);
  }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.status !== 'active') {
  console.error(`${values.example} is not active; nothing to register.`);
  process.exit(1);
}

// Same clean-copy policy as the removal tool: it only edits clean copies.
const gitStatus = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
});
if (gitStatus.trim() !== '') {
  console.error(
    'refusing to edit a copy with uncommitted changes; commit or stash first',
  );
  process.exit(1);
}

const { default: template } = await import(
  `file://${join(root, 'examples', values.example, 'registration.mjs')}`
);
const problems = [];
const edits = [];
for (const [file, blocks] of Object.entries(template)) {
  const path = join(root, file);
  if (!existsSync(path)) {
    problems.push(`composition point is missing: ${file}`);
    continue;
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const block of blocks) {
    const startToken = `example:${manifest.markerPrefix}:${block.marker}:start`;
    const endToken = `example:${manifest.markerPrefix}:${block.marker}:end`;
    // Idempotence guard: a registered example must not be added twice.
    if (
      lines.some((line) => line.includes(startToken) || line.includes(endToken))
    ) {
      problems.push(`${file} already carries ${startToken}`);
      continue;
    }
    for (const token of [startToken, endToken])
      if (block.text.split(token).length - 1 !== 1)
        problems.push(
          `${file}: ${block.marker} text must contain ${token} exactly once`,
        );
    const inserted = insertInto(lines, block, startToken, endToken, file);
    if (inserted) edits.push({ path, content: inserted });
  }
}
if (problems.length > 0) {
  console.error(
    `refusing to add the example; resolve these first:\n${problems
      .map((problem) => `- ${problem}`)
      .join('\n')}`,
  );
  process.exit(1);
}
for (const { path, content } of edits)
  writeFileSync(path, `${content.join('\n')}\n`);
console.log(`added ${values.example} to ${edits.length} composition point(s)`);

// Insert the block before/after the anchor line. Anchors must match
// exactly one line so the result never depends on tool or edit order.
function insertInto(lines, block, startToken, endToken, file) {
  let at;
  if (block.afterLastMatch !== undefined) {
    const pattern = new RegExp(block.afterLastMatch);
    at = findLastIndex(lines, (line) => pattern.test(line)) + 1;
  } else if (block.beforeLine !== undefined) {
    const index = lines.indexOf(block.beforeLine);
    if (index >= 0 && lines.indexOf(block.beforeLine, index + 1) >= 0) {
      problems.push(
        `${file}: anchor "${block.beforeLine}" for ${block.marker} is ambiguous`,
      );
      return null;
    }
    at = index;
  } else {
    problems.push(
      `${file}: ${block.marker} needs afterLastMatch or beforeLine`,
    );
    return null;
  }
  if (at <= 0) {
    problems.push(`${file}: anchor for ${block.marker} matched no line`);
    return null;
  }
  const text = block.text.split('\n');
  lines.splice(at, 0, ...text);
  // Mirror the removal tool's junction rule: never leave a doubled blank
  // line where the block met its neighbours.
  if (lines[at - 1]?.trim() === '' && lines[at + text.length]?.trim() === '')
    lines.splice(at + text.length, 1);
  return lines;
}

function findLastIndex(lines, predicate) {
  for (let i = lines.length - 1; i >= 0; i--) if (predicate(lines[i])) return i;
  return -1;
}
