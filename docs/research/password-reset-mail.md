# 密码重置邮件：SMTP、短期密文与真实捕获测试

查证日期：2026-09-26。范围为 SaaS Core 的 Identity、Mail 与 PostgreSQL Jobs，依据规范 §6.3 / §11。下文的版本、API 和协议语义来自官方源码、registry 与 RFC；配置、接口和流程标为实施建议。本次未修改依赖、编译片段、拉取镜像或运行 SMTP 测试，MSRV 满足要求不等于完成项目兼容性验证。

## 1. 固定版本与现有依赖

仓库使用 Rust 1.96、Tokio 1.x、Argon2 0.5.3；现有 secret 生成通过 `argon2::password_hash::rand_core::{OsRng, RngCore}`，对应 lock 中的 `rand_core 0.6.4`。现有 Worker 在续租失败时丢弃 handler future，Job 错误已使用静态字符串。平台层可承载 SMTP adapter，Identity 承载重置有效性与事务；均不需要参考业务依赖。[workspace](../../Cargo.toml)、[lock](../../Cargo.lock)、[secret](../../crates/app/src/secrets.rs)、[Worker](../../crates/app/src/modules/jobs/worker.rs)

**建议采用：**

```toml
lettre = { version = "=0.11.23", default-features = false, features = ["builder", "smtp-transport", "tokio1-rustls", "ring", "webpki-roots"] }
chacha20poly1305 = { version = "=0.11.0", default-features = false, features = ["alloc", "zeroize"] }
```

| 选择 | 已核实的事实与选择理由 |
| --- | --- |
| Lettre 0.11.23 | 2026-08-03 发布，未撤回，MSRV 1.85；官方 manifest 标记 actively-developed。上述功能启用 Tokio SMTP、消息构建、Rustls/ring 与公开 CA 根。关闭默认功能可避免 native-tls、连接池与 hostname；`tokio1-rustls-tls` 已是 deprecated 别名。[registry][lettre-index] [manifest][lettre-cargo] |
| RustCrypto `chacha20poly1305` 0.11.0 | 2026-06-28 发布的稳定版，未撤回，MSRV 1.85。选择其 `XChaCha20Poly1305`：32 字节 key、24 字节 nonce、16 字节 tag；扩展 nonce 适合使用独立随机 nonce。0.11 使用 `aead 0.6`，不要照搬 0.10 的 `generate_nonce(&mut OsRng)` 示例。[registry][chacha-index] [manifest][chacha-cargo] [类型/API][chacha-source] [nonce 要求][aead-source] |

随机数保持现有 `rand_core 0.6` 入口：对 `[u8; 24]` 调用 `OsRng.try_fill_bytes`，再转换为 `XNonce`；对外只传字节，不把旧 RNG 传给新版 AEAD 的 RNG trait。关闭 AEAD 的 `getrandom` / `rand_core` 功能即可不依赖这种 trait 互操作。RNG 失败应返回静态错误，不用会 panic 的 `fill_bytes`。[OsRng 源码][osrng] [AEAD manifest][chacha-cargo]

## 2. SMTP 的真实完成、超时与错误边界

**固定版本事实：**

- `AsyncSmtpTransport::<Tokio1Executor>::relay(host)` 使用 TLS 包装和默认 465；`starttls_relay(host)` 使用必须成功的 STARTTLS 和默认 587。STARTTLS 失败时不会发送凭据和邮件。`builder_dangerous(host).port(1025)` 可用于明确的本地捕获服务；它默认无 TLS、无认证。[transport][smtp-transport]
- Tokio 路径的 `.timeout(Some(duration))` 只在 `async_net.rs` 中包住**每个地址的 TCP connect**。DNS lookup 在外，TLS 握手、SMTP greeting、认证及 DATA 读写也没有这个 timeout 包装。不能据 builder 的“SMTP commands timeout”注释认定整次异步 send 已有截止时间。[network 源码][smtp-net] [connection 源码][smtp-connection]
- 非 pool 的 `send_raw` 在 DATA 成功后仍会等待 `conn.abort().await`，后者尝试 QUIT 再关闭连接。应用超时可能发生于 SMTP 已接受邮件之后。Tokio timeout 通过取消 future 停止本地等待，不撤销远端效果。[transport][smtp-transport] [connection][smtp-connection] [Tokio][tokio-timeout]
- SMTP 在 DATA 末尾的成功应答表示服务器接下投递责任，不表示收件人已收到。DATA 已接受但应答丢失时，重试可能产生重复邮件。RFC 还建议很长的逐命令超时，尤其 DATA 结束为 10 分钟，以减少这种重复风险；一个短的应用总预算不是完整 RFC 逐命令超时策略。[RFC §4.2.5、§4.5.3.2][smtp-rfc]
- `Error::is_transient()` 对应 4xx，`is_permanent()` 对应 5xx；还有 `is_timeout/is_client/is_response/is_tls/is_transport_shutdown/status`。没有公开 `is_network` / `is_connection`。TLS 握手错误可能包装为 connection，不能仅用 `is_tls()` 排除全部 TLS 失败。[错误类型][smtp-error] [network 源码][smtp-net]
- `Error` 的 Display/Debug 会包含 source，负响应会保存服务器整段文字。可选 **`tracing` 功能会输出原始 SMTP 写入内容，包括邮件正文**。因此不启用此功能，也不格式化原始 error、Response、Message 或解密材料进入日志/Audit/Job history。[错误源码][smtp-error] [write/read 源码][smtp-connection]

