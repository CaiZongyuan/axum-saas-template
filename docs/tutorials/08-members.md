# 当前成员锁与角色生命周期

目标：让自己的业务写入与成员降级、停用有明确提交顺序，并复用现有成员管理。前提是已有 [Session](03-sessions.md)，理解资源授权；一次部署对应一个 Organization。

<!-- example:knowledge:reference-01:start -->

完整参考：[资源授权](07-library-grants.md)。

<!-- example:knowledge:reference-01:end -->

## 公共接口与用法

[Organization](../../crates/app/src/modules/organization/mod.rs)提供 `MemberRole::{Owner, Admin, Member}`、`active_role_in` 和 `lock_memberships`。在业务事务中调用，锁持续到自己 commit/rollback；SQL 摘录：

```sql
SELECT role FROM saas_core.memberships
WHERE user_id = $1::uuid AND active
FOR SHARE
```

`None` 表示没有有效成员身份。多个受影响成员通过 `lock_memberships(&mut tx, &ids)` 按 ID 顺序取共享锁，再锁资源；不在已锁资源后补取无序成员锁。详细签名见授权指南。

<!-- example:knowledge:reference-02:start -->

完整参考：[授权指南](07-library-grants.md)。

<!-- example:knowledge:reference-02:end -->

[Identity](../../crates/app/src/modules/identity/mod.rs)公开 `profiles(connection, ids)` 批量读成员资料，以及 `revoke_user_sessions(connection, user_id)` 同事务撤销会话。自己的模块通过这些能力协作，不跨模块 JOIN 私有凭据表，也不每人一次查资料。

## 使用已有管理 API

[管理 Handler/用例](../../crates/app/src/modules/organization/management.rs)提供分页成员列表和 `PUT /api/v1/organization/members/{user_id}`，输入 `role / active / version`。列表默认 50、最多 100，游标绑定管理员；旧 version 返回 409。Owner 可管理 Owner，Admin 只管理非 Owner，Member 拒绝。

[纯规则](../../crates/app/src/modules/organization/domain.rs)与事务共同保护最后 Owner：先锁 Organization 唯一行，再按 ID 顺序锁操作者/目标，在事务内检查有效 Owner 集合、角色、版本，更新成员、撤销必要 Session、写 Audit 并提交。不能在事务外 count 后独立 update。

降级或停用最后有效 Owner 返回 `422 organization.last_owner`。两个 Owner 同时退出只能一个成功；首次注册也使用同一协调行。

## 停用不能被重新启用复活

停用成员与撤销全部旧 Session、密码重置材料、Audit 同事务提交；重新启用后旧 Cookie 仍无效，用户需重新登录。Session 签发也持有成员锁，因此与停用形成一致提交顺序。Audit 失败全部回滚。

业务写入持有 Membership 共享锁，管理变更取排他锁。鉴权时返回的角色、客户端下拉框或之前缓存的资格不能替代当前事务检查。已有独立 API Keys 由每次认证的 active 检查约束，密码重置不自动撤销它们。

## 验证自己的接入

在仓库根目录运行：

```bash
node scripts/test-backend.mjs --test members --test membership_policy
```

[真实 HTTP 检查](../../apps/api/tests/members.rs)覆盖角色矩阵、版本冲突、最后 Owner 并发、Audit 回滚、停用/重启用和登录竞态；[纯规则检查](../../crates/app/tests/membership_policy.rs)覆盖规则集合。自己的业务增加停用与写入受控竞态，证明写入只有合法的提交顺序。之后将锁纪律用于[文件完成](09-attachments.md)和[后台发布](10-document-exports.md)。
