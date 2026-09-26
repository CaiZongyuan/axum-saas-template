# 跟做：删除资源与可靠清理对象

从[附件](09-attachments.md)和[文档导出](10-document-exports.md)章节的状态开始：用 `just dev` 启动 API、Worker、Web、PostgreSQL 与 RustFS，登录并准备一篇带附件的已保存文档。开发入口会应用本章新增的 0011 文件清理和 0012 知识库删除迁移。

有编辑权时，文档详情提供“删除文档”，附件列表提供“删除附件”。Owner/Admin 可以在知识库页面删除整个库。每个动作先显示确认；取消不会发送删除请求。删除没有回收站，个人知识库也不会被首次写作流程偷偷重建。

确认后，后端立即按新的可见性拒绝读取和签发下载链接，界面刷新对应资源。RustFS 的物理清理由真实 Worker 完成；已经签发的短期 URL 沿用附件章节声明的 TTL 边界。

## 1. 可见性、审计和任务一起提交

[附件删除](../../crates/app/src/modules/knowledge/attachments.rs)重新检查当前 Session、文档编辑权限及附件关联，在同一事务删除业务关联、把 Core File 标为 deleting、登记清理 Job 并写 Audit。审计失败时，附件仍可见，也不会留下独立清理任务。

[文档与知识库删除](../../crates/app/src/modules/knowledge/deletion.rs)采用短事务标记删除，同时保存 Audit 和清理 Job。读取、列表、搜索、修改、上传完成和导出授权都排除已删除资源。较大的库和文档随后按批登记子资源清理，避免 HTTP 请求遍历所有附件或执行 S3 网络调用。

删除整个库会隐藏其文档、附件和导出。Worker 把库中文档交给文档清理任务，再把对象交给 Core Files；文档正文最终从数据库移除。知识库保留不可访问的删除标记，尤其保留个人库与用户的唯一关系，因此自动初始化无法把它复活。没有恢复入口。

文档和库的创建幂等记录保存稳定 ID，重放时重新读取当前资源。旧格式记录也经过这次检查，删除后不能通过旧创建请求取回缓存的正文或库详情。

## 2. 每个对象的位置都有记录

[Core Files 清理](../../crates/app/src/modules/files/cleanup.rs)持有 [object_cleanup 表](../../migrations/0011_file_cleanup.sql)，按不可变的 bucket/key 登记位置。暂存对象、未采用候选和删除资源的最终对象都会进入清理记录；当前 ready 对象只有在删除后才进入这一范围。

每次最多登记/读取 100 个目标。Worker 在事务外调用 S3 Delete，随后以有效租约提交进度。对象已不存在也算成功；一次尝试部分完成后，下一次从未完成的位置继续。所有位置一直保留，任务失败不会抹掉它们。

删除任务使用有限的五次预算。达到上限后，管理员可以在“后台任务”排查并重试；定期维护不会给同一失败任务不断补发新预算。清理任务依据已确认的删除状态工作，普通退出登录不会阻止它完成。

## 3. 为什么完成一次 Delete 后仍要复查

浏览器已经开始的 PUT 或存储端复制，可能在客户端超时甚至首轮清理之后才完成。当前 RustFS 的事实不能证明所有远端写入都有统一的绝对结束时刻；因此不能删一次就忘记这个 key。

已经完成首次删除的位置默认一小时后再次进入复查范围。一个共享的 `files.rescan` Job 每次处理最多 100 个到期位置，继续保留记录并更新下一次检查时间；这不是按每个文件每小时创建一个独立 Job。检查间隔是最早调度时间，实际进度也受待处理数量影响。

记录不会被复用为新文件的位置；服务端生成独立 UUID key，ready 对象不会覆盖。旧任务即使迟到，也只作用于原来登记的对象。测试实际让暂存对象在首次清理后重新出现，再验证复查删除它；同时验证旧任务和暂存回收不影响后来上传的 ready 附件。

## 4. 过期数据自动进入清理

[独立维护循环](../../crates/app/src/modules/jobs/maintenance.rs)默认每 30 秒检查一次，具体由 `JOB_MAINTENANCE_SECS` 配置。维护只做有界数据库工作和入队，存储 I/O 仍在 Job 中执行。它与 Worker 独立轮询，不会因为一项调度查询等待而暂停正在执行的 Handler。

Core 维护发现过期 pending 上传、rejected 上传、未采用候选和已经过期的暂存写入能力。过期/拒绝的上传清理后仍保留明确的 upload_expired / upload_rejected，客户端可以用新上传资源恢复。

[导出维护](../../crates/app/src/modules/knowledge/exports/maintenance.rs)在到期后清除快照正文，登记 ZIP 的文件清理，保留 expired 摘要。用户能看到结果已过期，而不会得到悬空的新链接。

`just dev` 和 `just worker` 已组装这些真实任务与维护能力。Core Files、维护循环和 Worker 保留为模板能力；文档/库清理与导出过期规则由知识库示例注册。

## 5. 删除遇到在途操作

上传完成在对象 I/O 之后重新检查当前文档与知识库。复制途中删除文档或库，即使字节复制成功，也不能再发布 ready 附件；候选位置已经记录，后续仍能清理。

导出也检查当前源资源与快照文件。删除快照中的附件会使尚未执行的导出明确失败，不能把缺文件的 ZIP 当作成功结果。删除源文档或库后，已经生成的导出也不能取得新下载链接。

附件 API 分别返回 `can_upload` 与 `can_delete`：存储关闭不等于失去删除权限；授权降级后的新能力会刷新文档权限，删除按钮随之更新。

前端 [DeleteResource](../../packages/views/src/knowledge/delete-resource.tsx)复用确认与错误反馈，调用生成 SDK。删除附件只刷新附件及预览查询，不重置正在编辑的 Markdown，因此未保存草稿仍在；删除整个文档或库则离开对应页面并刷新资源缓存。

## 6. 验证

```bash
node scripts/test-backend.mjs --test deletion --test attachments --test exports
pnpm exec vitest run apps/web/src/deletion.test.tsx
just check
```

真实 HTTP/PostgreSQL/RustFS 测试覆盖即时不可见、实际对象移除、Audit 回滚、Reader/Editor、错误关联、个人库删除、不复活旧幂等响应、上传完成竞态、导出过期和缺失输入、故障预算/管理员恢复、晚到对象复查及新资源保护。

View 测试验证确认和取消、只读权限、个人库提示，以及删除附件时保留未保存正文。完成关键旅程后运行：

```bash
node scripts/e2e.mjs tests/e2e/deletion.spec.ts
```

浏览器上传真实附件，确认删除后验证 API 拒绝新链接，并等待真实 Worker 使原对象返回 404；再删除文档并重新访问旧地址。正常开发继续使用较快的 HTTP/View 检查，避免重复整套浏览器测试。

## 7. 换成自己的业务

保留 Core Files 的清理记录、Files Handler、Jobs 与独立维护循环。在自己的业务模块实现“确认权限 → 标记不可见 → 同事务登记 Core 文件清理与 Audit”，再提供负责移除业务关联的 Handler。

沿 [Worker 组装入口](../../apps/worker/src/main.rs)替换知识库的 `document_cleanup_handler`、`base_cleanup_handler` 与 `export_maintenance` 注册；文件存储 Handler 和 Core 维护注册继续保留。前端在自己的 View 中组合确认弹窗和生成 SDK mutation，维护该资源的查询失效规则。最后更新[所有权清单](../../examples/knowledge-base/manifest.json)，让自有业务的迁移、HTTP/OpenAPI、Views、任务和教程可以一起替换。