**实施建议：**使用不带 pool 的 `AsyncSmtpTransport`，直接 await send，不 spawn 脱离 Worker 的发送任务；用外层 `tokio::time::timeout_at` 覆盖连接、握手、投递与关闭。一个 Job attempt 只调用一次 send，退避由 Jobs 负责。起步可设连接预算 5 秒、整体预算 30 秒；这是需按实际 relay 调整的应用策略，接受短预算增加结果不明与重复投递的可能。续租继续运行，租约丢失后丢弃 send future；网络发送期间不持有 PostgreSQL 领取行锁。

| adapter 判定 | 建议持久化的静态码 / Job 类型 |
| --- | --- |
| `is_transient()` | `mail.smtp_transient` / Transient |
| 外层 deadline 或 `is_timeout()` | `mail.smtp_timeout` / Transient；投递结果可能不明 |
| error source chain 中确认的临时 I/O，例如 ConnectionRefused、ConnectionReset、ConnectionAborted、BrokenPipe、NotConnected、UnexpectedEof | `mail.smtp_unavailable` / Transient；不保留 source 文本 |
| `is_permanent()` | `mail.smtp_rejected` / Permanent，包括 535 等凭据拒绝 |
| 消息构建失败、无效地址、协议/客户端/TLS 配置错误，以及无法可靠分类的错误 | `mail.smtp_invalid` / Permanent；修复后由显式运维重试 |

