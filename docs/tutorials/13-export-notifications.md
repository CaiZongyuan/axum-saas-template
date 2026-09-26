# 跟做：导出结果通知与已读状态

从[文档导出](10-document-exports.md)继续：运行 `just dev`，登录后保存一篇 Markdown 文档，申请导出。Worker 完成后，从首页进入“通知”，看到“文档导出完成”和未读数量。点击“查看结果”，通知标记为已读，并打开这一次导出的详情，可下载 ZIP；返回通知并刷新，已读状态仍在。

如果任务最终失败，会看到“文档导出失败”。临时失败进入重试等待时不提醒；[任务恢复](11-job-recovery.md)耗尽预算或发生永久错误后才通知。详情查询的是当前结果，因此管理员后来恢复了任务，原来的失败通知也能带你看到最新成功状态。

## 1. 先登记意图，后发布结果

[导出请求](../../crates/app/src/modules/knowledge/exports/requests.rs)在同一个 PostgreSQL 事务内保存快照、入队 Job、调用 Core `notifications::on_job_outcome`，再写 Audit 和幂等响应。登记内容包括：

- 收件人：提出导出请求的用户。
- 事件键：`knowledge.export:<export_id>`。
- 通用描述：“文档导出”。这里不复制私密文档标题、正文或签名链接。
- 导航目标：类型 `knowledge.export`、导出 ID、上下文里的文档 ID。

意图存入 Core 的 `job_notifications`，此时不出现在通知列表。事务回滚时，Job、快照、意图和 Audit 一起撤销。Core 不读取知识库表；即使之后文档和导出记录被清理，意图仍允许最终失败通知发给原请求者。

## 2. 结果与通知一起提交

[Core Jobs](../../crates/app/src/modules/jobs/mod.rs)在三个终态入口调用 Notifications：有效租约成功提交、失败达到终态，以及领取时发现上一次执行崩溃且预算耗尽。

成功发布 ZIP 时，文件状态、Export 结果、Audit、Job 终态和站内通知处于同一数据库事务。通知插入失败，其他数据库结果也不能独自变成成功；已经上传的未采用对象继续受[清理机制](12-deletion-cleanup.md)管理。失败通知也与 Job/历史状态一起提交，不依赖一定有 Handler 活着执行到错误分支。

没有登记通知意图的 Job 不生成通知，例如后台文件清理。这里的站内通知只是数据库操作，后续邮件章节才会涉及外部投递。

## 3. 重试为什么不会重复提醒

[通知迁移](../../migrations/0013_notifications.sql)用 `(recipient_id, event_key, outcome)` 约束逻辑消息唯一。重复执行遇到同一个成功或失败事件时保留原消息，包括 ID、创建时间和已读时间。

一次导出先失败、经管理员显式重试后成功，可以有一条失败通知和一条成功通知。重复失败不会反复增加提醒，重复成功也不会重新变成未读。新的导出请求拥有新的 Export ID，因而产生独立事件。

## 4. 收件箱只属于当前用户

[Core Inbox](../../crates/app/src/modules/notifications/inbox.rs)提供两个生成合同中的接口：

- `GET /api/v1/notifications`：按发布时间倒序读取；默认 50 条，上限 100，可用 `unread_only=true` 与返回的游标继续读取。游标绑定当前用户和过滤条件，未读总数与该页使用同一数据库快照。
- `POST /api/v1/notifications/{id}/read`：需要当前 Session、Origin 和 CSRF，重复调用保留第一次 `read_at`。

查询和更新都以当前用户为收件人，管理员也不能读取或修改别人的收件箱。返回内容不含 Job payload、凭据或下载能力。读通知不代表获得目标资源访问权。

[共享 NotificationsView](../../packages/views/src/notifications/notifications-view.tsx)调用生成 SDK，展示加载、空列表、未读、失败、重试和分页。点击“刷新通知”回到最新一页；页面状态和 Query 缓存按身份隔离。

## 5. 导航目标不是下载授权

[Web 入口](../../apps/web/src/router.tsx)在示例组装区识别 `knowledge.export`，检查文档/导出 ID，然后把导航回调交给 Core View。未知类型只能标记已读，显示功能当前不可用。

[导出详情 View](../../packages/views/src/knowledge/export-detail-view.tsx)重新请求该次导出，后端检查当前会话、结果归属和源文档读取权限。源文档删除或撤权后，仍能阅读通用通知，但无法取得结果或新下载链接。结果过期时不能下载；已签发链接的 TTL 仍遵守附件与导出章节约定。

这使模板移除知识库示例后仍保留通知列表和已读能力。示例清单登记导出详情、目标解析区块、业务测试及本章；Core 通知迁移、API、View 和通用 HTTP 测试继续存在。

## 6. 验证

```bash
node scripts/test-backend.mjs --test notifications --test exports
pnpm exec vitest run apps/web/src/notifications.test.tsx apps/web/src/export-notifications.test.tsx
just check
```

HTTP/公开 Job 测试验证收件人隔离、管理员不能越权、CSRF、持久已读、游标限制、失败预算、失效租约、重试去重以及通知故障与结果的原子回滚。真实 RustFS 导出测试覆盖成功/失败通知、删除源资源后的拒绝，以及恢复后只发布一份结果。

完成整条关键旅程后运行一次：

```bash
node scripts/e2e.mjs tests/e2e/exports.spec.ts
```

真实浏览器注册、编写、上传附件、导出并校验 ZIP 字节，再打开真实通知、进入详情、刷新验证已读。常规开发继续用较快的接口与 View 测试。

## 7. 换成自己的业务

在自己的业务请求事务里先 `jobs::enqueue`，再用 `notifications::on_job_outcome` 登记稳定的业务事件键和收件人。使用通用描述，目标仅携带业务标识；不要把不能永久展示的内容复制进收件箱。

在 Worker 中保持已有的租约锁与 `Lease::succeed` 事务边界；Core 会自动发布结果通知，包括最终失败和崩溃耗尽预算。最后在应用壳组装自己的目标解析回调、详情页及其授权 API，按[所有权清单](../../examples/knowledge-base/manifest.json)登记可替换资源。无需让 Notifications 了解自己的业务表。
