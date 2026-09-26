# 跟做：用后台任务导出文档

登录后打开已保存文档，在“导出文档”点击“导出当前文档”。页面立即显示等待处理，Worker 生成后出现“下载 ZIP”。记录按最新优先显示，新申请会回到第一页并显示进度；刷新页面仍能找到记录。Reader 也可以申请自己有权读取的文档。ZIP 包含 `document.md` 和附件目录，适合离线保存单篇文档。

这条路径把一个耗时动作从 HTTP 请求拆开：API 负责保存用户的请求，Worker 负责完成它。任务留在 PostgreSQL，停止 Worker 不会把待处理记录丢在内存里；本章不需要 RabbitMQ。

## 1. 启动并实际操作

```bash
just dev
```

开发入口现在启动 PostgreSQL/RustFS，运行迁移和存储初始化，再启动 API、Worker 与 Web。Rust 源码修改会重新启动 API 和 Worker；Web 使用 HMR。Worker 默认健康端口为 `127.0.0.1:3001`。

创建一篇 Markdown，上传一个文本附件，然后申请导出。下载 ZIP，确认正文和附件都在。想观察等待状态时，可以单独使用下面命令启动 Worker；只启动 API/Web 时，请求依然入队。

```bash
just worker
```

`just worker` 加载同一份 `.env.example` / `.env` 与进程环境，启动一个真实 Worker。不要与 `just dev` 的 Worker 同时占用默认健康端口；第二个进程使用独立 `WORKER_BIND`。

Worker 的 `/health/live` 表示进程存活，`/health/ready` 同时检查循环已启动与完整迁移历史。`Ctrl+C` 先停止领取任务，再给当前任务有限的完成时间；数据库和对象存储卷保留。

## 2. 申请时保存快照

[导出 API](../../crates/app/src/modules/knowledge/exports/mod.rs)验证当前文档阅读权，在同一事务内保存：

- Export ID 与请求者；
- 文档版本、标题、Markdown、ready 附件清单；
- 原始凭据的稳定引用；
- PostgreSQL Job 与 Audit。

Job payload 只保存 `export_id`，不复制正文或存储 URL。原始 Session ID 用于随后重新验证，密码、Cookie secret 和哈希不会进入任务 payload。

Idempotency-Key 标识一次导出请求。响应丢失时用相同 key 重试，会取得同一个 Export；其间编辑文档也不会改写这份快照。成功申请后的下一次主动点击会创建新请求，用于导出较新的版本。审计或其他数据库写入失败时，Export、快照、Job 和幂等记录一起回滚。

## 3. Core Jobs 与知识库 Handler

[Core Jobs](../../crates/app/src/modules/jobs/mod.rs)用短事务的 `FOR UPDATE SKIP LOCKED` 领取任务，更新尝试次数、执行者、lease_token 和到期时间后提交。后续网络 I/O 与 ZIP 生成不占着领取事务。

[Worker](../../crates/app/src/modules/jobs/worker.rs)只领取已注册的任务类型，处理期间独立推进续租。续租等行锁时业务仍能继续；续租失败会先取消 Handler、释放其事务，再记录失败，避免自己等待自己持有的锁。完成提交必须仍匹配 token 且租约未过期。知识库 [Handler](../../crates/app/src/modules/knowledge/exports/worker.rs)负责自己的快照、权限和业务结果；Core 不查询知识库表。

Worker 在开始处理、创建候选和最终发布时检查请求者与原始凭据的有效性、源文档和附件。申请后退出该 Session、停用成员、撤销 Grant 或丢失输入，都不能生成可下载的成功结果。一个已经完成的导出在用户用新 Session 登录后仍可按当前权限访问。

基础队列已区分临时错误与永久错误，包含有预算的退避和过期租约领取。继续跟做[任务恢复与管理员重试](11-job-recovery.md)，验证崩溃、旧执行者、尝试历史和管理员重试。

## 4. 有限内存与安全 ZIP

[ZIP 实现](../../crates/app/src/modules/knowledge/exports/archive.rs)不把完整 ZIP 或全部附件放进内存：

1. 顺序读取一个 S3 对象流，落入权限为 `0700` 的临时目录，同时计数并核对 SHA-256；
2. 使用阻塞线程从临时输入文件分块写 ZIP，限制输出文件实际长度，包括 ZIP 头和中央目录；
3. 完成并关闭 ZIP 写入后，重新读取最终文件计算校验和；
4. 用文件 ByteStream 条件 PUT 上传。

