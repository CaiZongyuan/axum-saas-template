import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { markdownTokens } from './docs-content.mjs';
import { root } from './process.mjs';

export function commandRegistry({
  rootDirectory = root,
  just,
  workspaces,
} = {}) {
  just ??= JSON.parse(
    execFileSync('just', ['--dump', '--dump-format', 'json'], {
      cwd: rootDirectory,
      encoding: 'utf8',
    }),
  );
  workspaces ??= JSON.parse(
    execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
      cwd: rootDirectory,
      encoding: 'utf8',
    }),
  );
  const manifest = (directory) =>
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const rootPackage = manifest(rootDirectory);
  const packages = new Map();
  for (const workspace of workspaces) {
    const packageJson = manifest(workspace.path);
    packages.set(
      packageJson.name,
      new Set(Object.keys(packageJson.scripts ?? {})),
    );
  }
  return {
    recipes: new Set([
      ...Object.keys(just.recipes ?? {}),
      ...Object.keys(just.aliases ?? {}),
    ]),
    scripts: new Set(Object.keys(rootPackage.scripts ?? {})),
    packages,
    hasNodeScript(file) {
      const directory = resolve(rootDirectory, 'scripts') + sep;
      const path = resolve(rootDirectory, file);
      return (
        path.startsWith(directory) &&
        existsSync(path) &&
        statSync(path).isFile()
      );
    },
  };
}

// This recognizes literal simple calls, not a shell AST. Expansions stay opaque;
// compound shell execution, argument validity and external tools are outside its scope.
function shellWords(source) {
  const tokens = [];
  let word = '',
    active = false,
    literal = true,
    quote = null;
  const flush = () => {
    if (active) tokens.push({ value: word, literal });
    word = '';
    active = false;
    literal = true;
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\' && quote !== "'") {
      active = true;
      word += source[++index] ?? '';
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else {
        word += character;
        if (quote !== "'" && character === '$') literal = false;
      }
      continue;
    }
    if (
      character === '"' ||
      character === "'" ||
      character.charCodeAt(0) === 96
    ) {
      quote = character;
      active = true;
      if (character.charCodeAt(0) === 96) literal = false;
      continue;
    }
    if (character === '$' && source[index + 1] === '(') {
      let depth = 1,
        nestedQuote = null,
        end = index + 2;
      for (; end < source.length && depth; end++) {
        const next = source[end];
        if (next === '\\') {
          end++;
          continue;
        }
        if (nestedQuote) {
          if (next === nestedQuote) nestedQuote = null;
          continue;
        }
        if (next === '"' || next === "'") {
          nestedQuote = next;
          continue;
        }
        if (next === '(') depth++;
        if (next === ')') depth--;
      }
      if (depth) return null;
      word += source.slice(index, end);
      active = true;
      literal = false;
      index = end - 1;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (character === '#' && !active) break;
    if (';&|'.includes(character)) {
      flush();
      let operator = character;
      if (source[index + 1] === character) operator += source[++index];
      tokens.push({ value: operator, operator: true });
      continue;
    }
    if (source.startsWith('<<', index) && !source.startsWith('<<<', index)) {
      flush();
      const operator = source[index + 2] === '-' ? '<<-' : '<<';
      tokens.push({ value: operator, operator: true });
      index += operator.length - 1;
      continue;
    }
    active = true;
    word += character;
    if ('$*?'.includes(character)) literal = false;
  }
  if (quote) return null;
  flush();
  return tokens;
}

function* simpleCommands(content) {
  const lines = content.split('\n');
  const heredocs = [];
  let pending = '',
    start = 0;
  for (const [index, line] of lines.entries()) {
    if (heredocs.length) {
      const delimiter = heredocs[0];
      if (
        (delimiter.tabs ? line.replace(/^\t+/, '') : line) === delimiter.value
      )
        heredocs.shift();
      continue;
    }
    if (!pending) start = index;
    if (/(?<!\\)\\$/.test(line)) {
      pending += line.slice(0, -1) + ' ';
      continue;
    }
    const tokens = shellWords(pending + line);
    if (!tokens) {
      pending += line + '\n';
      continue;
    }
    pending = '';
    for (let at = 0; at < tokens.length; at++)
      if (
        tokens[at].operator &&
        ['<<', '<<-'].includes(tokens[at].value) &&
        tokens[at + 1]
      )
        heredocs.push({
          value: tokens[at + 1].value,
          tabs: tokens[at].value === '<<-',
        });
    let command = [];
    for (const token of tokens) {
      if (token.operator && [';', '&', '&&', '|', '||'].includes(token.value)) {
        if (command.length) yield { words: command, line: start };
        command = [];
      } else command.push(token);
    }
    if (command.length) yield { words: command, line: start };
  }
}

