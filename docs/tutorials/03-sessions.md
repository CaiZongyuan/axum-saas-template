# 跟做：登录、退出与会话失效

本章复用[注册章节](02-registration.md)的账号、密码散列和 Session 存储。运行 `just dev`，先注册账号，再从首页退出，打开 `/login` 用同一邮箱和密码重新登录。刷新首页仍显示当前身份。

## 1. 登录只是核验已有身份

`POST /api/v1/auth/login` 使用与注册相同的邮箱规范化规则。服务端查到 Credential 后，在线程池验证 Argon2id；邮箱不存在也执行同等级的密码计算，避免走一个明显更快的路径。

不存在的邮箱、错误密码和停用成员返回相同的 401 提示。错误响应与日志不包含密码或散列。数据库不可用等服务故障返回 503，客户端不会自动重复提交登录请求。

验证成功后创建新的高熵 Session，返回当前身份与 CSRF token，通过 HttpOnly Cookie 交付 session secret。一个账号可以有多个独立浏览器会话；登录不会把所有设备同时踢下线。

前一章中“账号已提交但会话签发失败”的用户走同一个登录流程即可恢复，不需要重新注册或覆盖凭据。[公开 HTTP 测试](../../crates/app/tests/sessions.rs)用真实数据库锁触发该故障并验证恢复。

## 2. 为什么 Cookie 还需要 CSRF token

浏览器会自动携带 Cookie，因此服务端不能只凭“请求带 Cookie”就接受修改。注册与登录首先要求匹配 `APP_ORIGIN`；退出既检查 Origin，又检查 `x-csrf-token` 是否属于当前 Cookie 会话。

CSRF token 从当前会话通过 HMAC-SHA256 派生，用成熟库的恒定时间校验接口比较。另一会话的 token、缺失 token、无效 Origin 都不能撤销当前会话。API 默认同源，不给外部 Origin 开启携带凭据的 CORS。

`POST /api/v1/auth/logout` 撤销数据库中的当前会话，再返回清除 Cookie 的响应。旧 Cookie 再调用 `/api/v1/auth/session` 得到 401。重复提交同一个有效的退出证明保持幂等，不撤销其他浏览器的 Session。

## 3. 绝对期限与空闲期限各管什么

- 绝对期限从签发时计算，默认 7 天；持续使用也不会无限延长。
- 空闲期限从上次有效读取计算，默认 24 小时；有效会话查询会更新该时间。

两者均使用数据库时间。当前成员已停用或 Session 已撤销时立即拒绝，不依赖客户端时钟、Redis 或长寿命 JWT。

测试通过设置过期/空闲时间戳构造边界条件，随后从真实 HTTP 接口检查结果，不等待真实的 24 小时。配置来源见[生成配置参考](site:reference/config.md)。

## 4. 让页面跟随身份变化

[登录 View](../../packages/views/src/identity/login-view.tsx)展示提交、受控失败和重试；[首页](../../packages/views/src/identity/home-view.tsx)通过 SDK 查询当前会话并执行退出。

成功登录或退出时，取消旧的查询并清理 Query 缓存，再写入新的当前会话状态。会话刷新发现身份/角色变化或失效时，同样先清理其他查询；这覆盖另一个标签页切换账号后当前页重新获得焦点的情况。测试特意保存上一身份的查询缓存，验证切换后被移除。密码表单使用短暂的组件/请求内存，mutation 离开后不保留缓存；密码和 session secret 不进入 localStorage 或业务持久状态。

会话查询返回 401 时，首页移除已登录身份并提供登录入口；503 等服务故障保留为可重试错误，不伪装成成功退出。

## 5. 运行本章检查

```bash
node scripts/test-backend.mjs --test sessions
pnpm exec vitest run apps/web/src/sessions.test.tsx
just check
```

重点是无效凭据的一致响应、来源/CSRF 校验、退出后旧 Cookie 拒绝、绝对/空闲过期、停用成员以及会话签发失败后的恢复登录。

浏览器旅程在本章完成时集中运行 `node scripts/e2e.mjs tests/e2e/registration.spec.ts`：两个独立浏览器注册、刷新、退出、检查旧 Cookie 失效，再重新登录。日常修改使用上面的定向反馈循环。

认证测试默认不录制 trace/截图，也不保留带动作参数的 HTML 报告。`test-results/summary.json` 仅记录测试名称、结果、耗时和源码位置，原始异常与页面快照不保留；结合服务的 request_id 日志定位问题。无凭据的公共状态场景可保留 trace 和截图。
