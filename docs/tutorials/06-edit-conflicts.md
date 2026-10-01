# 版本条件更新与冲突恢复

目标：让自己的可修改资源避免静默覆盖，并返回客户端可恢复的稳定冲突码。前提是已完成[业务事务](04-personal-documents.md)和[资源授权](07-library-grants.md)；幂等创建不能替代并发控制。

## 把预期版本带进协议

知识库[更新 DTO 与 Handler](../../crates/app/src/modules/knowledge/mod.rs)接受 `PUT /api/v1/knowledge/documents/{id}`，输入 `title / markdown / version`，version 必须为正整数；继续要求 Session、Origin 与 CSRF。

[用例](../../crates/app/src/modules/knowledge/application.rs)先持有当前 Membership 和知识库锁、检查权限，再执行条件更新。实际 SQL 摘录：

```sql
UPDATE knowledge.documents
SET title = $1, markdown = $2, version = version + 1,
    updated_by = $3::uuid, updated_at = clock_timestamp()
WHERE id = $4::uuid AND knowledge_base_id = $5::uuid
  AND version = $6 AND deleted_at IS NULL
```

完整实现还返回文档并追加 Audit。两个相同预期版本不能都成功；不在 Handler 先 SELECT 版本再无条件 UPDATE。无权资源返回 404，Reader 修改返回 403，已授权的旧版本保存返回 `409 document.version_conflict`。

## 提交与未知结果

正文、版本和 Audit 同事务提交；Audit 失败回滚版本，修复后可用原 version 重试。响应超时可能发生在提交后，不自动盲重发更新：读取当前版本、核对内容后明确选择下一步。

自己的资源需定义 version 字段、条件更新和冲突错误；Core 没有替全部业务实现乐观并发。若同时支持命令幂等，分别说明重放语义和预期版本语义。

## 验证两位写入者

在仓库根目录执行：

```bash
node scripts/test-backend.mjs --test knowledge
```

[HTTP 测试](../../apps/api/tests/knowledge.rs)用真实 PostgreSQL 锁协调两个请求，观察一个成功、一个 409，再读取最终正文；还验证无权拒绝和 Audit 故障的正文/版本回滚。自己的资源可采用相同公开接口测试，按稳定错误码断言，不依赖翻译后的 message。

## 客户端怎样恢复

参考[编辑 View](../../packages/views/src/knowledge/documents-view.tsx)把草稿和基准 version 与服务器 Query 分开。后台刷新不能覆盖草稿或提高基准版本。409 后保留输入，读取最新资源，要求显式保留/合并或放弃草稿；两种操作都不自动保存。

403/404 后禁用再次保存，重新查询当前权限，未保存文本仍保留。已显示内容无法远程擦除，后续请求按当前权限执行。继续[资源授权](07-library-grants.md)和[成员锁](08-members.md)，再把同样的提交纪律用于[文件发布](09-attachments.md)。
