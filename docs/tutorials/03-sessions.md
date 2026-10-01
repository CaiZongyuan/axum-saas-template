# 在业务 Handler 验证 Session

目标：让自己的读写 API 使用当前登录身份，并处理 Origin、CSRF 与失效。前提是复用[Identity](02-registration.md)，业务 Router 已通过 Core 组装；认证成功仍须资源授权。

## 调用公共接口

[Identity](../../crates/app/src/modules/identity/mod.rs)的接口摘录如下，类型来自 Identity、Axum、SQLx 与 Platform 配置：

```rust
pub async fn require_session(
    pool: &PgPool,
    settings: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
    mutation: bool,
) -> Result<CurrentSession, Response>;
```

在已有 `pool / auth / headers / id` 的 Handler 中：

```rust
let session = identity::require_session(&pool, &auth, &headers, &id, true).await?;
```

读取传 `false`，修改传 `true`；返回当前 `user.id` 等身份和 `csrf_token`，失败是统一 Response。写用例进入事务后仍须[锁定当前成员](08-members.md)并授权资源，不能只看 Cookie 是否存在。

<!-- example:knowledge:reference-01:start -->

完整参考：[知识库 HTTP 层](../../crates/app/src/modules/knowledge/mod.rs)；[授权资源](07-library-grants.md)。

<!-- example:knowledge:reference-01:end -->

## 修改请求的证明

注册/登录检查受信 Origin；Cookie mutation 同时要求匹配 `APP_ORIGIN` 的 Origin 和当前 Session 的 `x-csrf-token`。token 由 secret 的 HMAC 派生，通过响应正文交给客户端；另一会话的 token 无效。Session 专用入口拒绝显式 Authorization，Bearer 失败不回退 Cookie。

`POST /api/v1/auth/logout` 撤销当前会话并清除 Cookie。旧 Cookie 查询 Session 返回 401；重复有效退出证明保持幂等，不撤销其他设备。机器只读凭据另走[API Key](15-api-keys.md)。

默认绝对期限 7 天、空闲期限 24 小时，按数据库时间判断。有效读取刷新 idle 时间，不能延长绝对期限；撤销和成员停用立即生效。配置见[生成参考](site:reference/config.md)。

## 故障与恢复

错误邮箱、密码和停用成员统一返回 401；不存在邮箱也执行同等级有界密码计算。数据库故障为 503，应保留为可重试故障，不显示成功退出。登录签发新独立 Session，不撤销全部设备。

退出、换账号或会话失效时，客户端取消旧请求并清理身份相关查询；迟到响应不能进入新身份缓存。密码和 Cookie secret 不进入持久状态，后台刷新不替用户提交密码。

## 验证自己的 Handler

在仓库根目录执行：

```bash
node scripts/test-backend.mjs --test sessions
```

[HTTP 测试](../../crates/app/tests/sessions.rs)检查登录/退出、Origin/CSRF、过期、停用及注册后 Session 故障的恢复。自己的 Handler 至少检查匿名 401、有效 Cookie 读成功、缺 CSRF 写拒绝、有效证明写成功和退出后拒绝；驱动真实 Router/数据库，不替换私有认证函数。

后台任务捕获凭据引用而非 secret，并在执行/发布时重新验证，继续[后台执行](10-document-exports.md)。
