# 跟做：从真实邮件重置密码

本章在已有注册、登录和 PostgreSQL Jobs 上增加找回密码。用户不必等待邮件才能注册或写作；只有找回密码需要邮件投递。这是 Core 功能，移除知识库示例后仍保留页面、任务、测试和本章。

## 1. 完成一次真实重置

运行 `just dev`，打开注册页创建自己的测试账号。在另一个浏览器窗口打开登录页，点击“忘记密码？”，填写邮箱并提交。页面统一提示“如果该账号可用，你会收到重置邮件”，不确认该邮箱是否已注册。

打开 [Mailpit 本地收件箱](http://127.0.0.1:8025)，找到这封重置邮件，打开其中链接。邮件由真实 Worker 经 SMTP 投递；Mailpit 只捕获邮件，不向外转发。设置 12–128 字符的新密码并确认，成功后返回登录页使用新密码登录。

原来窗口的登录会话此时已经失效，刷新或调用 `/api/v1/auth/session` 会得到未登录结果。再次打开同一链接并提交会失败；密码重置不会自动登录，也不会撤销独立管理的 API Keys。

开发入口自动启动 Mailpit，并首次生成随机的 `.secrets/development-mail-key`，权限为 `0600`。API 与 Worker 使用同一个持久 key，重启不会让未发送邮件无法解密。该目录已忽略，不要提交或复制到公开文档。已有但格式或权限不正确的 key 文件会明确报错，不会偷偷覆盖。

## 2. 一次请求如何变成可靠邮件

`POST /api/v1/auth/password-reset` 接受 `{email}`，校验受信 Origin。有效格式的存在、不存在、停用账号和冷却期内重复申请都得到相同的 202 与响应体。未配置邮件时所有邮箱得到相同的 503；普通注册和登录仍可用。请求沿用[认证限流](17-rate-limits.md)，同一可用账号默认 60 秒内的重复申请合并，不再创建新 Job。

[Identity 请求用例](../../crates/app/src/modules/identity/password_reset/requests.rs)在同一事务中保存重置 hash、短期加密材料并登记 `identity.password_reset` Job。Job payload 只有 `reset_id`；明文 token、邮箱和完整链接不会进入任务状态、Audit 或日志。新申请不会使此前有效的链接立即作废，避免别人反复请求导致用户手头链接失效。

链接只由受信 `APP_ORIGIN` 构造，形如 `https://your-app.example/reset-password#token=…`，不采用请求 Host。fragment 不随 HTTP 请求路径或 Referer 发送；Web 页面读取并立即替换 URL，token 只用于本次提交，不写入浏览器存储或 Query/Mutation 缓存。刷新已清理 URL 的重置页需要重新打开邮件链接。

[重置邮件 Handler](../../crates/app/src/modules/identity/password_reset/worker.rs)领取持久任务后，验证当前成员有效、凭据存在、重置未过期/使用/撤销、Job 绑定和租约有效，再解密并发送。数据库事务在网络发送前结束；发送期间 Worker 继续续租，失去租约会取消正在等待的发送。到期时间也限制发送预算。已经发出的邮件无法撤回，消费时仍要再次验证链接。

## 3. Hash 与密文分别解决什么

[Identity 迁移](../../migrations/0016_password_reset.sql)有两张表：`password_resets` 存 256-bit 随机 token 的 SHA-256 hash 和有效性；`password_reset_mail` 暂存收件地址及链接的密文。验证 token 不需要解密，但 Worker 重启后必须能恢复邮件内容，因此短期密文不能被 hash 替代。

[Mail 能力](../../crates/app/src/modules/mail/mod.rs)使用 XChaCha20Poly1305，每份材料独立生成 24-byte 随机 nonce。认证附加数据绑定用途、schema、重置 ID、Job ID、User ID、key version 和准确到期时间；交换记录或篡改内容会使解密失败。key 是独立的 32-byte 随机值，不复用数据库密码或 API Key。

成功投递在 Job 成功事务中删除密文；成功重置或停用成员也原子撤销其他链接并删除该用户材料。维护入口每轮最多清理 100 份过期/已使用/撤销材料，即使 SMTP 当前未配置也继续清理。Worker 或数据库停机期间物理清理会延迟，但过期材料不能用于重置，恢复后继续清理。有效期默认 30 分钟，范围 1–60 分钟。

密文保护数据库中的待发送内容；运行时为组装与发送必然会有短期明文。不要把密文保护解释为所有内存 buffer 都已安全擦除。

## 4. 成功消费、并发与撤销

`POST /api/v1/auth/password-reset/complete` 接受 `{token,password}`。在计算 Argon2 前先检查链接有效性，复用有界的密码计算容量。提交时按成员 → 凭据 → 重置记录顺序锁定，重新判断有效性，在一个事务内更新密码、消费 token、撤销全部旧 Session、撤销其他有效链接、清除材料并追加 `identity.password.reset` 审计。

任何一步失败都会回滚；两个请求同时消费只有一个成功。登录发放 Session 时还会在事务内比较刚验证的密码 hash 与当前凭据，避免旧密码验证与重置交错后发出新会话。返回成功时清除当前 Cookie，前端清理原会话查询数据并要求重新登录。

过期、已使用或撤销 token 统一返回 `auth.reset_invalid`，不暴露账户信息。UI 提供重新申请入口；网络结果不明时可以先尝试新密码登录，避免盲目重发。

## 5. SMTP 故障、重试与密钥恢复

[SMTP adapter](../../crates/platform/src/mail.rs)一次 attempt 只发送一次，最多四个并发发送。整体超时覆盖 DNS、TLS、DATA 和 QUIT；不启用额外连接池自动重试。4xx、已识别的临时网络错误和超时交给 Jobs 有界退避，最多五次尝试；5xx、无效配置、密文篡改或未知 key version 直接失败。Owner/Admin 可在后台任务页查看静态错误码，修复后明确重试。

SMTP 接受邮件只表示服务器接下投递责任，不代表收件人已收到。接受后进程崩溃、应答丢失或数据库提交失败，可能重发同一链接；固定 Message-ID 也不保证去重。单次消费由数据库事务保证。过期或被消费的任务即使再次执行也不会启动新投递。

生产通过 `MAIL_SMTP_TLS=wrapper` 或 `starttls` 使用证书校验，配置正确端口、发件邮箱和成对 SMTP 凭据。`local` 明文模式只接受 loopback、localhost 或开发服务名 mailpit。不要把本地收件箱开放到公共网络。详细变量由[配置参考](site:reference/config.md)生成。

API 与 Worker 必须使用相同的 `MAIL_ENCRYPTION_KEY` 和正整数 `MAIL_ENCRYPTION_KEY_VERSION`。v1 只支持一个当前版本：轮换前先停止新申请，等待旧材料投递完成或过期清理，再一起更换两端 key/version。不要用新 key 冒充旧版本。误换版本会让任务以 `mail.key_unavailable` 失败；在 TTL 内恢复原 key/version 后可从任务页重试。已过期链接应重新申请。恢复备份时也要恢复匹配的受保护 key，不能只恢复数据库。

## 6. 验证与复用

```bash
node scripts/test-backend.mjs --test password_reset --test mail_materials
pnpm exec vitest run apps/web/src/password-reset.test.tsx
node --test tests/tooling/development-mail-key.test.mjs
just check
```

真实 HTTP/PostgreSQL/Job/Mailpit 测试覆盖投递、重启后重新领取、旧租约拒绝、重复消费、并发、过期、停用后重新启用、审计失败回滚以及 SMTP 451/550。密码重置与登录的竞态用真实数据库行锁组织，不靠任意等待猜测顺序。View 测试覆盖中性提示、手动重试、确认密码、成功、无效链接与 URL fragment 清除。

新关键旅程完成时运行一次：

```bash
node scripts/e2e.mjs tests/e2e/password-reset.spec.ts
```

浏览器从真实捕获邮件取得链接，重置后验证另一个浏览器的 Session 失效并使用新密码登录。认证旅程关闭 trace/截图，报告不保存邮件、token、密码或原始异常。

扩展其他事务邮件时，业务模块拥有自己的有效性与短期材料表，通过公开 Mail 加密/发送能力和 Jobs 事务接口接入。让自己的 Handler 重新验证当前业务状态，失败使用静态码；不要把明文秘密直接放进普通 Job payload。
