import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const JOBS = {
  docs: 'documentation',
  backend: 'backend',
  teaching: 'teaching-backend',
  frontend: 'frontend',
  desktop: 'desktop-smoke',
  removal: 'example-removal',
};
const ALL_SCOPES = Object.keys(JOBS);

const RULES = [
  [
    /^(?:\.github\/workflows\/ci\.yml$|\.github\/actions\/setup-checks\/|scripts\/ci-change-scope\.mjs$|tests\/tooling\/ci-change-scope\.test\.mjs$)/,
    ALL_SCOPES,
  ],
  [
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.node-version|\.npmrc|justfile)$/,
    ALL_SCOPES,
  ],
  [
    /^(?:Cargo\.(?:toml|lock)|rust-toolchain\.toml)$/,
    ['backend', 'teaching', 'docs', 'removal'],
  ],
  [
    /^(?:docs\/.*\.(?:rs|sql)|examples\/tutorial-tickets\/(?!.*\.md$)|crates\/app\/tests\/tutorial_course\.rs|apps\/api\/tests\/tutorial_module\.rs|scripts\/(?:check-tutorial-module|check-tutorial-course|check-tutorial-recovery|tutorial-course)\.mjs|tests\/tooling\/tutorial-course\.test\.mjs)/,
    ['teaching', 'docs'],
  ],
  [
    /^docs\/tutorials\/(?:13-export-notifications|14-audit-history)(?:\.en)?\.md$/,
    ['teaching', 'docs'],
  ],
  [
    /^(?:docs\/|apps\/docs\/|tests\/docs\/|scripts\/(?:.*docs.*\.mjs|lib\/docs[^/]*\.mjs)|playwright\.docs\.config\.ts)/,
    ['docs'],
  ],
  [
    /^(?:\.agents\/|\.claude\/|skills-lock\.json$|\.gitignore$|LICENSE$)|\.md$/,
    ['docs'],
  ],
  [/^examples\/[^/]+\/manifest\.json$/, ['removal', 'docs']],
  [
    /^(?:scripts\/(?:desktop[^/]*|perf\/desktop-soak)\.mjs|tests\/desktop\/)/,
    ['desktop'],
  ],
  [/^scripts\/lib\/process\.mjs$/, ALL_SCOPES],
  [
    /^scripts\/lib\/(?:test-services|postgres|redis|rustfs|mailpit)\.mjs$/,
    ['backend', 'teaching', 'desktop', 'docs'],
  ],
  [
    /^(?:crates\/|apps\/(?:api|worker)\/|migrations\/|tests\/support\/|scripts\/(?:test-backend|migrate|worker|bootstrap-storage|production[^/]*|observability|dev)\.mjs|scripts\/lib\/(?:mail|object|production|observability|test-worker)[^/]*\.mjs|deploy\/|compose[^/]*\.ya?ml$|\.env\.example$)/,
    ['backend', 'teaching', 'docs', 'removal'],
  ],
  [
    /^packages\/(?:sdk|contracts)\//,
    ['backend', 'teaching', 'frontend', 'desktop', 'docs', 'removal'],
  ],
  [
    /^(?:apps\/(?:web|desktop)\/|packages\/(?:views|ui)\/|tests\/frontend\/|tsconfig[^/]*\.json$|vite[^/]*\.ts$)/,
    ['frontend', 'desktop', 'docs', 'removal'],
  ],
  [
    /^(?:tests\/e2e\/|scripts\/e2e\.mjs$|playwright\.config\.ts$)/,
    ['backend', 'frontend', 'docs'],
  ],
  [
    /^(?:scripts\/(?:example[^/]*|check-boundaries)\.mjs|scripts\/lib\/example[^/]*\.mjs)/,
    ['removal', 'docs'],
  ],
  [/^examples\//, ['backend', 'frontend', 'desktop', 'docs', 'removal']],
  [
    /^(?:scripts\/perf[^/]*\.mjs|scripts\/perf\/|scripts\/lib\/perf[^/]*\.mjs)/,
    ['backend', 'frontend'],
  ],
  [
    /^(?:tests\/tooling\/|\.github\/workflows\/|eslint\.config\.mjs$|\.prettier[^/]*$)/,
    [],
  ],
];

export function classifyChanges(paths, { all = false } = {}) {
  const scope = Object.fromEntries(ALL_SCOPES.map((name) => [name, all]));
  for (const path of paths) {
    const rule = RULES.find(([pattern]) => pattern.test(path));
    // Unknown inputs cannot silently bypass a required check.
    for (const name of rule?.[1] ?? ALL_SCOPES) scope[name] = true;
  }
  return scope;
}

export function verifyJobResults(results) {
  for (const name of ['changes', 'tooling'])
    if (results[name]?.result !== 'success')
      throw new Error(
        `Required CI job ${name} did not succeed (${results[name]?.result ?? 'missing'}).`,
      );
  for (const [scope, job] of Object.entries(JOBS)) {
    const selected = results.changes.outputs?.[scope];
    if (!['true', 'false'].includes(selected))
      throw new Error(`Missing or invalid CI scope output: ${scope}.`);
    const result = results[job]?.result;
    if (selected === 'true' && result !== 'success')
      throw new Error(
        `Selected CI job ${job} did not succeed (${result ?? 'missing'}).`,
      );
    if (!['success', 'skipped'].includes(result))
      throw new Error(
        `CI job ${job} did not succeed (${result ?? 'missing'}).`,
      );
  }
}

function changedPaths(base, head) {
  if (
    ![base, head].every((sha) => /^[a-f\d]{40,64}$/i.test(sha)) ||
    /^0+$/.test(base)
  )
    return null;
  try {
    const mergeBase = execFileSync('git', ['merge-base', base, head], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', mergeBase, head, '--'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      all: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      base: { type: 'string', default: process.env.CI_BASE_SHA ?? '' },
      head: { type: 'string', default: process.env.CI_HEAD_SHA ?? '' },
    },
  });
  if (values.verify) {
    verifyJobResults(JSON.parse(process.env.CI_JOB_RESULTS ?? '{}'));
    console.log('All selected CI checks succeeded.');
  } else {
    const paths = changedPaths(values.base, values.head);
    const scope = classifyChanges(paths ?? [], {
      all:
        values.all ||
        process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ||
        paths === null,
    });
    console.log(JSON.stringify({ paths, scope }, null, 2));
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(scope)
          .map(([name, selected]) => `${name}=${selected}\n`)
          .join(''),
      );
  }
}
