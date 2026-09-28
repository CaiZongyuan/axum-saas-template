# 跟做：双语公开站点

公开站点由 Landing、Documentation、Blog、Downloads 四部分组成：未登录的访客从简洁的品牌首页理解模板，从顶栏进入对应语言的文档，Blog 与 Downloads 保留稳定入口并如实显示"即将推出"。本章先从访客视角走一遍四类入口，再从维护者视角说明页面如何声明、文案如何保持真实、示例展示如何随示例移除，以及语言、主题与部署 base 的规则。

## 1. 先体验：四类入口与公开路径

构建并浏览站点：

```bash
pnpm docs:build   # 渲染双语站点并验证内置导航
just docs         # 本地开发服务器，边改边看
```

中文入口在根路径：`/`（Landing）、`/docs/`（文档教程）、`/blog/`、`/downloads/`；英文一一对应到 `/en/` 下。语言由路径决定：访问 `/en/blog/` 得到英文页，站点不做设备语言重定向；顶栏的「English / 中文」按 frontmatter 里的对应页切换，永远落在已存在的页面上。旧章节深链（如 `/getting-started/quickstart`）不受改版影响。

## 2. 信息结构：借鉴 Expo 的四段式

Landing 遵循 Expo 首页的信息结构，但只陈述真实交付的能力：

1. **价值主张 + 主要动作**：一句话说清模板（README 同款），主按钮进入当前语言的 Documentation，附 GitHub 仓库入口。
2. **使用流程**：启动全栈 → 跟做教程 → 组合/移除示例 → 部署备份，每步链接到真实章节。
3. **真实能力**：每张能力卡都链接到已有教程章节或 v1 覆盖页；没有"规划中/即将支持"的能力卡。
4. **结束 CTA**：回到文档入口。

写新卡片时的纪律：先确认能力在 [v1 覆盖与验收](../architecture/v1-coverage.md) 里有对应行，再决定卡片与链接；描述措辞与对应章节保持一致，不发明数字（性能、规模、用户量）。

## 3. 页面如何声明：site.json 与渲染器

[site.json](../../docs/site.json) 是唯一声明处。Landing 与两张占位页是带 `layout: "page"` 的普通页面条目：双语成对（`sourceEn`/`titleEn`），并携带成对的 `pageTitle`/`pageTitleEn` 与 `pageDescription`/`pageDescriptionEn`——渲染器把它们写进页面 frontmatter，页面 `<title>` 与 meta description 因此如实反映"即将推出"。校验在 [docs-locales.mjs](../../scripts/lib/docs-locales.mjs)：meta 必须成对、只能出现在 layout 页上，漏一半直接构建失败。

layout 页不进侧栏（渲染器同时写入 `sidebar: false`），只出现在顶栏；四类页面共用同一导航、页脚、视觉 tokens 与明暗规则。Landing 源文件是普通 Markdown 加受限 HTML（`docs/index.md` 与相邻的 `docs/index.en.md`），样式在 [custom.css](../../apps/docs/.vitepress/theme/custom.css) 里使用与文档一致的 `--vp-*` tokens。

## 4. Coming soon 的边界

Blog 与 Downloads 本轮只是占位：没有文章列表或发布管理，没有下载目录、版本/平台选择、安装包服务、订阅表单或进度承诺。占位页的义务是诚实——说明现在能做什么（回首页、看文档、关注仓库），不虚构文章、日期或发布资产；页面标题与 meta 如实标注状态。后续实现博客或下载时替换占位内容即可，入口路径与导航保持稳定。

## 5. 示例展示的归属

Landing 里"参考示例：个人知识库"整段位于 `example:knowledge:landing:start/end` 标记之间，属于知识库示例的展示内容。标记之外的 Landing 文字只允许链接 Core 章节——删例演练后的 [docs:build](../../scripts/check-docs-build.mjs) 会对每一处链接做存在性检查，示例专属卡片随标记整块消失，不会留下失效入口。亲手演练一遍：

```bash
git clone . /tmp/ui16-drill && node scripts/example-remove.mjs --root /tmp/ui16-drill
cd /tmp/ui16-drill && pnpm docs:build   # 展示段已裁剪，剩余链接全部可解析
```

CI 的示例移除任务在每个 PR 上做同样的事，Core-only 站点必须照常构建发布。

## 6. 语言、主题与部署

主题偏好由 VitePress 外观切换保存在浏览器本机（`localStorage`），不跨设备同步；语言只看路径，不承诺跨站自动跟随。部署沿用既有静态链路：GitHub Pages 在 `main` 上发布（见[发布教程站点](../getting-started/publish-docs.md)），仓库子路径由 base 承担；自定义 base 用 `DOCS_BASE=/your-base/ pnpm docs:build` 构建并经内置检查验证——公开站的浏览器旅程（`just e2e-docs`）包含一次自定义 base 冒烟。

## 7. 验证

```bash
pnpm docs:check     # 双语契约、成对 meta、链接与片段
pnpm docs:build     # 渲染 + 构建后导航检查（含 base 解析）
just e2e-docs       # 公开站浏览器旅程：四类入口、CTA、占位页、切换、主题、窄屏、自定义 base
just check          # 主门禁
```

对比度沿用文档站点的既定 tokens：正文文字在明暗两种表面都远超 WCAG AA；Landing 自绘的只有卡片旁的小圆点，明暗两种模式下都对背景保持 ≥3:1（非文字元素阈值），深色下的紫色点用更亮的 violet-500 补足。

公开站的页面类别、导航与渲染器都在 Core：占位页、顶栏与整个渲染链路不出现在任何所有权清单里，删例后照常构建发布。Landing 源文件本身也是 Core 页面，但它在示例所有权清单的 registrationMarkers 里登记了 `example:knowledge:landing` 标记——示例拥有的不是这个页面，而是标记之间的展示段，删例时随标记整块裁剪；浏览器旅程里与示例相关的只有这一段。
