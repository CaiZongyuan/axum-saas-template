# 维护自己的双语文档站点

模板提供 Landing、Documentation、Blog、Downloads 四类静态入口。开发者主要维护仓库 Markdown 和站点声明；生成目录与 VitePress 产物由工具产生。自己的 SaaS 后端教程应从开发任务、文件、代码和 HTTP 结果展开，见[文档维护指南](../guides/maintain-docs.md)。

前提是安装 pnpm 依赖、完成中英正文，并了解[作者规则](../agents/documentation.md)。命令在仓库根目录运行。

## 修改来源并看到结果

```bash
pnpm docs:check
just docs
```

`just docs` 启动本地文档开发服务器，地址以终端输出为准。编辑 `docs/` 下的源文件，不能编辑 `apps/docs/.generated`。生成关系是：

```text
docs/site.json + 双语 Markdown + 受检查源码/生成参考
  → scripts/project-docs.mjs
  → apps/docs/.generated
  → VitePress
  → apps/docs/.vitepress/dist
```

[site.json](../site.json)是页面、稳定 id、分组与发布路径的唯一声明。[渲染器](../../scripts/lib/docs.mjs)解析当前语言的文档链接，写语言对应页和源码版本；源文件移动时保留原来的 `route`，旧书签仍可用。

## 登记自己的指南

先创建 `docs/guides/billing.md` 与 `billing.en.md`，再在 `pages` 中添加完整条目：

```json
{
  "id": "billing-guide",
  "source": "docs/guides/billing.md",
  "sourceEn": "docs/guides/billing.en.md",
  "route": "guides/billing.md",
  "title": "开发账务模块",
  "titleEn": "Build a billing module",
  "group": "开发指南",
  "type": "guide"
}
```

这是读者新增的页面示例，默认仓库尚未包含 Billing 正文。使用已存在的双语分组；新分组还要在 `groupLabels` 声明两种语言。需要连续学习关系时显式写 `previous` / `next` 的 id，没有关系时保持为空缺，避免跳到无关内容。

中文路径保持原路由，英文镜像在 `/en/`。语言切换根据对应页定位同一章，搜索索引包含双语正文与生成参考。文档站语言由路径决定，与应用的设备级语言偏好不同。

## 公开入口、主题与版面

中文四类入口是 `/`、`/docs/`、`/blog/`、`/downloads/`，英文对应 `/en/`。Blog 与 Downloads 当前是“即将推出”占位；增加文章或下载前，需要实际内容与产物，不能用文案假装已交付。

公开 layout 页使用 `layout: "page"`，不进入文档侧栏；`pageTitle` / `pageTitleEn` 和 `pageDescription` / `pageDescriptionEn` 必须成对。[双语声明校验](../../scripts/lib/docs-locales.mjs)在缺失、冲突或悬空章节关系时失败。

文档阅读沿用已接受体验：侧栏贴视口左侧，正文独立限宽，窄屏目录折叠。主题偏好用 VitePress 的 `auto | light | dark`，保存在 `vitepress-theme-appearance`，不跨设备同步。主题与导航实现位于 [theme 目录](../../apps/docs/.vitepress/theme/)，生产颜色由共享 tokens 派生；修改主题才需要实际浏览器的宽屏/窄屏、焦点和溢出检查，正文改写先验证链接与构建。

## 示例归属与验证

共享公开页中的业务专有展示/链接应放在已登记的 `example:<prefix>:<marker>:start/end` 区块；业务独占教程登记到自己的清单。移除业务时对应正文与导航一起裁剪，Core 页面继续构建。不要在共享页 marker 外增加指向独占源码的链接。

```bash
pnpm docs:check
pnpm docs:build
```

第一条校验双语登记、链接、片段和生成参考；第二条投影、构建并校验产物中的导航/链接。新增自己的页面后，打开中英两页并确认语言切换、来源链接和前后章目标。

更改导航、主题、搜索或部署 base 后运行：

```bash
just e2e-docs
```

它只测试静态站点，不启动应用数据库或 Electron。构建成功不能证明 Rust 示例可运行；示例还要有对应编译、HTTP 或公开能力验证。

自定义子路径部署使用：

```bash
DOCS_BASE=/my-saas/ pnpm docs:build
```

若页面/片段来源不存在、metadata 少一半或导航指向已删章节，检查会失败；修复源声明后重建，不手工修 dist。

下一步：[发布自己的文档站点](../getting-started/publish-docs.md)。
