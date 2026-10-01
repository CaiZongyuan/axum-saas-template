# 复用 Identity 与账号事务

目标：让自己的 SaaS 使用 Core 注册和凭据，不在业务模块重写密码、User 或 Membership。前提是[快速开始](../getting-started/quickstart.md)的 API 和 PostgreSQL 已运行；命令在仓库根目录执行。

## 接入身份入口

[Core Router](../../crates/app/src/lib.rs)已装配 [Identity](../../crates/app/src/modules/identity/mod.rs)入口：`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`GET /api/v1/auth/session`。注册输入为 `email`、`password`、可选 `display_name`，角色由服务端决定。

```bash
curl -i http://127.0.0.1:3000/api/v1/auth/session
node scripts/test-backend.mjs --test registration
```

匿名请求得到 401 和 request_id。公开注册检查通过真实 Router 创建账号、取得 Cookie、查询身份，验证首位 Owner 和后续 Member。完整请求见[注册 HTTP 测试](../../crates/app/tests/registration.rs)，DTO 见[API 参考](site:reference/api.md)。业务 Handler 的接入在[下一页](03-sessions.md)。

## 事务与提交边界

[Identity 迁移](../../migrations/0002_identity.sql)包含账号、凭据、成员身份、会话和审计。注册在同一个事务创建 User、Credential、Membership 和 Audit，失败全部回滚。成员准入使用 [Organization](../../crates/app/src/modules/organization/mod.rs)的公共接口：

```rust
pub async fn enroll(
    connection: &mut PgConnection,
    user_id: &str,
) -> Result<MemberRole, sqlx::Error>;
```

这是接口摘录。唯一 Organization 行串行化首次 Owner 初始化；请求不能指定 Owner。一次部署服务一个 Organization，自己的业务不会创建另一层租户，见[ADR](../adr/0001-single-organization-deployment.md)。

账号事务提交后才签发 Session。失败返回 `auth.session_unavailable`，账号已存在，应通过登录恢复；重复注册不会覆盖密码、角色或停用状态。

## 密码与秘密边界

[密码实现](../../crates/app/src/modules/identity/crypto.rs)使用 Argon2id 和随机 salt，阻塞计算最多并发 4 个，满容量返回可重试 503。密码为 12–128 字符。邮箱去除两端空白、按小写唯一，不折叠 `+tag` 或点号；并发同邮箱只能一个成功。

Session 是 256-bit 随机 secret，数据库只存 SHA-256。HTTPS Cookie 为 `__Host-saas_session`，带 Secure、HttpOnly、SameSite=Lax、Path=/，不设 Domain；loopback HTTP 仅用于开发。secret 不进入业务 JSON、日志或浏览器存储。

注册要求匹配受信 `APP_ORIGIN`，不从请求 Host 推导。JSON 最大 16 KiB、读取最多 3 秒；账号事务预算 3 秒，Session 签发另有 2 秒。响应为 no-store；成功响应丢失不代表账号未创建，不自动重发注册 POST。

## 验证并适配

注册检查覆盖邮箱冲突、首次 Owner 并发、Audit 回滚、Cookie、凭据存储和来源拒绝。Audit 失败时不应留下账号；账号已提交而 Session 失败时应能随后登录。

自己的业务表引用 User ID，并检查当前成员资格。需要客户资料初始化时先定义哪些事实必须同事务提交，再使用公共能力；业务资料规则留在自己的模块。继续[Session、Origin 与 CSRF](03-sessions.md)，再接入业务事务与幂等。

<!-- example:knowledge:reference-01:start -->

完整参考：[业务事务与幂等](04-personal-documents.md)。

<!-- example:knowledge:reference-01:end -->
