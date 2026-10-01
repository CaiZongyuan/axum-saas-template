# 复用密码恢复与事务邮件

目标：为自己的 SaaS 启用 Core 密码恢复，并理解怎样复用 Mail/Jobs 实现其他事务邮件。前提是已有 [Identity](02-registration.md) 和 [Worker](10-document-exports.md)；普通注册和业务使用不依赖邮件成功投递。

## 配置并取得一次结果

`just dev` 启动本地 Mailpit；[收件箱](http://127.0.0.1:8025)只捕获开发邮件。开发入口生成权限 0600 的 `.secrets/development-mail-key`，API/Worker 共用且重启保留；不要提交或公开复制，格式/权限错误不会自动覆盖。

Core 已组装两个 API，输入/响应以[合同](site:reference/api.md)为准：

| 入口                                        | 输入                         | 结果                               |
| ------------------------------------------- | ---------------------------- | ---------------------------------- |
| `POST /api/v1/auth/password-reset`          | email，可选 locale `zh / en` | 格式有效统一 202，不暴露账号存在性 |
| `POST /api/v1/auth/password-reset/complete` | token，12–128 字符 password  | 消费成功后要求重新登录             |

申请检查受信 Origin 和认证类限流。存在、不存在、停用、冷却合并都使用同一 202；未配置邮件统一 503。默认冷却 60 秒、token 30 分钟；跨语言重复保留第一次邮件语言。Locale 缺省中文，非法值拒绝。

在仓库根目录执行完整的公开请求/真实投递检查：

```bash
node scripts/test-backend.mjs --test password_reset --test mail_materials
node --test tests/tooling/development-mail-key.test.mjs
```

[HTTP/Job/Mailpit 测试](../../crates/app/tests/password_reset.rs)取得真实邮件链接、重置，再验证旧密码/全部旧 Session 拒绝和新密码登录。API Keys 独立管理，密码重置不自动撤销它们。

## 请求保存 hash 与短期密文

[请求用例](../../crates/app/src/modules/identity/password_reset/requests.rs)在同一事务保存 token hash、短期邮件材料并 enqueue `identity.password_reset`。payload 只有 reset_id；明文邮箱/token/完整链接不进入 Job、Audit 或日志。新申请不立即作废之前的有效链接。

[迁移](../../migrations/0016_password_reset.sql)将验证用 SHA-256 hash 与待发送密文分开：hash 用于一次消费，密文供 Worker 重启后恢复发送，不能相互替代。[MailService](../../crates/app/src/modules/mail/mod.rs)公开接口包括：

```rust
pub fn seal(&self, binding: &Binding<'_>, plaintext: &[u8]) -> Result<Sealed, MaterialError>;
pub fn open(&self, binding: &Binding<'_>, sealed: &Sealed) -> Result<Vec<u8>, MaterialError>;
pub async fn send_plain_text(&self, to: &str, subject: &str, body: String,
    message_id: &str, expires: tokio::time::Instant)
    -> Result<(), saas_platform::mail::DeliveryFailure>;
```

这是方法签名摘录。XChaCha20Poly1305 使用每份材料独立 nonce；Binding 把用途、schema、业务/Job/User ID、key version 和准确到期时间绑定到认证附加数据。自己的业务定义有效性/材料表，用独立 32-byte key，不复用数据库密码；运行时仍有短暂明文，不保证所有 buffer 安全擦除。

## Worker 和一次性消费

[重置 Handler](../../crates/app/src/modules/identity/password_reset/worker.rs)执行前检查当前成员、凭据、期限、消费/撤销、Job 绑定和租约，再解密，结束数据库事务后发送；重试保留密封的邮件语言。失租约取消等待发送，但已发送无法撤回，消费时仍检查。

[消费事务](../../crates/app/src/modules/identity/password_reset/consume.rs)按成员 → 凭据 → 重置记录取锁，再次验证，在一个事务更新密码、消费 token、撤销全部旧 Session/其他链接、清材料、Audit。并发消费只有一个成功，审计失败全回滚。Session 签发对比当前密码 hash，避免旧密码核验与重置交错产生新会话。

无效/过期/已用/撤销统一 `auth.reset_invalid`；未知网络结果先尝试新密码登录，不盲重发。链接由受信 APP_ORIGIN 构造，token 在 fragment，页面读后立即清 URL，不放存储/缓存；`lang` 提示只作用当前流程。

## SMTP 故障与密钥恢复

[SMTP](../../crates/platform/src/mail.rs)每次尝试只发送一次，最多 4 并发，deadline 覆盖 DNS/TLS/DATA/QUIT。4xx/识别的临时网络/超时由 Jobs 有界重试最多五次；5xx/篡改/未知 key version 永久失败。SMTP 接受不等于用户收到，丢应答或提交失败可能重发；固定 Message-ID 不保证去重，一次消费由数据库保证。

成功发送在 fenced 成功事务清密文，消费/停用原子清用户材料，维护每轮最多 100 份；物理清理延迟不使过期链接有效。生产用 starttls/wrapper 与证书校验，local 明文仅限开发 loopback/服务名，配置见[参考](site:reference/config.md)。

API/Worker 共用 `MAIL_ENCRYPTION_KEY / MAIL_ENCRYPTION_KEY_VERSION`，只支持一个当前版本。轮换先停新申请、排空或等旧材料过期，再同时更换；误换可在 TTL 内恢复原 key/version 后明确重试。恢复数据库也需要受保护的匹配 key。其他事务邮件照此定义自己的有效性、材料生命周期和 Handler，不将秘密塞入普通 payload。接着添加[观测](19-observability.md)。
