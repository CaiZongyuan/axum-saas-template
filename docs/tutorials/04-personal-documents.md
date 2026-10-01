# 模型、业务事务与幂等

目标：在自己的模块实现“校验输入 → 授权 → 保存 → 审计 → 提交”，并保护用户重试。前提是已有[业务 Router](../guides/develop-module.md)和 [Session](03-sessions.md)。本页以知识库完整实现为参照，知识库表和规则属于参考业务。

## 代码放在哪里

| 责任     | 知识库参考位置                                                          | 自己的业务要定义什么               |
| -------- | ----------------------------------------------------------------------- | ---------------------------------- |
| 数据归属 | [业务迁移](../../migrations/0003_knowledge.sql)                         | 自己的 schema、表、约束和索引      |
| 纯规则   | [domain.rs](../../crates/app/src/modules/knowledge/domain.rs)           | 输入规范化和业务上限               |
| 用例     | [application.rs](../../crates/app/src/modules/knowledge/application.rs) | 授权、SQL、事务和 Core 调用        |
| 协议     | [mod.rs](../../crates/app/src/modules/knowledge/mod.rs)                 | 请求/响应、Handler、Router/OpenAPI |

参考内容规则是标题 1–200 字符、Markdown 最多 1 MiB UTF-8，拒绝 NUL；这不是所有 SaaS 实体的统一限制。`BoundedJson<T>` 只处理 HTTP JSON 与读取预算，字段规则仍由自己的 Domain 判断。

## 一次保存的提交顺序

Knowledge 创建用例先锁定当前 Membership，再锁定并授权目标知识库；个人库仅在真正首次创建时赋予 Editor Grant，不会为被撤权的已有库补授权。库、Grant、Document、Audit 和幂等记录共同提交，正文保存在 PostgreSQL。

自己的业务同样由用例持有 `pool.begin()` 创建的事务，把同一连接传入 Core；不要让审计或任务另开事务，也不要在事务里执行对象存储网络 I/O。

## 接入公共幂等能力

[Core Idempotency](../../crates/app/src/modules/idempotency/mod.rs)公开这些接口：

```rust
pub fn fingerprint(payload: &impl Serialize) -> Result<Vec<u8>, Error>;
pub async fn claim(connection: &mut PgConnection, attempt: &Attempt<'_>)
    -> Result<Option<Value>, Error>;
pub async fn complete(connection: &mut PgConnection, attempt: &Attempt<'_>, response: Value)
    -> Result<(), Error>;
```

这是签名摘录；完整调用见 `application.rs` 的 `create`。`Attempt` 为 `actor_id / scope / key / fingerprint`。先重新授权，再以规范化输入计算摘要、claim：`Some` 为重放，`None` 执行新写入、Audit、complete，最后 commit。scope 应含操作和资源 ID，不让不同目标共享命令。

key 为 1–128 字节的可打印非空格 ASCII。同用户/作用域/key 改变输入返回 Conflict；默认记录期限 24 小时，过期 key 可以重新使用。重放只存稳定 ID，重新读取当前资源与可见性，避免删除后返回缓存正文；短期签名 URL 不进入记录。

## 验证与失败恢复

在仓库根目录运行，测试运行器会创建隔离的真实依赖：

```bash
node scripts/test-backend.mjs --test knowledge
```

[公开 HTTP 测试](../../apps/api/tests/knowledge.rs)创建文档再读取，验证同 key 只写一次、改输入 409、无权不可见、并发首次创建和 Audit 故障整体回滚。自己的 API 至少覆盖同样的创建/读取、重试和回滚路径。

网络响应丢失时保留原输入和 key，由用户明确重试；输入改变生成新 key。SDK 不自动重试 POST。版本条件更新是另一项责任，继续[并发修改](06-edit-conflicts.md)；读取列表接着实现[筛选和分页](05-search-preview.md)。
