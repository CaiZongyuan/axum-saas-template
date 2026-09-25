import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.(ts|tsx)$/.test(path) && !path.includes('.test.')
        ? [path]
        : [];
  });
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
const example = JSON.parse(
  readFileSync(join(root, 'examples/knowledge-base/manifest.json'), 'utf8'),
);
for (const path of [
  ...example.ownedPaths,
  ...Object.values(example.compositionPoints),
])
  if (!existsSync(join(root, path)))
    throw new Error(`Invalid example manifest path: ${path}`);
console.log(
  'Core package dependency directions and example composition points verified. SQL ownership checks grow with domain modules.',
);
