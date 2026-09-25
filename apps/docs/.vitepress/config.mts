import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';

const site = JSON.parse(
  readFileSync(new URL('../../../docs/site.json', import.meta.url), 'utf8'),
);
const repository = process.env.GITHUB_REPOSITORY ?? site.repository;
const project = repository.split('/')[1];
const sections = new Map<
  string,
  { text: string; items: { text: string; link: string }[] }
>();
for (const page of [...site.pages, ...site.references]) {
  if (!sections.has(page.group))
    sections.set(page.group, { text: page.group, items: [] });
  sections.get(page.group)!.items.push({
    text: page.title,
    link:
      page.route === 'index.md' ? '/' : '/' + page.route.replace(/\.md$/, ''),
  });
}

export default defineConfig({
  lang: 'zh-CN',
  title: site.title,
  description: site.description,
  srcDir: '.generated',
  base:
    process.env.DOCS_BASE ??
    (project.endsWith('.github.io') ? '/' : `/${project}/`),
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: '快速开始', link: '/' },
      { text: '跟做教程', link: '/tutorials/first-request' },
    ],
    sidebar: [...sections.values()],
    socialLinks: [{ icon: 'github', link: `https://github.com/${repository}` }],
    search: { provider: 'local' },
    footer: { message: '同一份源码 · 可运行教程 · 明确的测试入口' },
    outline: { label: '本页内容' },
    docFooter: { prev: '上一页', next: '下一页' },
  },
});
