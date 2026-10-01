# 构建自己的工单 SaaS 后端

从一条 Rust HTTP 接口开始，把同一个工单模块带到持久化、身份与授权、事务、文件、后台任务、测试和生产部署。全程使用后端接口，不需要写前端。

工单是读者新增的课程业务，默认应用仍保留知识库参考业务。一次部署服务一个 Organization；工单不是新租户。课程采用自己的资源规则：创建者与当前 Owner/Admin 可访问工单，其他成员看不到它。

## 准备与学习顺序

先完成[后端快速开始](../getting-started/quickstart.md)，准备仓库固定的 Rust、Node、pnpm、just 与 Docker。命令在原模板仓库根目录运行：

```bash
export TEMPLATE_ROOT="$PWD"
export COURSE_ROOT="$TEMPLATE_ROOT/.scratch/ticket-saas"
node scripts/tutorial-course.mjs --stage module --root "$COURSE_ROOT"
```

课程工具在这个独立模板副本接入代码，不注册进原模板默认应用。它为副本分配独立 Compose 项目、卷和空闲端口，将公开请求地址写入 `.course.env`；后续检查点沿用这些配置。每次升级前停止副本的开发进程，在原模板执行命令，再进入副本运行。自己改过课程文件时先保存差异，避免把检查点更新当作合并工具。

| 课                           | 开发目标                           | 代码检查点  |
| ---------------------------- | ---------------------------------- | ----------- |
| [01](01-module.md)           | 模块、Router 与 OpenAPI            | `module`    |
| [02](02-migrations.md)       | 自有 schema 与迁移，第一次真实写入 | `crud`      |
| [03](03-protocol.md)         | 输入输出、校验与公开错误           | 沿用 `crud` |
| [04](04-authorization.md)    | Session、有效成员与工单权限        | 沿用 `crud` |
| [05](05-transactions.md)     | 业务与审计共同提交                 | 沿用 `crud` |
| [06](06-retries-versions.md) | 幂等重放与并发版本                 | 沿用 `crud` |
| [07](07-files.md)            | 文件上传、核验、发布与下载         | `files`     |
| [08](08-jobs.md)             | JSON 快照导出、Worker 与通知       | `jobs`      |
| [09](09-verification.md)     | HTTP 检查与生成 SDK                | 沿用 `jobs` |
| [10](10-production.md)       | 部署、观测、备份与独立恢复         | 沿用 `jobs` |

四个检查点提供完整可运行代码；03–06 在同一份 CRUD 实现上逐项验证责任，不运行一套没有授权的中间业务。完整来源在 [examples/tutorial-tickets](../../examples/tutorial-tickets/)；源码片段与这一份实现共用，不能从零散片段拼出缺少 helper 的应用。

## 课程的业务合同

Ticket 有标题、描述、`open | closed` 状态和整数版本。创建使用 Idempotency-Key；更新携带预期版本。资源授权先于读取、重放和发布。

附件属于工单，Core Files 拥有对象状态。导出是最多 64 KiB 的 JSON，保存请求时的工单与附件元数据，不包含附件字节或 ZIP。产物业务保留 1 小时；下载与 Worker 发布重新核对身份、成员与资源权限，任务发起 Session 失效后不能发布。

这些是课程业务的选择，不是 Core 自动提供的工单规则。协议与调用合同以实际 Rust/OpenAPI 为准；章节的验证命令是需要执行的检查，页脚 SHA 只标识构建来源。

下一步：[新增第一条工单接口](01-module.md)。
