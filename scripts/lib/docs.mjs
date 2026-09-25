import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, posix, relative, resolve, sep } from 'node:path';
import { root } from './process.mjs';

export const site = JSON.parse(
  readFileSync(resolve(root, 'docs/site.json'), 'utf8'),
);

function repositoryFile(source) {
  const absolute = resolve(root, source);
  if (!absolute.startsWith(root + sep) || !existsSync(absolute))
    throw new Error(
      `Missing/outside-repository documentation target: ${source}`,
    );
  return absolute;
}

export function renderDocs() {
  const pages = new Map();
  const routes = new Map(
    site.pages.map((page) => [resolve(root, page.source), page.route]),
  );
  const repo = process.env.GITHUB_REPOSITORY ?? site.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('Invalid documentation repository');
  const sourceRef =
    process.env.DOCS_SOURCE_REF ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  const sourceLink = (source) =>
    `https://github.com/${repo}/blob/${sourceRef}/${source}`;

  for (const page of site.pages) {
    if (
      !page.route.endsWith('.md') ||
      page.route.startsWith('/') ||
      page.route.includes('..') ||
      pages.has(page.route)
    )
      throw new Error(`Invalid/duplicate documentation route: ${page.route}`);
    const absolute = repositoryFile(page.source);
    let content = readFileSync(absolute, 'utf8');
    content = content.replace(/^<<<\s+(.+)$/gm, (_line, target) => {
      const snippet = repositoryFile(
        relative(root, resolve(dirname(absolute), target.trim())),
      );
      const language =
        {
          '.rs': 'rust',
          '.tsx': 'tsx',
          '.ts': 'ts',
          '.mjs': 'js',
          '.sql': 'sql',
        }[extname(snippet)] ?? 'text';
      return `\n\`\`\`${language}\n${readFileSync(snippet, 'utf8').trimEnd()}\n\`\`\`\n`;
    });
    content = content.replace(/\]\(([^)]+)\)/g, (_match, target) => {
      if (/^(https?:|mailto:|#)/.test(target)) return `](${target})`;
      const [path, fragment] = target.split('#');
      if (path.startsWith('site:')) {
        const route = path.slice(5);
        if (!site.references.some((item) => item.route === route))
          throw new Error(`Unknown generated reference: ${route}`);
        return `](${posix.relative(posix.dirname(page.route), route)}${fragment ? '#' + fragment : ''})`;
      }
      const destination = repositoryFile(
        relative(root, resolve(dirname(absolute), decodeURIComponent(path))),
      );
      const route = routes.get(destination);
      const href = route
        ? posix.relative(posix.dirname(page.route), route)
        : sourceLink(relative(root, destination));
      return `](${href}${fragment ? '#' + fragment : ''})`;
    });
    content += `\n\n---\n源码版本：\`${sourceRef.slice(0, 12)}\` · [本页 Markdown](${sourceLink(page.source)})\n`;
    pages.set(page.route, content);
  }

  const contractPath = repositoryFile('packages/contracts/openapi.json');
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  let api =
    '# API 合同\n\n从 Rust OpenAPI 自动生成。当前 API 版本：' +
    contract.info.version +
    '。\n\n| 方法 | 路径 | operationId | 响应 |\n| --- | --- | --- | --- |\n';
  for (const [path, item] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      api += `| ${method.toUpperCase()} | \`${path}\` | \`${operation.operationId}\` | ${Object.keys(operation.responses).join(', ')} |\n`;
    }
  }
  api +=
    '\n[下载 OpenAPI JSON](../openapi.json)。开发服务也直接提供 `/api/openapi.json`。响应和 SDK 不维护手写的第二份 DTO。\n';
  pages.set('reference/api.md', api);
  pages.set('public/openapi.json', readFileSync(contractPath, 'utf8'));

  const fields = JSON.parse(
    execFileSync(
      'cargo',
      [
        'run',
        '--quiet',
        '--locked',
        '-p',
        'saas-api',
        '--bin',
        'config-reference',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
        },
      },
    ),
  );
  const example = readFileSync(repositoryFile('.env.example'), 'utf8');
  let config =
    '# API 配置\n\n从 Settings 定义自动生成；生产秘密不进入文档。\n\n| 变量 | 默认值 | 敏感值 | 说明 |\n| --- | --- | --- | --- |\n';
  for (const field of fields) {
    if (!new RegExp(`^${field.name}=`, 'm').test(example))
      throw new Error(`.env.example is missing ${field.name}`);
    config += `| \`${field.name}\` | ${field.default ?? '必填'} | ${field.secret ? '是' : '否'} | ${field.description} |\n`;
  }
  config += `\n开发脚本额外读取的 PostgreSQL 端口、Web 代理和教程 URL 见 [.env.example](${sourceLink('.env.example')})；它们不是浏览器可读取的 DATABASE_URL。\n`;
  pages.set('reference/config.md', config);
  for (const page of [...site.pages, ...site.references])
    if (!pages.has(page.route))
      throw new Error(`Navigation points at a missing page: ${page.route}`);
  return pages;
}
