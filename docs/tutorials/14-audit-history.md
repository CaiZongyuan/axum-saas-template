# 在自己的业务事务追加审计

目标：让自己的 mutation 和成功审计共同提交，并关联 HTTP 与后台操作。前提是已有事务用例；审计是持久事实，日志/trace 是可丢失的观测数据。

<!-- example:knowledge:reference-01:start -->

完整参考：[事务用例](04-personal-documents.md)。

<!-- example:knowledge:reference-01:end -->

## 最小公共调用

[Audit](../../crates/app/src/modules/audit/mod.rs)公开 `append(connection, Event)`。这个完整小函数可放在自己的模块；调用者在同一事务完成工单更新后调用，再 commit，错误向上传播并回滚业务：

```rust
use crate::modules::audit;
use sqlx::PgConnection;

pub async fn record_ticket_update(
    connection: &mut PgConnection,
    actor_id: &str,
    ticket_id: &str,
    request_id: &str,
) -> Result<(), sqlx::Error> {
    audit::append(connection, audit::Event {
        actor_id,
        action: "tickets.update",
        resource_type: "tickets.ticket",
        resource_id: ticket_id,
        source: audit::Source::Request(request_id),
        subject_user_id: None,
    }).await
}
```

动作/资源名称由自己的业务定义。被权限或版本拒绝的请求不能写成功审计。Event 没有任意 metadata map，只有可选 `subject_user_id`；不复制标题、正文、密码、secret、签名 URL 或原请求。

<!-- example:knowledge:reference-02:start -->

完整参考：[Knowledge 用例](../../crates/app/src/modules/knowledge/application.rs)。

<!-- example:knowledge:reference-02:end -->

## 正确记录来源

| 来源   | 使用方式                             | 持久关联                                  |
| ------ | ------------------------------------ | ----------------------------------------- |
| HTTP   | `Source::Request(request_id)`        | request_id 与 correlation_id 对应实际请求 |
| Worker | `Source::Job { id, correlation_id }` | 真 Job ID 与最初业务关联；request_id 为空 |

actor_id 始终是发起业务的 User ID，不把 Job ID 当用户。真实 trace 接入后记录当前 span 的 trace_id；不存在时留空，不把 request_id 改名。参考Worker和[观测指南](19-observability.md)。

<!-- example:knowledge:reference-03:start -->

完整参考：[Worker](../../crates/app/src/modules/knowledge/exports/worker.rs)。

<!-- example:knowledge:reference-03:end -->

## 使用受保护的查询

`GET /api/v1/audit-events` 需要当前 Owner/Admin，并持有成员共享锁至查询结束。支持精确 `action / resource_type / resource_id / actor_id / request_id / correlation_id / job_id` 过滤；默认 50、最多 100，UUIDv7 倒序，cursor 绑定管理员和全部过滤。

无效 ID、超长/含 NUL 过滤、越界数量或混用 cursor 返回统一 400。降级后新请求拒绝；客户端应清旧行。API 不返回业务内容，不保证永久保留策略，部署方仍需定义备份/留存。

## 验证与适配

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test audit
```

<!-- example:knowledge:reference-04:start -->

```bash
node scripts/test-backend.mjs --test audit_knowledge --test exports
```

<!-- example:knowledge:reference-04:end -->

[Core HTTP 检查](../../crates/app/tests/audit.rs)验证管理员过滤/分页/降级；业务检查核对响应 request_id 和审计、拒绝复制内容，并使 Audit 失败观察业务回滚。自己的测试应读业务结果再查询对应动作，不能只断言 append 被调用。

<!-- example:knowledge:reference-05:start -->

完整参考：[业务检查](../../apps/api/tests/audit_knowledge.rs)。

<!-- example:knowledge:reference-05:end -->

选择稳定动作和安全标识，在调用者事务用 append；若确需更多 metadata，先定义明确字段、允许列表、迁移和合同。审计与任务管理为 Core，业务专有事件与测试由自己的模块维护。继续[只读 API Key](15-api-keys.md)或[观测关联](19-observability.md)。
