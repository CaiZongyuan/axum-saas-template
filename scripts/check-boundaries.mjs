import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { root } from './lib/process.mjs';

const metadata = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1', '--locked'],
    { cwd: root, encoding: 'utf8' },
  ),
);
const platform = metadata.packages.find((pkg) => pkg.name === 'saas-platform');
if (platform.dependencies.some((dep) => dep.name === 'saas-app'))
  throw new Error('Platform must not depend on app');
const allowed = {
  contracts: [],
  sdk: ['@saas/contracts'],
  core: ['@saas/contracts'],
  ui: [],
  views: ['@saas/contracts', '@saas/sdk', '@saas/core', '@saas/ui'],
};
function files(directory, extension = /\.(ts|tsx)$/) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path, extension)
      : extension.test(path) && !path.includes('.test.')
        ? [path]
        : [];
  });
}
const example = JSON.parse(
  readFileSync(join(root, 'examples/knowledge-base/manifest.json'), 'utf8'),
);
const composition = new Set(
  Object.values(example.compositionPoints).map((path) => resolve(root, path)),
);
const modulesRoot = join(root, 'crates/app/src/modules');
const modules = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const directory = join(modulesRoot, entry.name);
    const description = JSON.parse(
      readFileSync(join(directory, 'module.json'), 'utf8'),
    );
    return { ...description, name: entry.name, directory };
  });
const references = modules.filter((module) => module.kind === 'reference');
const tableOwners = new Map();
for (const module of modules) {
  for (const table of module.tables) {
    if (tableOwners.has(table))
      throw new Error(`Duplicate table ownership: ${table}`);
    tableOwners.set(table, module.name);
  }
}
for (const path of files(join(root, 'migrations'), /\.sql$/)) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
  )) {
    if (!tableOwners.has(match[1]))
      throw new Error(
        `Migration creates an unowned table ${match[1]}: ${path}`,
      );
  }
}
for (const module of modules) {
  for (const path of files(module.directory, /\.rs$/)) {
    const source = readFileSync(path, 'utf8');
    const literals = source.match(/"(?:\\.|[^"\\])*"/gs) ?? [];
    for (const literal of literals.filter((text) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(text),
    )) {
      for (const [table, owner] of tableOwners) {
        if (
          new RegExp(`\\b${table.replaceAll('.', '\\.')}\\b`).test(literal) &&
          owner !== module.name
        )
          throw new Error(
            `${module.name} reads/writes ${owner}'s table ${table}: ${path}`,
          );
      }
    }
    const code = source
      .replace(/"(?:\\.|[^"\\])*"/gs, '""')
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    if (module.kind === 'core') {
      for (const reference of references) {
        if (
          new RegExp(
            `\\b(?:use[^;]*|(?:crate|super|self)::(?:modules::)?)\\b${reference.name}\\b`,
          ).test(code)
        )
          throw new Error(
            `Core imports reference module ${reference.name}: ${path}`,
          );
      }
    }
    if (
      path.endsWith('/domain.rs') &&
      /\b(axum|sqlx|redis|aws_sdk_s3|opentelemetry)::/.test(code)
    )
      throw new Error(`Pure Domain imports infrastructure: ${path}`);
  }
}
for (const [name, dependencies] of Object.entries(allowed)) {
  const directory = join(root, 'packages', name);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const dependency of Object.keys({
    ...pkg.dependencies,
    ...pkg.peerDependencies,
  })) {
    if (dependency.startsWith('@saas/') && !dependencies.includes(dependency))
      throw new Error(`${pkg.name} cannot depend on ${dependency}`);
  }
  for (const path of files(join(directory, 'src'))) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const dependency = node.moduleSpecifier.text;
        const internal = dependency.startsWith('@saas/')
          ? dependency.split('/').slice(0, 2).join('/')
          : null;
        if (
          internal &&
          internal !== pkg.name &&
          !dependencies.includes(internal)
        )
          throw new Error(
            `${pkg.name} imports forbidden package ${internal}: ${path}`,
          );
        for (const reference of references) {
          const viewRoot = resolve(root, reference.viewPath);
          const isReference = path.startsWith(viewRoot + sep);
          if (
            !isReference &&
            !composition.has(path) &&
            !path.includes(`${sep}generated${sep}`)
          ) {
            const target = dependency.startsWith('.')
              ? resolve(dirname(path), dependency)
              : '';
            if (target === viewRoot || target.startsWith(viewRoot + sep))
              throw new Error(`Core imports reference Views: ${path}`);
            if (
              ['@saas/contracts', '@saas/sdk'].includes(dependency) &&
              ts.isImportDeclaration(node) &&
              node.importClause?.namedBindings
            ) {
              const bindings = node.importClause.namedBindings;
              if (
                ts.isNamedImports(bindings) &&
                bindings.elements.some((binding) =>
                  reference.contractSymbols.includes(
                    (binding.propertyName ?? binding.name).text,
                  ),
                )
              )
                throw new Error(`Core imports a reference contract: ${path}`);
            }
          }
        }
        if (
          name === 'core' &&
          /^(react|react-dom|react-native|electron)(\/|$)/.test(dependency)
        )
          throw new Error(`Core must be platform independent: ${path}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
for (const path of [
  ...example.ownedPaths,
  ...Object.values(example.compositionPoints),
])
  if (!existsSync(join(root, path)))
    throw new Error(`Invalid example manifest path: ${path}`);
for (const [path, markers] of Object.entries(
  example.registrationMarkers ?? {},
)) {
  const source = readFileSync(join(root, path), 'utf8');
  for (const marker of markers) {
    const start = `example:knowledge:${marker}:start`;
    const end = `example:knowledge:${marker}:end`;
    if (
      source.split(start).length !== 2 ||
      source.split(end).length !== 2 ||
      source.indexOf(start) >= source.indexOf(end)
    )
      throw new Error(`Invalid example registration marker ${marker}: ${path}`);
  }
}
console.log(
  `Package imports, ${modules.length} Rust module ownership declarations and example composition points verified. Dynamic SQL still requires review.`,
);
