import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
// scaffold:examples:imports:start
import { existsSync, statSync } from 'node:fs';
// scaffold:examples:imports:end
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
// scaffold:examples:manifest-imports:start
import {
  listExampleIds,
  loadExampleManifest,
  retainedHistoryPaths,
  verifyExampleManifests,
} from './lib/example-remove.mjs';
// scaffold:examples:manifest-imports:end
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
let composition = new Set();
// scaffold:examples:composition:start
// Every registered example contributes its composition points and owned
// paths; only active ones still own code. The union drives the checks that
// follow, so a second example tightens the rules instead of loosening them.
const examples = listExampleIds(root).map((exampleId) => ({
  id: exampleId,
  manifest: loadExampleManifest(root, exampleId),
}));
const activeExamples = examples.filter(
  ({ manifest }) => manifest.status === 'active',
);
composition = new Set(
  activeExamples.flatMap(({ manifest }) =>
    Object.values(manifest.compositionPoints ?? {}).map((path) =>
      resolve(root, path),
    ),
  ),
);
// scaffold:examples:composition:end
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
// A removed example may keep its migration files as history (manifest
// retainedMigrations); its tables outlive the code there, so exactly those
// files are exempt from ownership. Everything else still needs an owner.
const retainedHistory = new Set();
// scaffold:examples:history:start
for (const { manifest } of examples)
  for (const path of retainedHistoryPaths(manifest)) retainedHistory.add(path);
// scaffold:examples:history:end
for (const path of files(join(root, 'migrations'), /\.sql$/)) {
  if (retainedHistory.has(relative(root, path))) continue;
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
// scaffold:examples:isolation:start
verifyExampleManifests(root);

// Example isolation inside the frontend composition (docs/ui/design.md
// §4.1): example-owned code may only be imported by its own example or by
// the registered composition points; examples never import each other —
// neither directly nor through the shared views barrel — and shell/Core
// code never imports an example directly.
// The barrel re-exports every registered example's public symbols next to
// the shell's, so map each exported name back to its owning example.
const barrelExampleSymbols = new Map();
const viewsIndexPath = resolve(root, 'packages/views/src/index.ts');
const viewsIndexSource = existsSync(viewsIndexPath)
  ? readFileSync(viewsIndexPath, 'utf8')
  : '';
for (const { id, manifest } of activeExamples) {
  const prefix = manifest.markerPrefix;
  const block = viewsIndexSource.match(
    new RegExp(
      `// example:${prefix}:views:start([\\s\\S]*?)// example:${prefix}:views:end`,
    ),
  );
  if (!block) continue;
  for (const [, names] of block[1].matchAll(
    /export(?:\s+type)?\s*\{([^}]*)\}/g,
  ))
    for (const raw of names.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (!name) continue;
      if (barrelExampleSymbols.has(name))
        throw new Error(
          `views barrel exports ${name} for more than one example`,
        );
      barrelExampleSymbols.set(name, id);
    }
}
const frontendRoots = ['packages/views/src', 'apps/web/src'];
const ownedExamplePaths = activeExamples.flatMap(({ id, manifest }) =>
  manifest.ownedPaths
    .filter((path) => frontendRoots.some((base) => path.startsWith(base)))
    .map((path) => ({ exampleId: id, absolute: resolve(root, path) })),
);
const ownerOf = (path) =>
  ownedExamplePaths.find(
    ({ absolute }) => path === absolute || path.startsWith(absolute + sep),
  )?.exampleId ?? null;
function resolveRelativeImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}
for (const frontendRoot of frontendRoots) {
  for (const path of files(join(root, frontendRoot))) {
    const importer = ownerOf(path);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith('.') &&
        !composition.has(path)
      ) {
        const target = resolveRelativeImport(path, node.moduleSpecifier.text);
        const owned = target && ownerOf(target);
        if (owned && owned !== importer)
          throw new Error(
            `${importer ?? 'shell/Core code'} imports example ${owned}: ${path}`,
          );
      }
      if (
        importer &&
        !composition.has(path) &&
        ts.isImportDeclaration(node) &&
        node.importClause &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        const isViewsBarrel =
          specifier === '@saas/views' ||
          (specifier.startsWith('.') &&
            resolveRelativeImport(path, specifier) === viewsIndexPath);
        if (isViewsBarrel) {
          const bindings = node.importClause.namedBindings;
          const names =
            bindings && ts.isNamedImports(bindings)
              ? bindings.elements.map(
                  (binding) => (binding.propertyName ?? binding.name).text,
                )
              : null;
          if (names === null)
            throw new Error(
              `${importer} imports the views barrel wholesale: ${path}`,
            );
          for (const name of names) {
            const owner = barrelExampleSymbols.get(name);
            if (owner && owner !== importer)
              throw new Error(
                `${importer} reaches example ${owner} through the views barrel (${name}): ${path}`,
              );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
// scaffold:examples:isolation:end
console.log(
  `Package imports and ${modules.length} Rust module ownership declarations verified. Dynamic SQL still requires review.`,
);
