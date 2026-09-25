# 跟做：注册、事务与会话

先运行 `just dev`，打开 `/register`。输入邮箱、12–128 字符的密码和可选显示名；成功后进入首页，显示当前邮箱和企业角色。刷新仍保持登录。用另一个无痕窗口注册不同邮箱，可以看到第一个账号为 Owner，第二个为 Member。

注册是 SaaS Core 的能力，不依赖知识库、邀请、邮件或 Redis。当前章节交付注册和当前会话查询；普通登录/退出由下一章交付，个人文档从知识库章节开始。

## 1. 让四条事实同时成立

[Identity 迁移](../../migrations/0002_identity.sql)建立 User、Credential、Membership、Audit 和 Session 的存储。User、Credential、Membership、注册 Audit 属于同一事务：任一步失败，注册整体回滚。

邮箱先去掉首尾空白，保留显示值，并以小写值建立数据库唯一约束。不折叠 `+tag` 或点号；不会把不同邮箱提供商的约定写成通用规则。并发的同邮箱请求最终只能有一个成功。

[注册用例](../../crates/app/src/modules/identity/mod.rs)调用 [Organization 的成员准入](../../crates/app/src/modules/organization/mod.rs)和 [Audit 追加接口](../../crates/app/src/modules/audit/mod.rs)，传入同一个事务。Organization 的唯一协调行把首次初始化串行化：事务提交前领取 Owner，事务失败时领取也回滚。后续成员不能通过注册请求指定自己的角色。

这条事务边界可以仿照到自己的业务：把必须一起成功的数据写入和审计放在同一事务，通过模块公开接口协作。自己的业务规则留在自己的模块。

## 2. 密码与 Session 是两种不同的秘密

密码用 RustCrypto `argon2` 0.5.3 的 Argon2id 默认参数：内存 19,456 KiB、2 次迭代、1 条并行 lane、随机 salt。计算放在阻塞线程池，并以 4 个并发槽限制内存开销；槽满会返回可重试的 503。集成测试实际执行该参数，单次开发构建的完整注册约 0.5–0.7 秒；这不是生产性能承诺，部署时应以目标机器的 release 构建验证容量。

Session 使用操作系统随机数生成的 256 位 secret，Cookie 持有 secret，数据库仅保存 SHA-256。高熵随机 secret 不需要像人类密码那样使用昂贵散列。

<<< ../../crates/app/src/modules/identity/crypto.rs

会话默认绝对期限 7 天、空闲期限 24 小时，均由数据库时间判断；停用成员的会话查询立即失败。关联的 CSRF token 由 HMAC-SHA256 从当前 session secret 派生，刷新后稳定，并通过响应正文提供给后续 Cookie mutation；它不能代替 Cookie 登录。

## 3. 注册提交和会话签发分开

账号事务先提交，再签发 Session。假如后一步失败，接口返回 `auth.session_unavailable`，页面明确说明账号已经创建，无需重新注册。重复请求不会覆盖原密码或角色。下一张登录票会验证恢复登录的完整路径。

请求 JSON 上限为 16 KiB，超限返回 413；请求体最多等待 3 秒，未收完返回带 request_id 的 408。数据库事务最多等待 3 秒，会话签发另有 2 秒期限。分开计时，避免把“账号已创建但会话超时”误报成普通注册失败。浏览器网络中断也可能丢失成功响应；客户端不自动重试注册 POST。

## 4. 接到真实页面

运行 `just generate` 后，Rust OpenAPI 生成 `registerUser`、`getCurrentSession` 及相关 DTO。[注册 View](../../packages/views/src/identity/register-view.tsx)使用生成 SDK 和 shadcn 字段控件，展示提交状态、校验与带 request_id 的失败信息。成功时清理旧身份查询缓存，再进入已登录首页。

Session secret 不存入 localStorage，也不返回给 JavaScript。API 响应使用 `Cache-Control: no-store`。HTTPS 采用 `__Host-saas_session` Cookie，带 `Secure / HttpOnly / SameSite=Lax / Path=/`，不设置 Domain。开发环境仅允许 loopback HTTP。

`APP_ORIGIN` 是受信浏览器来源，例如本地 `http://127.0.0.1:5173`，生产为自己的 HTTPS Origin。API 不根据用户提交的 Host 推断它；注册请求必须携带匹配的 Origin。修改 Web 端口时同步修改这个配置，详见[配置参考](site:reference/config.md)。

## 5. 验证最容易出错的地方

```bash
node scripts/test-backend.mjs --test registration
pnpm exec vitest run apps/web/src/registration.test.tsx
just check
```

后端通过真实 Router/PostgreSQL 检查重复邮箱、首位 Owner 并发、审计回滚、停用保护、密码/token 存储、可信来源和安全 Cookie。并发测试先用数据库锁挡住两个请求，确认 PostgreSQL 中存在两个锁等待者再放行；会话测试用另一把锁模拟签发阻塞，不能用替换私有方法来假装发生故障。

View 测试操作输入和按钮，并使用真实内存 Router 验证成功导航；MSW 只替代 HTTP。浏览器在本旅程完成后集中运行一次：

```bash
just e2e
```

它使用两个独立浏览器上下文，注册两个账号、刷新确认身份、检查 HttpOnly Cookie 隔离。日常修改继续用定向测试，不在每次编辑和 push 后重复完整浏览器流程。

这些源码和教程均归 Core；[示例所有权清单](../../examples/knowledge-base/manifest.json)保持空的业务路径，后续删除知识库 example 时必须保留注册能力。
