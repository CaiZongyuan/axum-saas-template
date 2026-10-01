# 查询筛选与分页合同

目标：给自己的列表 API 增加有界筛选和稳定分页，同时避免泄露无权资源。前提是已有[持久业务](04-personal-documents.md)及资源权限策略。知识库的搜索和 Markdown 预览是参考实现，预览属于可选客户端能力。

## 从协议到查询

[DocumentsQuery](../../crates/app/src/modules/knowledge/mod.rs)定义 `knowledge_base_id / q / limit / cursor`：不传库 ID 时只查个人库；`q` 最多 200 字符、去首尾空白、拒绝 NUL；`limit` 默认 50、上限 100。列表只返回摘要和 `next_cursor / has_more`，不返回正文或全表总数。

[实际查询](../../crates/app/src/modules/knowledge/application.rs)的关键形状如下，完整 SQL 还包含当前权限、未删除状态和库范围：

```sql
AND ($3::timestamptz IS NULL OR (d.created_at, d.id) < ($3::timestamptz, $4::uuid))
AND d.title ILIKE $6
ORDER BY d.created_at DESC, d.id DESC
LIMIT $5
```

输入先转义 LIKE 的 `%`、`_`、反斜杠，再绑定参数。因此 `100%_` 是字面子串，不是用户控制的通配符。权限、筛选和分页共同进入数据库查询，不先查询私密标题再交给客户端过滤。

## 游标是位置

[Cursor](../../crates/app/src/modules/knowledge/pagination.rs)绑定账号、库范围、排序、规范化关键词摘要与末条位置；改变账号/范围/关键词就重新从第一页查询。每页独立授权；cursor 不是凭据，也不提供跨页数据库快照。

多取一条判断下一页，避免无限列表。客户端 Query key 使用相同身份/范围/筛选，参考 View 最多保留十页；无效或混用 cursor 返回结构化 400，不退回全表查询。

## 验证后端结果

从仓库根目录执行：

```bash
node scripts/test-backend.mjs --test knowledge
```

[HTTP 检查](../../apps/api/tests/knowledge.rs)验证 `%/_` 字面搜索、顺序、跨账号不可见、筛选绑定和撤权后的翻页拒绝。自己的列表至少验证两页无重复、变更筛选后旧 cursor 拒绝、无权标题不出现在结果、limit 上限和非法输入。

## 可选 Markdown 客户端

需要内容预览时复用[安全渲染参考](../../packages/views/src/knowledge/markdown-content.tsx)：`react-markdown / remark-gfm / rehype-sanitize`，禁止 raw HTML，保留 URL 协议过滤。服务端不抓取外链，外部图片不自动加载；附件通过[授权引用](09-attachments.md)显示，不保存签名 URL。

预览按需加载，草稿与已保存资源分开，超出正文预算保留输入并拒绝预览/提交。它不是后端权限过滤的替代。自己的文本搜索规则可以不同，但需同时更新 DTO、SQL、cursor 和测试；接着实现[版本条件更新](06-edit-conflicts.md)。