const pnpmBuiltins = new Set([
  'add',
  'install',
  'i',
  'remove',
  'rm',
  'uninstall',
  'update',
  'up',
  'exec',
  'dlx',
  'list',
  'ls',
  'why',
  'help',
  'config',
  'store',
  'import',
  'publish',
  'pack',
  'audit',
  'outdated',
  'prune',
  'patch',
  'patch-commit',
]);
const justOptionValues = new Map([
  ['--set', 2],
  ['--shell', 1],
  ['--shell-arg', 1],
  ['--working-directory', 1],
  ['--dump-format', 1],
  ['--group', 1],
  ['--jobs', 1],
]);

function validateCall(words, registry, fail) {
  let at = 0;
  if (words[at]?.value === 'env') at++;
  while (/^[A-Za-z_]\w*=/.test(words[at]?.value ?? '')) at++;
  const program = words[at++];
  if (!program?.literal) return null;
  if (program.value === 'just') {
    while (words[at]?.value.startsWith('-')) {
      const option = words[at++].value;
      if (
        [
          '-f',
          '--justfile',
          '--global-justfile',
          '-g',
          '--command',
          '-c',
        ].includes(option)
      )
        return null;
      at += justOptionValues.get(option) ?? 0;
    }
    while (/^[A-Za-z_]\w*=/.test(words[at]?.value ?? '')) at++;
    const recipe = words[at];
    if (!recipe?.literal) return null;
    if (!registry.recipes.has(recipe.value))
      fail('Unknown just recipe: ' + recipe.value);
    return 'just';
  }
  if (program.value === 'pnpm') {
    let filter = null;
    while (words[at]?.value.startsWith('-')) {
      const option = words[at++];
      if (option.value === '--filter') filter = words[at++];
      else if (option.value.startsWith('--filter='))
        filter = {
          value: option.value.slice('--filter='.length),
          literal: option.literal,
        };
      else if (
        ['-C', '--dir', '-r', '--recursive', '-w', '--workspace-root'].includes(
          option.value,
        )
      )
        return null;
    }
    const explicitRun = words[at]?.value === 'run';
    const command = words[at + (explicitRun ? 1 : 0)];
    if (!command?.literal || (filter && !filter.literal)) return null;
    const scripts = filter
      ? registry.packages.get(filter.value)
      : registry.scripts;
    if (!scripts) fail('Unknown pnpm workspace: ' + filter.value);
    if (!explicitRun && pnpmBuiltins.has(command.value)) return null;
    if (!scripts.has(command.value))
      fail(
        'Unknown pnpm script in ' +
          (filter?.value ?? 'root') +
          ': ' +
          command.value,
      );
    return 'pnpm';
  }
  if (program.value === 'node') {
    while (words[at]?.value.startsWith('-')) {
      const option = words[at++].value;
      if (['-e', '--eval', '-p', '--print', '-c', '--check'].includes(option))
        return null;
      if (
        [
          '--require',
          '-r',
          '--loader',
          '--experimental-loader',
          '--import',
          '--input-type',
        ].includes(option)
      )
        at++;
    }
    const file = words[at];
    if (!file?.literal || !/^(?:\.\/)?scripts\/.*\.mjs$/.test(file.value))
      return null;
    if (!registry.hasNodeScript(file.value))
      fail('Missing Node script: ' + file.value);
    return 'node';
  }
  return null;
}

export function validateDocumentCommands(content, route, registry) {
  const checked = { just: 0, pnpm: 0, node: 0 };
  for (const token of markdownTokens(content)) {
    if (
      token.type !== 'fence' ||
      !['bash', 'sh', 'shell'].includes(token.info.split(/\s/)[0])
    )
      continue;
    for (const command of simpleCommands(token.content)) {
      const fail = (message) => {
        throw new Error(
          route + ':' + (token.map[0] + command.line + 2) + ': ' + message,
        );
      };
      const type = validateCall(command.words, registry, fail);
      if (type) checked[type]++;
    }
  }
  return checked;
}
