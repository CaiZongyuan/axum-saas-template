# 为自己的资源定义授权

目标：复用 Core 的当前成员资格，同时把资源访问规则留在自己的业务。前提是已有 [Session](03-sessions.md) 与[业务用例](04-personal-documents.md)。认证、企业角色和具体资源授权是三个不同判断。

## Core 提供身份，业务提供规则

Knowledge Base Grant 是参考业务策略，不是通用租户或 ACL 服务。完整实现见[库用例](../../crates/app/src/modules/knowledge/bases.rs)、[Grant](../../crates/app/src/modules/knowledge/grants.rs)和[文档授权](../../crates/app/src/modules/knowledge/application.rs)：

| 当前资格         | 读取/搜索 | 写入     | 管理库和 Grant |
| ---------------- | --------- | -------- | -------------- |
| 有效 Owner/Admin | 所有库    | 所有库   | 允许           |
| Member + Reader  | 已授权库  | 拒绝     | 拒绝           |
| Member + Editor  | 已授权库  | 已授权库 | 拒绝           |
| Member 无 Grant  | 不可见    | 不可见   | 拒绝           |

个人库沿用同一策略，Owner/Admin 可以访问。自己的工单、项目或账单需明确不同的规则，例如作者或管理员可访问，不能把 Knowledge 的全库管理规则直接宣称为 Core 默认。

## 在事务里检查当前资格

[Organization](../../crates/app/src/modules/organization/mod.rs)公开接口摘录：

```rust
pub async fn active_role_in(connection: &mut PgConnection, user_id: &str)
    -> Result<Option<MemberRole>, sqlx::Error>;
pub async fn lock_memberships(connection: &mut PgConnection, user_ids: &[String])
    -> Result<Vec<MembershipAccess>, sqlx::Error>;
```

单人写入先取 Membership 共享锁，再锁业务资源、读取自己的授权关系。多成员授权先按 ID 顺序锁定操作者/受影响成员，再取资源锁；返回行需检查 active、role 和是否包含全部目标。`active_role` 无锁，不能代替写事务内的检查。

参考写入持有知识库共享锁，Grant 变更持有库排他锁：保存先取得锁，则撤权等待保存完成；撤权先提交，则后续保存被拒绝。授权与 Audit 共同提交，幂等重放、缓存和后台发布也不能跳过重新授权。

## 让所有入口遵守同一规则

列表和搜索在 SQL 内过滤当前可见性；详情、修改、删除、附件、导出各自检查资源关联和删除状态。无权看资源返回 404，可看但不能修改返回 403。`can_edit / can_manage / can_create` 仅改善客户端反馈，执行请求仍检查。

Core 不读取自己的业务表。Knowledge 的 `lock_document` 等是私有参考实现，不能从新模块当公共 API 调用；自己的模块写少量资源查询，复用上述成员能力。

## 验证和后续接入

在仓库根目录运行：

```bash
node scripts/test-backend.mjs --test knowledge
```

[真实 HTTP 检查](../../apps/api/tests/knowledge.rs)验证角色/Grant 矩阵、隐私搜索、撤权后分页/重放、Audit 回滚和撤权与保存的锁顺序。自己的资源应覆盖读/写/列表及撤权后拒绝，避免只检查隐藏按钮。

撤权不能抹去已下载或已显示内容，也不是实时推送。短期下载能力另有[TTL 边界](09-attachments.md)。继续[成员生命周期](08-members.md)，再将同一授权策略接入 Files 和 Jobs。
