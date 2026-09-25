# 跟做：显式保存与版本冲突

本章在上一章的安全预览上加入编辑。运行 `just dev`，打开自己的文档，点击“编辑文档”，修改标题或 Markdown，然后“保存文档”。成功后返回阅读页，版本递增；列表标题与正文缓存随之更新。

## 1. 先亲手制造一次冲突

1. 在两个浏览器标签页打开同一篇文档的编辑页，确认两边都显示“基于版本 1 编辑”。
2. 在第一个标签页写“第一份修改”并保存，阅读页显示版本 2。
3. 在第二个标签页写“第二份草稿”并保存。此时显示版本冲突，草稿保留。
4. 点击“读取最新版本”，看到已保存的版本 2。编辑框仍是自己的草稿。
5. 核对后选择“已核对，保留草稿并继续”，手动合并文字再保存；或者选择“放弃草稿，采用最新内容”。这两个选择都不会自动保存。

如果第三次修改又在你保存前提交，新保存仍会得到冲突。没有自动覆盖，也不把多人实时协同或历史版本浏览混入本章。

## 2. 一次条件更新决定谁能成功

[更新 API](../../crates/app/src/modules/knowledge/mod.rs)使用 `PUT /api/v1/knowledge/documents/{id}`，请求包含 `title / markdown / version`。它沿用 Session、Origin、CSRF、输入上限与结构化错误。版本必须为正整数。

[更新用例](../../crates/app/src/modules/knowledge/application.rs)先锁定当前 Membership，再锁定 Knowledge Base 并检查 Grant。无权看文档返回 404，Reader 的写入返回 403。更新只在请求 version 等于数据库当前 version 时成功，同时递增 version、更新作者和时间。

```sql
UPDATE knowledge.documents
SET title = $1, markdown = $2, version = version + 1
WHERE id = $3 AND version = $4;
```

这是并发控制的简化形状，完整代码还包含知识库归属、授权和审计。两个写入无需先读版本再在应用内比较：数据库条件更新保证它们不能同时覆盖同一版本。落后的保存返回 `409 document.version_conflict`。

文档修改和 Audit 在同一事务提交。审计失败会回滚正文和版本，修复后仍可用原版本重试。文档更新使用 version；创建时的幂等键不能替代并发控制。网络错误后不要自动盲目重发更新，读取最新版本并核对实际提交结果。

## 3. 草稿与服务器资源分开

[共享编辑界面](../../packages/views/src/knowledge/documents-view.tsx)复用创建表单、Markdown 预览和生成 SDK。Query 管理已保存资源；输入框与基准版本组成一次本地编辑会话。后台刷新可以更新 Query 中的服务器内容，但不会自动替换正在编辑的文本或基准版本。

冲突后再次保存先禁用，用户必须读取并核对最新内容。网络失败和冲突都保留输入。保存期间禁用写入控件，成功后更新相关列表与详情缓存；退出页面后的迟到响应不会把用户导航回来，身份变化后的旧响应也不能重新写入上一身份缓存。

## 4. 页面离开与浏览器刷新

[Web 导航适配](../../apps/web/src/knowledge-navigation.tsx)使用 TanStack Router blocker。共享 View 只通知宿主草稿是否发生变化，不 import Router 或实现另一套 Web 页面。

站内离开显示“继续编辑 / 确认离开”对话框；浏览器刷新或关闭使用原生 beforeunload 提示，其文案由浏览器决定。保存成功后的导航直接完成。离开时已经发出的保存请求仍可能在服务器完成，因此重新打开时要以服务端内容为准；本章不承诺本地持久草稿。

## 5. 验证公开行为

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx
just check
```

HTTP 测试通过真实 PostgreSQL 锁协调两个并发请求，确认一个成功、一个 409，随后从读取接口验证最终正文；还验证 Reader/不可见文档拒绝和审计失败回滚。View 测试验证保存中禁用、后台刷新不丢草稿、冲突读取与显式恢复、取消离开保留输入。

关键旅程完成后集中运行：

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

第二个浏览器场景用两个真实标签页制造冲突，人工合并后从另一页刷新确认版本 3。日常修改继续使用定向 HTTP/View 测试。

## 6. 应用于自己的业务

任何可能被两个人修改的记录都可以携带版本：表单记住读取时的 version，服务端在授权事务内条件更新，客户端在 409 后保留输入并展示恢复选择。不要在 Controller 里“先 SELECT 再无条件 UPDATE”，也不要每次后台刷新都把服务器对象复制进表单。

本章编辑 Views、Web 接线、API、合同类型、测试与教程都归知识库示例。[所有权清单](../../examples/knowledge-base/manifest.json)登记这些入口；通用 AlertDialog 留在 UI 包，可由下一种业务复用。
