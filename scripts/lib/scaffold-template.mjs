import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  applyExampleRemoval,
  listExampleIds,
  planExampleRemoval,
  verifyExampleManifests,
} from './example-remove.mjs';

function removeRecipes(source, names) {
  let dropping = false;
  const kept = [];
  for (const line of source.split('\n')) {
    const header = /^([a-z][a-z0-9-]*)(?:\s+[^:]*)?:$/.exec(line);
    if (header) {
      dropping = names.includes(header[1]);
      if (dropping)
        while (kept.length && /^(?:#|\s*$)/.test(kept.at(-1))) kept.pop();
    }
    if (!dropping) kept.push(line);
  }
  return kept.join('\n');
}

export function prepareCoreTemplate(root) {
  verifyExampleManifests(root);
  for (const exampleId of listExampleIds(root))
    applyExampleRemoval(
      root,
      planExampleRemoval(root, { exampleId, trimMigrations: true }),
    );
  const teaching = JSON.parse(
    readFileSync(
      join(root, 'examples/tutorial-tickets/ownership.json'),
      'utf8',
    ),
  );
  for (const path of teaching.ownedPaths)
    rmSync(join(root, path), { recursive: true, force: true });
  for (const path of [
    'examples',
    'scripts/example-add.mjs',
    'scripts/example-remove.mjs',
    'scripts/example-new-business.mjs',
    'scripts/lib/example-remove.mjs',
    'tests/tooling/example-add.test.mjs',
    'tests/tooling/example-remove.test.mjs',
    'scripts/perf/k6',
    'scripts/perf/stack.mjs',
    'scripts/perf/fixtures.mjs',
    'scripts/perf/run-scenario.mjs',
    'scripts/perf-query-plans.mjs',
    '.github/workflows/perf-nightly.yml',
    'scripts/production-smoke.mjs',
    'scripts/production-restore-drill.mjs',
    'scripts/ci-change-scope.mjs',
    'tests/tooling/ci-change-scope.test.mjs',
    'tests/tooling/docs-reference-sources.test.mjs',
    'tests/docs',
    'docs/learn',
  ])
    rmSync(join(root, path), { recursive: true, force: true });

  const boundaryPath = join(root, 'scripts/check-boundaries.mjs');
  const lines = readFileSync(boundaryPath, 'utf8').split('\n');
  let dropping = false;
  writeFileSync(
    boundaryPath,
    lines
      .filter((line) => {
        if (/^\/\/ scaffold:examples:.*:start$/.test(line)) {
          dropping = true;
          return false;
        }
        if (/^\/\/ scaffold:examples:.*:end$/.test(line)) {
          dropping = false;
          return false;
        }
        return !dropping;
      })
      .join('\n')
      .replace(
        'let composition = new Set();',
        'const composition = new Set();',
      ),
  );
  const desktop = join(root, 'scripts/desktop-smoke.mjs');
  writeFileSync(
    desktop,
    readFileSync(desktop, 'utf8')
      .replace(
        "import { exampleActive } from './lib/example-remove.mjs';\n",
        '',
      )
      .replace(
        'const knowledgeExampleActive = exampleActive(root);',
        'const knowledgeExampleActive = false;',
      ),
  );

  const just = join(root, 'justfile');
  writeFileSync(
    just,
    removeRecipes(readFileSync(just, 'utf8'), [
      'example-remove',
      'check-core',
      'perf',
      'perf-load',
      'perf-saturation',
      'perf-trajectory',
      'perf-soak',
      'production-smoke',
      'production-restore-drill',
    ]).replace('    node scripts/perf-query-plans.mjs\n', ''),
  );
  const packagePath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  for (const name of Object.keys(pkg.scripts))
    if (name.startsWith('tutorial:')) delete pkg.scripts[name];
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const workflowPath = join(root, '.github/workflows/ci.yml');
  const workflow = yaml.load(readFileSync(workflowPath, 'utf8'));
  for (const name of ['changes', 'teaching-backend', 'example-removal'])
    delete workflow.jobs[name];
  for (const job of Object.values(workflow.jobs)) {
    if (job.needs === 'changes') delete job.needs;
    if (job.if?.includes('needs.changes')) delete job.if;
    if (job.steps)
      job.steps = job.steps.filter(
        (step) =>
          !step.run?.includes('perf-query-plans') &&
          step.name !== 'Keep the query-plan report',
      );
  }
  workflow.jobs.verify.needs = [
    'tooling',
    'backend',
    'frontend',
    'documentation',
    'desktop-smoke',
  ];
  workflow.jobs.verify.steps = [{ run: "echo 'Required checks passed'" }];
  writeFileSync(
    workflowPath,
    yaml.dump(workflow, { lineWidth: 120, noRefs: true }),
  );
  writeCoreDocs(root);
  for (const file of [
    'tests/e2e/registration.spec.ts',
    'tests/e2e/rate-limits.spec.ts',
    'tests/e2e/members.spec.ts',
  ]) {
    const path = join(root, file);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replaceAll(
        "getByRole('heading', { name: '我的文档' })",
        "getByRole('link', { name: '首页', exact: true })",
      ),
    );
  }
}

function writeCoreDocs(root) {
  const path = join(root, 'docs/site.json');
  const site = JSON.parse(readFileSync(path, 'utf8'));
  const keep = new Set([
    'landing',
    'blog',
    'downloads',
    'documentation',
    'quickstart',
    'configuration-sources-reference',
  ]);
  site.pages = site.pages.filter((page) => keep.has(page.id));
  for (const page of site.pages) {
    delete page.previous;
    delete page.next;
  }
  writeFileSync(path, `${JSON.stringify(site, null, 2)}\n`);
  for (const locale of ['zh', 'en']) {
    const english = locale === 'en';
    const suffix = english ? '.en.md' : '.md';
    const quickstart = `# ${english ? 'Core development' : 'Core 开发'}\n\n\`\`\`bash\npnpm install\njust dev\n\`\`\`\n\n${english ? 'The creator allocates ports in `.env`. Startup prints the Web and API URLs. Register at `/register`, then sign in at `/login`. Only SaaS Core is assembled; add your own business modules under `crates/app/src/modules`.' : '脚手架将端口写入 `.env`，启动后输出 Web 和 API 地址。在 `/register` 注册，在 `/login` 登录。当前只组装 SaaS Core；将自己的业务模块加入 `crates/app/src/modules`。'}\n\n\`\`\`bash\njust generate\npnpm boundaries:check\njust check\n\`\`\`\n\n${english ? 'On a port conflict, stop the reported owner or change the port variable in `.env`. Ctrl+C stops host processes; `just services-down` preserves your data volumes.' : '端口冲突时停止提示中的占用者，或修改 `.env` 的端口变量。Ctrl+C 停止宿主进程；`just services-down` 保留数据卷。'}\n\n[HTTP API](site:reference/api.md) · [${english ? 'Configuration' : '配置'}](site:reference/config.md)\n`;
    writeFileSync(
      join(root, `docs/getting-started/quickstart${suffix}`),
      quickstart,
    );
    writeFileSync(
      join(root, `docs/getting-started/documentation${suffix}`),
      `# ${english ? 'Developer documentation' : '开发者文档'}\n\n[${english ? 'Start development' : '开始开发'}](quickstart.md) · [HTTP API](site:reference/api.md) · [${english ? 'Configuration' : '配置'}](site:reference/config.md)\n`,
    );
    writeFileSync(
      join(root, `docs/index${suffix}`),
      `# Dougong\n\n[${english ? 'Development' : '开发'}](getting-started/documentation.md)\n`,
    );
    writeFileSync(
      join(root, english ? 'README.md' : 'README.zh-CN.md'),
      quickstart
        .replace(/^# [^\n]+/, '# Dougong')
        .replaceAll(
          'site:reference/api.md',
          'docs/getting-started/documentation.md',
        )
        .replaceAll('site:reference/config.md', '.env.example'),
    );
  }
  // Keep maintainer records; discarded public chapters cannot advertise removed code.
  for (const page of site.pages)
    for (const source of [page.source, page.sourceEn])
      if (!existsSync(join(root, source)))
        throw new Error(`Missing starter documentation: ${source}`);
}

export function regenerateCoreTemplate(root, targetDirectory) {
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: 'true',
        CARGO_TARGET_DIR: targetDirectory,
        CARGO_BUILD_JOBS: '4',
      },
    });
  run('pnpm', ['install', '--offline', '--no-frozen-lockfile', '--silent']);
  run('cargo', ['update', '--workspace', '--offline', '--quiet']);
  run('node', ['scripts/generate-contracts.mjs']);
  const workspaces = JSON.parse(
    execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  for (const workspace of workspaces)
    rmSync(join(workspace.path, 'node_modules'), {
      recursive: true,
      force: true,
    });
}
