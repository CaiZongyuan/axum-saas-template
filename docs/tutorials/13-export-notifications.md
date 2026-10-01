# 在业务事务登记结果通知

目标：给自己的后台业务接入终态通知和 Core 收件箱。前提是已用[Jobs](10-document-exports.md)入队并在有效租约事务发布结果；通知意图和可见消息不是同一阶段。

## 登记公共通知意图

[Notifications](../../crates/app/src/modules/notifications/mod.rs)公开 `on_job_outcome(connection, job_id, JobNotification)`。下面是可以放在自己模块的完整小函数；调用者已授权并持有业务/enqueue 事务，传入本次 Job 与业务结果 ID：

```rust
use crate::modules::notifications::{self, JobNotification, NotificationTarget};
use sqlx::PgConnection;

pub async fn register_result_notice(
    connection: &mut PgConnection,
    job_id: &str,
    actor_id: &str,
    result_id: &str,
) -> Result<(), sqlx::Error> {
    let event_key = format!("tickets.export:{result_id}");
    notifications::on_job_outcome(connection, job_id, JobNotification {
        recipient_id: actor_id,
        event_key: &event_key,
        subject: "Ticket export",
        target: NotificationTarget {
            kind: "tickets.export".into(),
            resource_id: result_id.into(),
            context: Default::default(),
        },
    }).await
}
```

`tickets.export` 是自己的业务事件名，不是已注册 Core 类型。将登记与快照、Job、Audit 和幂等结果一起提交，此时 inbox 还不可见。当前每个 Job 一个收件人；事件键/subject 1–200 字符，target JSON 最多 4096 字节。

<!-- example:knowledge:reference-01:start -->

完整参考：[Knowledge 请求](../../crates/app/src/modules/knowledge/exports/requests.rs)。

<!-- example:knowledge:reference-01:end -->

subject 用通用描述，撤权后仍可显示；target 只放业务标识，不放私密标题、正文、凭据或下载 URL。target 是导航提示，不是授权能力。

## 终态消息与结果共同提交

Core 在 `Lease::succeed`、最终 fail、崩溃后预算耗尽的事务发布消息；retry_wait 不通知。成功结果、文件、Audit、Job/历史和通知共同提交，通知失败会回滚数据库发布；远端未采用对象仍按[清理规则](12-deletion-cleanup.md)回收。

`publish_job_outcome` 是 `pub(crate)`，自己的 Handler 不直接调用；返回 Ok 也不能替代 `Lease::succeed`。没有通知意图的 Job 不生成消息。

[唯一约束](../../migrations/0013_notifications.sql)为 `(recipient_id, event_key, outcome)`：重复成功/失败保留原 ID 与 read_at。一次业务先失败后管理员重试成功，可各有一条；重试不重复提醒或重置已读。

## 收件箱和业务目标

`GET /api/v1/notifications` 默认 50、最多 100，支持 `unread_only` 和绑定身份/过滤的 cursor；未读数和页面同快照。`POST /api/v1/notifications/{id}/read` 要求 Session、Origin、CSRF，重复标读保留第一次时间。管理员也不能读别人的收件箱。

自己的业务详情 API 重新授权；源资源删除/撤权时通知仍可读，结果不再可访问。可选客户端通过示例贡献注册 `describeNotification / resolveNotificationTarget`；未注册或移除类型保留通用显示和标读，不跳向不存在页面。

<!-- example:knowledge:reference-02:start -->

完整参考：[示例贡献](../../packages/views/src/knowledge/app-example.tsx)。

<!-- example:knowledge:reference-02:end -->

## 验证

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test notifications
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test exports
```

<!-- example:knowledge:reference-03:end -->

[Core 检查](../../crates/app/tests/notifications.rs)证明收件人隔离、CSRF、终态可见性、已读持久和重试去重；发布检查证明通知故障导致结果回滚。自己的业务测试先断言登记后不可见，再驱动真实 Worker，查 inbox 与结果，并检查撤权后的目标拒绝。继续[审计接入](14-audit-history.md)。

<!-- example:knowledge:reference-04:start -->

完整参考：[发布检查](../../apps/api/tests/exports.rs)。

<!-- example:knowledge:reference-04:end -->