ZIP 的 Stored 模式不压缩，便于理解并限制 CPU 开销。内部路径为 `document.md` 与 `attachments/<File ID>.<安全扩展名>`，用户文件名不会变成目录路径，同名附件也不会冲突。

Markdown 先解析，仅改写 Link/Image 中属于快照的 `attachment:<UUID>`，转成 ZIP 内的相对路径；代码和普通文字中的相同字符串仍是文字。出现附件引用时，重新序列化可能规范化空白、转义和引用式链接；导出保证快照内容的语义，不承诺保留原 Markdown 的每个格式字节。未知附件引用保留原目标，不偷偷导入其他文件，也不抓取外部 URL。

同一进程最多一个导出占用打包资源。总 deadline 覆盖下载、ZIP 与发布；阻塞代码按块检查取消。`spawn_blocking` 已经开始后不能强行 abort，因此线程持有临时目录和并发许可，直到它实际退出。普通成功/失败会清理本地文件；SIGKILL 或文件系统故障可能留下临时目录，不能把 Drop 当作崩溃清理保证。临时磁盘不参与备份，失败任务可从数据库快照重建。

主来源与确切库版本见[流式处理研究](../research/document-export-streaming.md)。

## 5. 对象写入与数据库发布

生成的 ZIP 在写入 RustFS 前，先通过 [Core Files](../../crates/app/src/modules/files/mod.rs)登记 File 和唯一候选位置。S3 条件 PUT 使用 `If-None-Match: *`，已存在的候选不能覆盖；上传后核对对象大小、类型和上传标识。

最后重新鉴权、检查有效租约，在同一事务采用 ready 文件、关联 Export、写 Audit 并将 Job 标为 succeeded。超时不证明远端写入失败；未采用的候选和 pending File 仍有持久元数据，后续对象清理章节据此回收。

导出和快照默认保存 24 小时；到期查询显示 expired，不再提供新链接。下载只允许请求者或管理员，而且当前访问者和原请求者都必须仍可读取源文档。现有短期链接沿用附件教程声明的 TTL 边界；导出不会变成永久公开地址。物理删除与过期对象清理在删除章节实现。

## 6. 配置与验证

实际配置来自[生成配置参考](site:reference/config.md)：

| 配置                                  | 默认值     | 用途                      |
| ------------------------------------- | ---------- | ------------------------- |
| `EXPORT_MAX_ATTACHMENTS`              | 100        | 限制条目数                |
| `EXPORT_MAX_INPUT_BYTES`              | 256 MiB    | 正文与附件总量            |
| `EXPORT_MAX_OUTPUT_BYTES`             | 272 MiB    | 包含目录和头部的 ZIP 上限 |
| `EXPORT_TIMEOUT_SECS`                 | 120 秒     | 一次执行的总预算          |
| `EXPORT_RETENTION_SECS`               | 24 小时    | 导出与快照有效期          |
| `JOB_LEASE_SECS / JOB_HEARTBEAT_SECS` | 60 / 20 秒 | 任务租约及续租            |
| `JOB_SHUTDOWN_SECS`                   | 10 秒      | Worker 关停等待           |

临时磁盘峰值约为输入加输出上限，每个活动导出默认约 528 MiB。磁盘不足会使该次尝试失败；这些上限与普通附件的 20 MiB 单文件上限分开。

```bash
node scripts/test-backend.mjs --test exports --test jobs
node scripts/test-storage.mjs generated_files
pnpm exec vitest run apps/web/src/exports.test.tsx
just check
```

HTTP/公开任务测试验证发布跨越续租、续租超时后的事务释放、超过一页历史的新任务可见性、幂等快照、真实 ZIP/附件字节、Session 失效、审计回滚、权限与到期、缺失对象和大小限制。存储适配测试验证多块传输与条件写入；View 测试验证进度、请求重试、失败、过期和下载被拒绝。

完成这条关键旅程后使用真实浏览器验收：

```bash
node scripts/e2e.mjs tests/e2e/exports.spec.ts
```

浏览器上传附件、申请导出，真实 Worker 生成 ZIP，再由独立 JS ZIP 库解压校验正文与附件，最后刷新确认结果可再次访问。日常开发继续使用快速 HTTP/View 反馈。

实现自己的业务时，仿照“在业务事务中入队 → 注册 Handler → 在有效租约内提交结果”，不用复制队列实现。[示例所有权清单](../../examples/knowledge-base/manifest.json)记录知识库 Handler、Views、迁移、测试、配置与教程；Core Jobs、Files、Worker 和 S3 适配器保留。
