#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  checkRemovalSafety,
  planExampleRemoval,
  removeExample,
} from './lib/example-remove.mjs';
import { resolveRoot, root } from './lib/process.mjs';

// Remove the knowledge example from a clean template working copy, exactly
// as registered in examples/knowledge-base/manifest.json. Databases,
// buckets and secrets are never touched, and migration history is kept
// unless a fresh copy explicitly opts into trimming.
//
//   just example-remove --dry-run
//   just example-remove
//   just example-remove --trim-migrations        # fresh copies only
//   node scripts/example-remove.mjs --root /tmp/my-copy
//
// After a real removal the derived artifacts are regenerated in place and
// `just check-core` plus `just docs-build` verify the Core-only product.

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'trim-migrations': { type: 'boolean', default: false },
    root: { type: 'string', default: root },
  },
});
const target = resolveRoot(values.root);
const options = { trimMigrations: values['trim-migrations'], root: target };

if (values['dry-run']) {
  const plan = planExampleRemoval(target, {
    trimMigrations: values['trim-migrations'],
  });
  const { problems } = checkRemovalSafety(target, plan);
  console.log(
    [
      'Example removal plan (dry run, nothing was written):',
      `- owned paths to delete (${plan.delete.length}):`,
      ...plan.delete.map((path) => `    - ${path}`),
      `- marker blocks to remove (${plan.edits.length} files):`,
      ...plan.edits.map(
        (edit) => `    - ${edit.file}: ${edit.markers.join(', ')}`,
      ),
      `- documentation pages to drop from docs/site.json (${plan.navigation.removeSources.length}):`,
      ...plan.navigation.removeSources.map((path) => `    - ${path}`),
      `- migrations: ${
        plan.migrations.trim.length > 0
          ? `trimming ${plan.migrations.trim.join(', ')} (--trim-migrations, fresh copies only)`
          : `keeping ${plan.migrations.kept.join(', ')} (history stays; use --trim-migrations on a fresh copy)`
      }`,
      `- owned dependencies to strip: ${plan.dependencies
        .map((entry) => `${entry.file} (${entry.remove.join(', ')})`)
        .join('; ')}`,
      `- owned cargo dependencies to strip: ${plan.cargoDependencies
        .map((entry) => `${entry.file} (${entry.remove.join(', ')})`)
        .join('; ')}`,
      '- manifest examples/knowledge-base/manifest.json -> status: removed',
      '- regenerate: pnpm install, cargo update --workspace, pnpm generate, project-docs references',
      problems.length > 0
        ? `protection: applying now would refuse:\n${problems
            .map((problem) => `  - [${problem.subject}] ${problem.detail}`)
            .join('\n')}`
        : 'protection: the copy is removable as registered',
    ].join('\n'),
  );
} else {
  const { plan, summary } = removeExample(target, options);
  console.log(
    [
      'Example removed:',
      `- the manifest now reads status: removed and the derived artifacts were regenerated (${summary.regenerated.length} commands)`,
      '- verify the Core-only product with: just check-core && just docs-build',
      plan.migrations.kept.length > 0
        ? `- migration history was kept and recorded in the manifest (${plan.migrations.kept.join(', ')}); a fresh database can adopt the trimmed path (see docs/tutorials/23-example-removal.md)`
        : '- example migrations were trimmed; this copy initializes a fresh database (see docs/tutorials/23-example-removal.md)',
    ].join('\n'),
  );
}
