import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Removal of a registered example from a template working copy, driven by
// its ownership manifest (examples/<id>/manifest.json) instead of filename
// guesses. The tool deletes what the example owns, removes the
// registration markers at the composition points, trims the documentation
// navigation and regenerates the derived artifacts. Migration history is
// preserved unless a fresh copy explicitly asks for trimming; the kept
// files are recorded as retained history so the table-ownership checker
// still passes. A copy with uncommitted changes or restructured markers is
// refused, never force-overwritten. Databases, buckets and secrets are
// never touched.

export const manifestPathFor = (exampleId) =>
  join('examples', exampleId, 'manifest.json');

// Every example registered in the template, by manifest directory. Returns
// [] when the examples/ directory itself is gone (fully stripped copies).
export function listExampleIds(root) {
  const directory = join(root, 'examples');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(directory, entry.name, 'manifest.json')))
    .map((entry) => entry.name);
}

export function loadExampleManifest(root, exampleId) {
  const path = join(root, manifestPathFor(exampleId));
  if (!existsSync(path))
    throw new Error(
      `unknown example id: ${exampleId} (registered: ${listExampleIds(root).join(', ') || 'none'})`,
    );
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Whether the example is still registered in this copy. Journeys that click
// through an example (desktop shell smoke, production smoke, restore
// drill) bow out honestly once it is removed. The knowledge example stays
// the default because those journeys click through it.
export function exampleActive(root, exampleId = 'knowledge-base') {
  try {
    return loadExampleManifest(root, exampleId).status === 'active';
  } catch {
    return false;
  }
}

// Migration files a removed example leaves behind as history — the kept
// path of the two migration stories. The table-ownership checker exempts
// exactly these files; every other migration still needs a module owner.
export function retainedHistoryPaths(manifest) {
  if (manifest?.status !== 'removed') return new Set();
  return new Set(manifest.retainedMigrations ?? []);
}

function markerTokens(prefix, marker) {
  return [
    `example:${prefix}:${marker}:start`,
    `example:${prefix}:${marker}:end`,
  ];
}

// Indexes of a marker's start/end lines within an already-split source,
// or -1 for a missing half.
function markerIndexes(lines, prefix, marker) {
  const [start, end] = markerTokens(prefix, marker);
  return {
    start: lines.findIndex((line) => line.includes(start)),
    end: lines.findIndex((line) => line.includes(end)),
  };
}

// The first marker of the file that is not an intact, ordered start/end
// pair, or undefined when all of them are.
function firstBrokenMarker(source, prefix, markers) {
  const lines = source.split('\n');
  return markers.find((marker) => {
    const { start, end } = markerIndexes(lines, prefix, marker);
    return start < 0 || end < 0 || end < start;
  });
}

// Drift guard: the manifest must describe the copy exactly as registered.
// After a removal the emptied manifest verifies trivially.
export function verifyExampleManifest(root, exampleId = 'knowledge-base') {
  const example = loadExampleManifest(root, exampleId);
  for (const path of [
    ...example.ownedPaths,
    ...Object.values(example.compositionPoints ?? {}),
  ])
    if (!existsSync(join(root, path)))
      throw new Error(
        `Example manifest lists a missing path: ${path} (update ${manifestPathFor(exampleId)} with the feature)`,
      );
  for (const [file, markers] of Object.entries(
    example.registrationMarkers ?? {},
  )) {
    const source = readFileSync(join(root, file), 'utf8');
    const broken = firstBrokenMarker(source, example.markerPrefix, markers);
    if (broken)
      throw new Error(
        `Example registration marker ${broken} is not a start/end pair in ${file}`,
      );
  }
  return example;
}

// Every registered example must still describe this copy exactly. Removed
// examples verify trivially against their emptied manifests. Exclusive
// ownership is a hard constraint: two examples claiming the same path, or
// the same dependency in the same manifest, is a conflict the removal tool
// could never adjudicate, so verification refuses it. Composition points
// are deliberately shared and stay exempt.
export function verifyExampleManifests(root) {
  const examples = listExampleIds(root).map((exampleId) =>
    verifyExampleManifest(root, exampleId),
  );
  const refuse = (subject, previousId, currentId) => {
    throw new Error(
      `Examples ${previousId} and ${currentId} both own ${subject}; ownership must be exclusive`,
    );
  };
  const pathOwners = new Map();
  const dependencyOwners = new Map();
  for (const example of examples) {
    for (const path of example.ownedPaths) {
      const previous = pathOwners.get(path);
      if (previous) refuse(path, previous, example.id);
      pathOwners.set(path, example.id);
    }
    for (const kind of ['ownedDependencies', 'ownedCargoDependencies'])
      for (const [file, names] of Object.entries(example[kind] ?? {}))
        for (const name of names) {
          const key = `${file}::${name}`;
          const previous = dependencyOwners.get(key);
          if (previous) refuse(`${name} in ${file}`, previous, example.id);
          dependencyOwners.set(key, example.id);
        }
  }
  return examples;
}

// Pure planning: what the removal would change. Writes nothing.
export function planExampleRemoval(
  root,
  { trimMigrations = false, exampleId = 'knowledge-base' } = {},
) {
  const example = loadExampleManifest(root, exampleId);
  const owned = example.ownedPaths.filter((path) =>
    existsSync(join(root, path)),
  );
  const migrations = owned.filter((path) => /^migrations\//.test(path));
  const deletePaths = owned.filter((path) => !/^migrations\//.test(path));
  const kept = trimMigrations ? [] : migrations;
  // Both the dry-run preview and the applied site.json filter read this one
  // list, so what is announced is exactly what is removed.
  const ownedSources = [...deletePaths, ...kept].filter((path) =>
    /\.(md|tsx?|rs)$/.test(path),
  );
  const sitePath = join(root, 'docs', 'site.json');
  const sitePages = existsSync(sitePath)
    ? (JSON.parse(readFileSync(sitePath, 'utf8')).pages ?? [])
    : [];
  return {
    example,
    delete: deletePaths,
    migrations: {
      kept,
      trim: trimMigrations ? migrations : [],
    },
    ownedSources,
    edits: Object.entries(example.registrationMarkers ?? {}).map(
      ([file, markers]) => ({ file, markers, prefix: example.markerPrefix }),
    ),
    navigation: {
      file: join('docs', 'site.json'),
      removeSources: sitePages
        .filter((page) => ownedSources.includes(page.source))
        .map((page) => page.source),
    },
    dependencies: Object.entries(example.ownedDependencies ?? {}).map(
      ([file, names]) => ({ file, remove: names }),
    ),
    cargoDependencies: Object.entries(example.ownedCargoDependencies ?? {}).map(
      ([file, names]) => ({ file, remove: names }),
    ),
    manifest: { file: manifestPathFor(exampleId), status: 'removed' },
    regenerate: [
      // --no-frozen-lockfile: the stripped package.json files no longer
      // match the committed lockfile, and CI runs pnpm with CI=true.
      ['pnpm', ['install', '--silent', '--no-frozen-lockfile']],
      ['cargo', ['update', '--workspace', '--quiet']],
      ['pnpm', ['generate']],
      ['node', ['scripts/project-docs.mjs']],
    ],
  };
}

// Protection: a removal rewrites the copy, so it must be a clean checkout
// and every registered marker must still be an intact start/end pair.
export function checkRemovalSafety(root, plan) {
  const problems = [];
  // The manifests must still describe this copy exactly, and their
  // ownership claims must not conflict: a removal that proceeds on a
  // contradictory description could delete a path or strip a dependency
  // another registered example still needs.
  try {
    verifyExampleManifests(root);
  } catch (error) {
    problems.push({ subject: 'ownership manifests', detail: error.message });
  }
  let status = '';
  try {
    status = execFileSync('git', ['-C', root, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
  } catch {
    problems.push({
      subject: 'git',
      detail: `${root} is not a git working copy; the removal refuses to edit a copy whose state cannot be verified`,
    });
  }
  if (status.trim().length > 0)
    problems.push({
      subject: 'uncommitted changes',
      detail: `the copy has uncommitted changes; commit or discard them first:\n${status.trim()}`,
    });
  for (const edit of plan.edits) {
    let source;
    try {
      source = readFileSync(join(root, edit.file), 'utf8');
    } catch {
      problems.push({
        subject: 'marker',
        detail: `registered marker file is missing: ${edit.file}`,
      });
      continue;
    }
    const broken = firstBrokenMarker(source, edit.prefix, edit.markers);
    if (broken)
      problems.push({
        subject: 'marker',
        detail: `registration marker ${broken} in ${edit.file} is not an intact start/end pair; resolve the customization manually`,
      });
  }
  for (const path of plan.delete)
    if (!existsSync(join(root, path)))
      problems.push({
        subject: 'owned path',
        detail: `owned path is already missing: ${path}`,
      });
  return { problems };
}

function removeMarkerBlocks(source, prefix, markers) {
  const lines = source.split('\n');
  for (const marker of markers) {
    const { start, end } = markerIndexes(lines, prefix, marker);
    if (start < 0 || end < start) continue;
    lines.splice(start, end - start + 1);
    // The splice glues the surrounding lines together; when both sides
    // carry a blank line, keep one so the block leaves a single gap
    // instead of a doubled one. Nothing outside the junction is touched.
    if (lines[start - 1]?.trim() === '' && lines[start]?.trim() === '')
      lines.splice(start - 1, 1);
  }
  return lines.join('\n');
}

// Cargo dependency lines look like `name = ...` or `name.workspace = true`.
function stripCargoDependencies(content, names) {
  const patterns = names.map((name) => ({
    name,
    pattern: new RegExp(
      `^${name.replaceAll('.', '\\.').replaceAll('-', '\\-')}(\\.workspace)?\\s*=`,
    ),
  }));
  return content
    .split('\n')
    .filter((line) => !patterns.some(({ pattern }) => pattern.test(line)))
    .join('\n');
}

function writeJson(root, path, value) {
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

// Orchestrator used by the CLI: verify, then apply.
export function removeExample(
  root,
  { trimMigrations = false, exampleId = 'knowledge-base', run } = {},
) {
  run ??= (command, args) =>
    execFileSync(command, args, { cwd: root, stdio: 'inherit' });
  const plan = planExampleRemoval(root, { trimMigrations, exampleId });
  const { problems } = checkRemovalSafety(root, plan);
  if (problems.length > 0)
    throw new Error(
      `refusing to remove the example; resolve these first:\n${problems
        .map((problem) => `- [${problem.subject}] ${problem.detail}`)
        .join('\n')}`,
    );

  for (const path of plan.delete)
    rmSync(join(root, path), { recursive: true, force: true });
  for (const path of plan.migrations.trim)
    rmSync(join(root, path), { recursive: true, force: true });

  for (const edit of plan.edits) {
    const file = join(root, edit.file);
    writeFileSync(
      file,
      removeMarkerBlocks(readFileSync(file, 'utf8'), edit.prefix, edit.markers),
    );
  }

  const sitePath = join(root, plan.navigation.file);
  const site = JSON.parse(readFileSync(sitePath, 'utf8'));
  site.pages = (site.pages ?? []).filter(
    (page) => !plan.ownedSources.includes(page.source),
  );
  writeJson(root, plan.navigation.file, site);

  for (const dependency of plan.dependencies) {
    const file = join(root, dependency.file);
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    for (const section of ['dependencies', 'devDependencies'])
      for (const name of dependency.remove) delete pkg[section]?.[name];
    writeJson(root, dependency.file, pkg);
  }
  for (const dependency of plan.cargoDependencies) {
    const file = join(root, dependency.file);
    writeFileSync(
      file,
      stripCargoDependencies(readFileSync(file, 'utf8'), dependency.remove),
    );
  }

  writeJson(root, plan.manifest.file, {
    ...plan.example,
    status: 'removed',
    removedAt: new Date().toISOString(),
    ownedPaths: [],
    compositionPoints: {},
    registrationMarkers: {},
    ownedDependencies: {},
    ownedCargoDependencies: {},
    // The kept-history story: which migration files stay (and are exempt
    // from table ownership) after the example's code is gone.
    retainedMigrations: plan.migrations.kept,
  });

  const regenerated = [];
  for (const [command, args] of plan.regenerate) {
    run(command, args);
    regenerated.push([command, args]);
  }
  return { plan, summary: { regenerated } };
}
