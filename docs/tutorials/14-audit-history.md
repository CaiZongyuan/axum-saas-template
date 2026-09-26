# 跟做：从业务操作追溯审计记录

使用 `just dev` 启动应用，以 Owner 或 Admin 登录。创建或编辑一篇文档，从首页进入“审计记录”，在“资源 ID”输入文档地址中的 ID，在“动作”输入 `knowledge.document.create` 或 `knowledge.document.update`，点击“筛选记录”。页面展示操作者、资源类型、资源 ID、请求 ID 和关联 ID，可加载后续记录或刷新到最近一页。

正文、文档标题和附件内容不出现在审计记录里。管理员可以从浏览器网络面板找到该次写入响应的 `x-request-id`，填入“请求 ID”精确匹配，再用同一个值搜索 API 的结构化日志。Trace 追踪由后续观测章节接入；当前没有真实 Trace ID 时保留空值。

普通成员直接打开 `/audit` 或调用审计 API 都没有全局访问权。已经打开页面的管理员被降级后，再次筛选、分页或刷新也会收到拒绝，旧行不再显示。

## 1. 业务和成功审计一起提交

[Core Audit](../../crates/app/src/modules/audit/mod.rs)公开 `Event` 与 `Source`，业务模块传入明确的动作、资源类型、资源 ID 和操作者，再用自己的事务调用 `audit::append`。

[文档创建与修改](../../crates/app/src/modules/knowledge/application.rs)、[知识库授权](../../crates/app/src/modules/knowledge/grants.rs)以及成员管理都沿用同一模式：验证当前权限，执行 mutation，追加成功审计，再提交事务。审计数据库操作失败时，业务 mutation 不会独立提交。被权限、版本冲突或其他规则拒绝的写入也不能留下成功审计。

这不是把整个请求体序列化到一个日志字段。`Event` 没有任意 JSON 或正文输入；metadata 目前只允许 `subject_user_id`，表示共享资源操作影响的用户。例如 Grant 的资源是知识库授权，资源 ID 为知识库 ID，受影响用户是被授予或撤销权限的成员。默认个人库的初始授权也记录目标用户。

注册、成员调整、知识库创建/更名/删除、文档变更、附件完成/删除、导出请求/完成和管理员任务重试都已通过公开 Audit 能力接入。注册密码、Session、签名链接以及业务内容不会传给审计。

## 2. HTTP 和后台任务的来源不同

普通 HTTP 写入使用 `Source::Request`：`request_id` 与 `correlation_id` 都对应本次真实请求；用户身份保存在 `actor_id`。

[导出 Worker](../../crates/app/src/modules/knowledge/exports/worker.rs)使用 `Source::Job`：`job_id` 对应实际租约中的 Job ID，`correlation_id` 保留最初导出请求的 ID，`request_id` 为空。操作者仍是发起导出的用户，不把 Job ID 假装成用户 ID，也不把原请求伪装成 Worker 新发出的 HTTP 请求。

可以先按关联 ID 找到导出请求和完成记录，再按任务 ID 查询具体后台操作，并到“后台任务”查看批次、重试与错误历史。尚未接入真实追踪时 `trace_id` 为空，不把 request_id 改名充当 Trace ID。

[0014 迁移](../../migrations/0014_audit_context.sql)补全历史记录可推导的资源类型和请求关联，保留原始事实；旧记录没有可靠的 Job/Trace 身份时仍为空，不通过猜测回填。

## 3. 受保护的查询与分页

`GET /api/v1/audit-events` 先验证当前 Session，再通过 Organization 的公开能力锁定并检查有效 Owner/Admin 角色。查询完成前保留角色共享锁，使已确认的查询与并发降级具有明确先后顺序。

支持精确过滤 `action / resource_type / resource_id / actor_id / request_id / correlation_id / job_id`。默认 50 条，最多 100 条，按审计 UUIDv7 倒序；接口只返回当前页和下一页游标，不返回全表。

游标绑定当前管理员和全部过滤条件，不能把另一用户或另一组过滤的游标混进当前请求。无效 UUID、越界数量、超长或包含 NUL 的过滤值都返回统一 400 错误。常用的资源、动作、操作者和关联字段有对应索引。

[AuditView](../../packages/views/src/audit/audit-view.tsx)通过生成 SDK 查询，提供加载、无匹配、错误重试和分页。筛选在提交表单后生效，重新筛选或刷新从最新页开始；获取失败或权限失效时不继续展示旧缓存行。

## 4. 验证真实结果

```bash
node scripts/test-backend.mjs --test audit --test audit_knowledge --test exports
pnpm exec vitest run apps/web/src/audit.test.tsx
just check
```

Core HTTP 测试验证真实注册审计、成员无权、管理员筛选分页与降级拒绝。知识库 HTTP 测试验证文档/授权与响应 request_id 一致、metadata 不复制内容、审计故障导致文档写入回滚且查询不到成功记录；真实 Worker 测试把导出完成记录与 Job 查询结果相互核对。

View 测试操作筛选表单、加载后续页并模拟权限失效；完整关键流程完成后运行一次：

```bash
node scripts/e2e.mjs tests/e2e/audit.spec.ts
```

真实浏览器创建文档，取得实际资源和请求 ID，再在审计页面查询对应记录；日常开发继续使用较快的 HTTP/View 检查。

## 5. 仿照实现自己的业务

为自己的 mutation 选择稳定动作名和资源类型，在同一事务调用 `audit::append`。前台请求传 `Source::Request`，后台完成传真实 `Source::Job`，避免在 Core 写业务表查询或按业务名称猜测资源。

只记录排障所需的资源与身份标识。确需增加 metadata 时，先定义明确、安全的字段并同步调整迁移允许列表与合同；不要开放整份请求、正文或任意 metadata map。

Audit API、通用 View、Core 迁移和注册/成员测试不属于知识库示例。本章、知识库业务测试和浏览器旅程登记在[示例所有权清单](../../examples/knowledge-base/manifest.json)，替换业务时一并调整，Core 审计入口继续工作。
