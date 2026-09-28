# 发布教程站点

仓库 Markdown 是唯一可编辑来源。[站点清单](../site.json)决定公开页面；源码片段、API 与配置参考从实现生成。`apps/docs/.generated` 和构建产物不提交到源码分支。

## 双语章节登记

站点同时发布简体中文与英文：中文沿用既有路径，英文固定在 `en/` 前缀下，与中文章节一一对应。新增页面必须成对交付：

1. 在中文源文件旁创建同名 `.en.md` 文件（例如 `docs/getting-started/quickstart.md` 与 `docs/getting-started/quickstart.en.md`）。两个文件使用同一组相对链接与 `<<<` 片段引用；链接会按目标章节是否有英文译本自动落到正确语言。
2. 在 `docs/site.json` 的 `pages` 中登记一个稳定 `id`，并同时给出 `title`/`titleEn` 与 `source`/`sourceEn`；分组名称通过顶层 `groupLabels` 提供两个语言的标签。
3. 运行 `pnpm docs:check`。它会校验章节配对、重复 id/路由、悬空链接与生成参考，并在缺少英文译本时直接失败。

既有尚未翻译的章节是显式登记的迁移项：`translation: { "status": "pending", "owner": "<票号>" }` 声明由哪张实现票补齐英文；校验只接受已发布计划中的票号。迁移期间站点正常构建，英文导航不显示这些章节，也不会生成指向不存在页面的链接。禁止用占位文本伪装英文译本。

语言切换器始终定位同一章节；目标章节没有英文译本时回到英文文档首页。搜索覆盖本站全部已发布文档与生成参考。整个站点使用同一套顶栏、字体、明暗主题与语言规则，后续 Landing、Blog、Downloads 页面复用同一约定。

## 首次启用 GitHub Pages

以下步骤面向有仓库管理权限的维护者。先把源码提交并推送到自己的 GitHub 仓库，确认 `origin` 指向它，将 `docs/site.json` 的 `repository` 改为自己的 `owner/repository`。源码链接包含当前提交 SHA，因此必须在提交后重新构建。

```bash
pnpm docs:build
node scripts/publish-docs.mjs
```

发布脚本把静态文件提交到独立的 `gh-pages` 分支，不切换当前源码分支，也不修改当前暂存区。随后在 GitHub 的 **Settings → Pages → Build and deployment** 中选择 **Deploy from a branch**，分支为 `gh-pages`，目录为 `/ (root)`，并保存。公共仓库可使用此方式；其他可见性取决于 GitHub 账号方案。

本机安装并登录 GitHub CLI 后，请求构建并验证线上结果：

```bash
node scripts/publish-docs.mjs --request-build
```

命令会检查 Pages 配置，显式请求构建，确认构建对应刚发布的静态产物提交，并读取线上首页检查源码版本。在五分钟内未完成时会失败退出；推送成功本身不代表网页已经可访问。

## 后续自动发布

[CI 工作流](../../.github/workflows/ci.yml)在 PR 中运行 `just check` 并保存文档产物。源码合并到 `main`、检查通过后，发布任务将同一份产物推送到 `gh-pages`，并使用 `contents: write` 和 `pages: write` 权限显式请求 Pages 构建。

GitHub Actions 使用 `GITHUB_TOKEN` 推送分支不会自动触发 Pages 构建，因此不能省略 `--request-build`。首次 Pages 设置仍需管理员完成，CI 不尝试修改仓库管理设置。

默认地址为 `https://<owner>.github.io/<repository>/`。站点路径由仓库名决定；自定义域名或非默认路径可通过 `DOCS_BASE` 调整构建路径。子路径部署下，章节切换、语言切换、源码链接和搜索都基于相对路径与构建期 base，无需额外配置。