该表是保守应用策略，不是 Lettre 内建重试。先判明确 4xx/5xx，再识别超时与有限 I/O 类别，不以“不是 permanent”一概视为 transient。库无 SMTP 幂等键合同；固定 `Message-ID` 便于关联，也不能证明服务器去重。密码重置的可重复安全边界应是同一条链接只有一次成功使用。[错误 API][smtp-error] [规范 §11](../saas-template-architecture-spec.md#11-postgresql-jobs-与失败恢复)

## 3. 短期密文与 key version

**官方 API 事实：**`XChaCha20Poly1305::new_from_slice(key)` 验证 key 长度；`Aead::encrypt/decrypt(&nonce, Payload { msg, aad })` 同时认证正文与 AAD，AAD 不加密，解密时必须完全相同。任何 key/nonce/AAD/ciphertext 不匹配都可能导致认证失败。nonce 对同一个 key 的每次加密必须唯一；24 字节随机 nonce 提供很大的碰撞空间，不能改用重置 ID、时间戳或全零 nonce。`zeroize` 功能清理 cipher 持有的 key，不等于自动擦除调用者的所有字符串和明文 buffer。[KeyInit][key-init] [Payload/nonce][aead-source] [cipher/zeroize][chacha-source]

**建议的数据与事务合同：**

1. 重置记录仅持有 `token_hash`、User、到期时间和使用/撤销状态。独立短期邮件材料表保存 `reset_id/job_id/key_version/nonce/ciphertext/expires_at`；普通 Job payload 只放版本化 `reset_id`。生成 token、重置 hash、加密材料、Job 与必要 Audit 在同一 PostgreSQL 事务提交。
2. 加密小型的收件地址和原始 token。用已有受信 `APP_ORIGIN` 构造外部重置 URL，不采用请求 Host 或用户提供的 URL。绑定 AAD 为固定 purpose/schema、reset ID、Job ID、User ID、key version 与精确到期值，采用无歧义固定编码；例如版本化 JSON tuple，时间统一整数秒。Worker 从当前关联记录重建相同 AAD，拒绝跨记录调换的密文。
3. 每次 attempt 在解密/发送前验证 reset 仍未使用、未撤销、未过期，User 可用，材料和当前 Job 匹配，并确认有效租约。先失效的记录不得再启动一次发送；并发中已发出的邮件无法撤回，消费端始终再次验证有效性。到期预算也应限制发送 deadline，防止到期之后继续等待 SMTP。
4. SMTP 返回成功后，在同一短事务里校验当前 lease、清除材料并提交 Job 成功。接受邮件后进程崩溃或数据库提交失败仍可能重发同一链接。不能宣称 exactly-once。
5. 重置成功时原子地消费 token、更新密码、撤销旧 Session，并使该用户其他未完成重置失效、清除对应材料。过期/取消也清除材料。维护任务应有界清理到期材料，包括已耗尽重试预算的 Job；最终失败但尚有效的材料最多保留到到期，才可能支持管理员在有效期内重试。普通 Job 历史永久保留也不应延长秘密的生存期。

以上是对既定要求的实现建议；AEAD 本身不实现 TTL、一次使用、租约或 Session 撤销。[规范 §6.3](../saas-template-architecture-spec.md#63-密码与找回)、[规范 §11](../saas-template-architecture-spec.md#11-postgresql-jobs-与失败恢复)

最小配置建议：`MAIL_SMTP_HOST/PORT`、`MAIL_SMTP_TLS=wrapper|starttls|local`、`MAIL_FROM`、可选成对 `MAIL_SMTP_USERNAME/PASSWORD`、`MAIL_TIMEOUT_SECS`、`MAIL_ENCRYPTION_KEY`（独立随机 32 字节，编码后配置）、`MAIL_ENCRYPTION_KEY_VERSION`、`PASSWORD_RESET_TTL_SECS=1800`。本地明文模式只用于显式的开发捕获地址；生产使用认证 TLS。API 和 Worker 必须共享当前邮件加密配置；key 与 SMTP 凭据标记 secret，配置错误只报字段名。轮换时不把旧版本自动解释成新 key：首版可先等待旧材料到期/排空再替换；需要不中断轮换时才增加按版本选择的受保护 keyring，并保留旧 key 至对应材料清理完毕。备份恢复要恢复匹配版本的 key。[规范 §6.3 / §13](../saas-template-architecture-spec.md)

建议的公开 seam 保持很小：Platform 提供 `send_plain_text(to, subject, body, message_id, deadline) -> Result<(), DeliveryFailure>`，失败只暴露上述静态类别；密文能力提供 `seal/open`，只接收 bytes 与 binding、返回 key version/nonce/ciphertext。Identity 决定链接内容、有效性和事务；Jobs 决定 attempt/lease/retry。秘密类型不 derive Debug，明文仅在构造与发送期间持有；日志/Audit/错误中不包含 token、链接、邮件正文或原始 provider 响应。

## 4. Mailpit 固定镜像与捕获 API

官方 Mailpit **v1.31.2** 发布于 2026-09-19。官方发布 workflow 同时发布 `axllent/mailpit` 和 GHCR 镜像；Docker Hub registry 在查证日返回如下多架构 OCI index digest（包含 linux/386、amd64、arm64）：[release][mailpit-release] [workflow][mailpit-workflow] [manifest][mailpit-manifest]

```yaml
mailpit:
  image: axllent/mailpit:v1.31.2@sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d
  ports:
    - '127.0.0.1:${MAILPIT_SMTP_PORT:-1025}:1025'
    - '127.0.0.1:${MAILPIT_HTTP_PORT:-8025}:8025'
```

这是开发配置建议。官方默认 SMTP 为 1025、HTTP/UI 为 8025，镜像入口为 `/mailpit`，内置 healthcheck 为 `/mailpit readyz`。测试使用独立实例或唯一收件人；不挂载共享持久卷、不配置 relay/forward。[README][mailpit-readme] [Dockerfile][mailpit-docker]

以下路径和字段已按 **v1.31.2 内置 Swagger** 核实，HTTP 端口调用：[API schema][mailpit-api]

| 请求 | 返回或副作用 |
| --- | --- |
| `GET /api/v1/messages?start=0&limit=50` | 新到旧；`messages[]` 包含 `ID`、`To[].Address`、`Subject`、`Snippet`，正文可能出现在 Snippet，不应打印响应 |
| `GET /api/v1/search?query=<URL-encoded search>` | 使用 Mailpit 搜索语法，例如 `to:unique-test@example.test`；响应同样有 `messages[]` |
| `GET /api/v1/message/{ID}` | `Text` / `HTML` / `To` / `MessageID`；会标为已读。支持 `latest`，并发测试应使用已匹配的 ID |
| `DELETE /api/v1/messages`，body `{"IDs":["owned-message-id"]}` | 删除指定测试邮件；省略 IDs 会删除全部，不用于共享实例 |

**测试建议：**真实 HTTP 请求登记重置，真实 Worker 从 PostgreSQL 领取并经 SMTP 发给 Mailpit；用唯一收件人查找，再从 `Text` 提取链接，在 HTTP 或浏览器消费。断言旧 Session 无效、再次使用失败、过期/已使用/撤销记录不再发信、材料在成功/到期/取消后被清理、Job payload/Audit/错误无秘密；普通注册在邮件不可用时仍可成功。捕获 API 只读取邮件，不用它的 `/send` 替代 Worker 发信。测试失败报告也不打印邮件 JSON、链接或浏览器秘密快照。[测试策略](../testing/strategy.md)

可在专属故障实例设置 `MP_ENABLE_CHAOS=true`：`PUT /api/v1/chaos` 的 `{"Recipient":{"ErrorCode":451,"Probability":100}}` 确定性拒绝收件人；改为 550 验证永久失败，发 `{}` 清空 triggers 后验证恢复。Chaos 只提供 Sender/Recipient/Authentication 触发，不能代替“连接已建立但不响应”或 DATA 后应答丢失的测试；这类使用测试拥有的受控 TCP 代理。不要在共享 Mailpit 上变更 Chaos。[CLI 环境变量][mailpit-cli] [Chaos API][mailpit-api] [Chaos 源码][mailpit-chaos]

[lettre-index]: https://index.crates.io/le/tt/lettre
[lettre-cargo]: https://github.com/lettre/lettre/blob/v0.11.23/Cargo.toml
[smtp-transport]: https://github.com/lettre/lettre/blob/v0.11.23/src/transport/smtp/async_transport.rs
[smtp-net]: https://github.com/lettre/lettre/blob/v0.11.23/src/transport/smtp/client/async_net.rs
[smtp-connection]: https://github.com/lettre/lettre/blob/v0.11.23/src/transport/smtp/client/async_connection.rs
[smtp-error]: https://github.com/lettre/lettre/blob/v0.11.23/src/transport/smtp/error.rs
[smtp-rfc]: https://www.rfc-editor.org/rfc/rfc5321.html#section-4.5.3.2
[tokio-timeout]: https://github.com/tokio-rs/tokio/blob/tokio-1.53.1/tokio/src/time/timeout.rs
[chacha-index]: https://index.crates.io/ch/ac/chacha20poly1305
[chacha-cargo]: https://github.com/RustCrypto/AEADs/blob/chacha20poly1305-v0.11.0/chacha20poly1305/Cargo.toml
[chacha-source]: https://github.com/RustCrypto/AEADs/blob/chacha20poly1305-v0.11.0/chacha20poly1305/src/lib.rs
[aead-source]: https://github.com/RustCrypto/traits/blob/aead-v0.6.1/aead/src/lib.rs
[key-init]: https://github.com/RustCrypto/traits/blob/crypto-common-v0.2.0/crypto-common/src/lib.rs
[osrng]: https://github.com/rust-random/rand/blob/rand_core-0.6.4/rand_core/src/os.rs
[mailpit-release]: https://github.com/axllent/mailpit/releases/tag/v1.31.2
[mailpit-workflow]: https://github.com/axllent/mailpit/blob/v1.31.2/.github/workflows/build-docker.yml
[mailpit-manifest]: https://registry-1.docker.io/v2/axllent/mailpit/manifests/sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d
[mailpit-docker]: https://github.com/axllent/mailpit/blob/v1.31.2/Dockerfile
[mailpit-readme]: https://github.com/axllent/mailpit/blob/v1.31.2/README.md
[mailpit-api]: https://github.com/axllent/mailpit/blob/v1.31.2/server/ui/api/v1/swagger.json
[mailpit-cli]: https://github.com/axllent/mailpit/blob/v1.31.2/cmd/root.go
[mailpit-chaos]: https://github.com/axllent/mailpit/blob/v1.31.2/internal/smtpd/chaos/chaos.go
