# 跟做：搜索标题与安全预览

运行 `just dev`，登录后新建标题为“部署 100%_完成”的文档，在正文填写：

```markdown
# 部署笔记

**检查列表**：

- [x] 数据库可连接
- [ ] 发布应用

参见 [Rust 官网](https://www.rust-lang.org/)。
```

切换“预览”查看排版，再保存。阅读页显示同样的安全渲染结果。返回“我的文档”，输入 `100%_` 并按 Enter，能找到刚才的文档；这里的 `%`、`_` 都是普通字符。清除搜索恢复列表。更多结果使用“加载更多”，更换关键词或重新提交搜索从第一页开始。

## 1. 给现有列表增加筛选

[HTTP 合同](../../crates/app/src/modules/knowledge/mod.rs)在原来的列表接口增加可选 `q`，保持只返回摘要。关键词最多 200 个 Unicode 字符，不能包含 NUL；去掉两端空白后进行不区分大小写的标题子串匹配。空关键词显示个人库全部可访问文档。创建标题仍限制为 1–200 字符，正文 UTF-8 编码后最多 1 MiB；浏览器提供即时反馈，服务端继续独立验证。

[Application](../../crates/app/src/modules/knowledge/application.rs)转义 LIKE 的 `%`、`_`、反斜杠，然后把模式作为 SQL 参数绑定。不要拼接用户输入成为 SQL，更不要把 `%` 当作用户可以控制的通配符。

当前接口的范围是“我的个人知识库”。后续知识库授权页面将提供库范围的浏览入口；这里不会因为 Owner 有读取权限，就把全企业文档混进“我的文档”。权限条件、关键词、分页边界一起进入查询，无权访问的标题不会先查询出来再由浏览器过滤。

## 2. 游标绑定查询条件

分页按 `created_at DESC, id DESC` 排序。新文档插入不会把下一页已有记录推回上一页。[Cursor](../../crates/app/src/modules/knowledge/pagination.rs)包含当前身份、范围/排序、规范化关键词的摘要和末条位置，换身份或关键词必须重新查询。每一页都重新检查当前 Grant；游标只是位置，不是授权凭据，也不保证跨页数据库快照。

`limit` 默认 50、最大 100，服务端多取一条判断 `has_more`，不返回总数或正文。非法游标返回结构化 400；网络失败保留请求编号，页面提供重新查询或重试下一页。

[View](../../packages/views/src/knowledge/documents-view.tsx)使用 TanStack Query，key 包含身份、个人库范围和关键词；已保存文档仍只在 Query 缓存中。搜索输入是表单状态，预览是未保存草稿的展示，不另建资源 store。换身份会清缓存并重建搜索表单。列表内存最多保留十页，超过后按窗口移出最早页，重新搜索可从头开始。

## 3. 把不可信 Markdown 当内容

[Markdown 渲染器](../../packages/views/src/knowledge/markdown-content.tsx)使用固定版本的 `react-markdown`、`remark-gfm`、`rehype-sanitize`：

- `skipHtml` 禁用原始 HTML，不启用 `rehype-raw`。
- 保留默认 URL 协议过滤，再用默认 sanitize schema 清洗；被过滤的链接显示普通文字。
- 支持标题、列表、强调、代码、链接、表格和任务清单。
- 外链通过普通浏览器链接打开，使用 `noopener noreferrer`；服务端不抓取链接。
- 当前图片显示替代文字，不自动加载外部图片；附件章节会接入授权资源引用，不能把永久公开存储 URL 写进正文。

“编辑”面板保留原始输入；只有切到“预览”时才取一次正文。解析器通过动态 import 按需加载，不在注册页面加载或每个按键重新解析。超过 1 MiB 的草稿不能预览或提交，但输入保留，用户可以缩减后重试。新增 Markdown 插件时要重新审查其是否生成未经清洗的 HTML/URL。

## 4. 从公开入口验证

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx
just check
```

HTTP 测试使用真实 PostgreSQL，验证字面转义、排序、筛选绑定、输入上限、跨账号不可见和撤权后继续翻页。View 测试从真实页面操作，覆盖键盘切换、安全链接、草稿保留、分页失败重试、空结果和重新查询。

关键旅程完成后运行一次：

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

真实 Chromium 从注册 Member、写作预览、保存、刷新，再通过标题搜索打开正文。日常修改运行定向 HTTP/View 测试，无需每次推送重复浏览器旅程。

## 5. 仿照实现自己的业务

在自己的列表合同增加有界筛选，参数化查询并在 cursor 与 Query key 中包含同一筛选；由服务端完成授权。把内容格式转换放在业务 View 边界，而不是 Core 会话或通用 SDK 中。

本章源码、测试、生成的 Knowledge 操作和教程都归知识库示例；通用 Tabs 是可复用 UI。[所有权清单](../../examples/knowledge-base/manifest.json)记录移除范围。Markdown 依赖仅由示例 Views 使用，删例工具会移除这组依赖登记。

库文档： [react-markdown 10.1.0](https://github.com/remarkjs/react-markdown/tree/10.1.0#security)、[remark-gfm 4.0.1](https://github.com/remarkjs/remark-gfm/tree/4.0.1)、[rehype-sanitize 6.0.0](https://github.com/rehypejs/rehype-sanitize/tree/6.0.0)。
