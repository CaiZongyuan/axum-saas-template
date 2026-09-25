# 跟做：管理成员与保护最后 Owner

运行 `just dev`，用首个注册账号登录，打开首页“企业成员”。另开一个隐私窗口注册同事账号，再由 Owner 重新读取成员列表，即可修改对方角色或停用对方。所有操作显式点击“保存成员”。

Owner 可以任命另一位 Owner；Admin 可以管理非 Owner 成员，但不能任命、降级或停用 Owner。页面的可编辑标记与可选角色由服务端返回，后端在每次保存时重新判断。普通 Member 访问管理入口会看到无权限提示。

## 1. 修改是一个有版本的请求

[Organization 管理接口](../../crates/app/src/modules/organization/management.rs)提供分页成员列表和 `PUT /api/v1/organization/members/{user_id}`。请求包含 `role / active / version`；版本过期返回 409，点击“重新读取列表”后再操作。

修改失败会保留选择并显示错误与请求编号。列表刷新是显式恢复操作；后台重新查询不会悄悄提高本地表单使用的版本。后端分页默认 50、最多 100 条，游标绑定当前管理员，按成员 ID 稳定排序。

## 2. 为什么不能先 count 再 update

两位 Owner 都可能在事务外看到“还有两位 Owner”，然后同时把自己降为 Member，企业就没有 Owner 了。

[纯规则](../../crates/app/src/modules/organization/domain.rs)只负责判断某次变化是否允许；[事务用例](../../crates/app/src/modules/organization/management.rs)保证它读取的事实不会被另一次管理操作抢先改变：

1. 先锁定唯一的 Organization 协调行。
2. 按成员 ID 的固定顺序锁定操作者和目标 Membership，再检查操作者当前角色。
3. 在事务内读取启用的 Owner 数量，验证角色边界、版本和最后 Owner 约束。
4. 更新成员、撤销必要会话、追加 Audit，然后共同提交。

首次注册也通过同一 Organization 行协调 Owner 初始化。之后不允许降级或停用最后一位有效 Owner，返回 `422 organization.last_owner`。并发退出时只有一个操作能成功，另一个会看到最新集合并被拒绝。

知识库写入已有 Membership 共享锁，角色修改和停用使用排他锁，因此与业务写入形成提交顺序。未来触及多个成员的操作也必须按 ID 固定排序取锁。

## 3. 停用与会话撤销必须一起提交

只让鉴权检查 `active = false` 还不够：重新启用后，以前的 Cookie 可能重新有效。因此停用通过 Identity 的[公开会话撤销接口](../../crates/app/src/modules/identity/mod.rs)撤销该用户全部 Session，与成员变更、Audit 同事务提交。

登录签发会话时也持有 Membership 共享锁。停用会等待已开始的会话签发完成，再撤销它；停用先提交时，签发会重新看到非启用状态并拒绝。重新启用后用户必须用密码重新登录，旧 Cookie 持续无效。

重复注册相同邮箱仍返回冲突，不能恢复成员、修改角色或覆盖原密码。审计失败时，角色、启用状态、版本和会话撤销一起回滚。

## 4. Core 与参考业务保持独立

Organization 只操作自己的企业与成员表。成员姓名和邮箱通过 Identity 的批量 profile 接口读取，避免跨模块直接 JOIN 私有表，也避免每名成员一次 SQL。Session 的撤销同样通过 Identity 公开接口完成。

[共享成员页面](../../packages/views/src/organization/members-view.tsx)复用生成 SDK、Query、通用 Field / Select / Switch。已保存成员资源只存在 Query 中；行表单的角色、启用状态和版本是待提交草稿。修改后重新查询列表与当前会话，自身降级或停用时清理已失去资格的界面缓存。

这章属于 SaaS Core，移除知识库示例后仍保留成员管理 API、页面、迁移、测试和教程。它没有读取 Document 或 Grant 表。知识库示例可以使用同一成员目录来选择授权对象。

## 5. 验证并发与用户体验

```bash
node scripts/test-backend.mjs --test members --test membership_policy
pnpm exec vitest run apps/web/src/members.test.tsx
just check
```

Domain 测试覆盖 Owner 集合与 Admin 边界；HTTP 使用真实多连接 PostgreSQL，验证两位 Owner 同时退出、角色矩阵、版本冲突、审计失败回滚，以及登录签发与停用的受控竞态。View 从公开页面验证保存、拒绝、冲突恢复和服务端返回的操作资格。

关键流程完成时运行一次：

```bash
node scripts/e2e.mjs tests/e2e/members.spec.ts
```

测试用普通注册页面建立同事账号，Owner 修改角色并停用；同事浏览器刷新后失去会话，重新启用也不会恢复旧 Cookie。测试入口会预先准备专用 Owner，不依赖测试文件执行顺序。
