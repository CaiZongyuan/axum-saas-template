# 发布自己的文档站点

把已构建并检查的双语静态站点发布到自己的 GitHub Pages。仓库 Markdown、[site.json](../site.json)和实际代码是来源；`apps/docs/.generated` 与 dist 不提交到源码分支。编写和登记页面见[维护文档](../guides/maintain-docs.md)。

本指南需要仓库推送权限，首次设置还需要仓库管理权限。请求 Pages 构建需要已安装并登录的 GitHub CLI。命令在仓库根目录运行；发布命令会向远端 `gh-pages` 写入静态产物。

## 准备公开来源与构建

确认 `origin` 指向自己的 GitHub 仓库，并把 `docs/site.json.repository` 改为 `owner/repository`。完成双语页面登记、保存并推送源码，再构建：

```bash
git remote -v
pnpm docs:check
pnpm docs:build
```

站点页脚 SHA 表示本次构建引用的源码版本，不代表每个示例命令都在该版本通过。需要发布的内容必须在对应提交中；提交后重新构建，让源码链接能在 GitHub 读取。

默认 Pages 子路径由仓库名决定。非默认部署路径可以在构建时指定：

```bash
DOCS_BASE=/my-saas/ pnpm docs:build
```

base 必须和实际部署路径一致。生成后的章节、语言切换、静态资产和搜索使用同一 base；不要靠修改 dist 修复路径。

## 首次发布并设置 Pages

```bash
node scripts/publish-docs.mjs
```

[发布脚本](../../scripts/publish-docs.mjs)检查 dist 的仓库/源码版本与当前发布输入一致，将产物提交并推送至独立 `gh-pages`，不切换当前源码分支或修改其暂存区。重复发布相同产物不会创建无意义的提交。

在 GitHub **Settings → Pages → Build and deployment** 选择 **Deploy from a branch**，分支 `gh-pages`、目录 `/ (root)` 并保存。仓库可见性是否支持 Pages 取决于账号方案。

然后请求构建并验证在线内容：

```bash
node scripts/publish-docs.mjs --request-build
```

命令检查 Pages 设置，显式请求构建，确认构建对应刚发布的静态提交，再读取线上首页的源码 SHA；五分钟内未成功就失败退出。远端分支推送成功不等于页面已经上线。

## 后续自动发布

[CI](../../.github/workflows/ci.yml)按变更路径选择检查：文档运行 tooling 与 documentation，教学源码运行后端课程，客户端改动运行相关客户端检查。`verify` 汇总所有被选中任务，失败或意外跳过都会阻止通过。documentation 任务保存已检查的网站产物；合入 `main` 且 `verify` 与 documentation 都成功后，发布任务推送同一份产物到 `gh-pages`，再使用 `contents: write` 与 `pages: write` 显式请求 Pages 构建。没有网站产物的提交不会触发文档发布。

GitHub Actions 的 `GITHUB_TOKEN` 推送不会自动触发 Pages 构建，因此不能省略 `--request-build`。管理员的一次性 Pages 设置不会由发布任务隐式修改。

## 验证与失败恢复

打开 `https://<owner>.github.io/<repository>/`，检查中英文同页切换、搜索、自己的新章节、源码版本与源码链接。修改 base 或导航时，先用 `just e2e-docs` 在静态产物上验证；不需要 API、数据库或 Electron。

| 失败                       | 处理                                               |
| -------------------------- | -------------------------------------------------- |
| artifact 与仓库/版本不一致 | 确认 repository/origin 与目标提交，重新构建        |
| Pages 设置不匹配           | 使用 `gh-pages:/` 的 branch 发布方式，重新请求     |
| 权限或构建失败             | 核对 GitHub CLI/CI 权限和 Pages 错误；保留失败输出 |
| 页面/资源 404              | 核对实际路径与 DOCS_BASE，修复来源后重建发布       |
| 需要回到旧内容             | 检出已审阅旧版本后重新构建发布，不手工修改静态页面 |

发布自己的后端产品说明时，从[静态站点维护](../tutorials/30-public-site.md)增加已交付能力的入口；业务 API 的部署与恢复另见[生产指南](../tutorials/21-single-machine-production.md)。
