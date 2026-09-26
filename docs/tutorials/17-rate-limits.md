# 跟做：请求限流、等待提示与 Redis 故障回退

运行 `just dev`，API 默认启用三类固定窗口策略，窗口为 60 秒。同一直接 TCP 对端地址在同一类策略中共享预算：

| 策略           | 当前请求                                   | Redis 可用 | 本地回退 |
| -------------- | ------------------------------------------ | ---------: | -------: |
| registration   | POST 注册                                  |         20 |        5 |
| authentication | 认证类 POST：登录与密码重置；不含注册/退出 |         60 |       20 |
| resource       | 其他请求，包括读取、资源写入、退出         |        600 |      120 |

`/health/live` 与 `/health/ready` 不消耗预算，避免限流让进程健康探针误报。其他请求放行后仍执行正常 Session、API Key、CSRF 和资源权限检查。

## 1. 在页面观察一次限制和恢复

为了快速学习，可在自己的本地 `.env` 临时设置下面三项，重启 `just dev`：

```dotenv
RATE_LIMIT_AUTHENTICATION=2
RATE_LIMIT_AUTHENTICATION_FALLBACK=1
RATE_LIMIT_WINDOW_SECS=3
```

打开登录页，在一个窗口内重复提交错误凭据。达到上限后，响应是统一 429，包含整数秒 `Retry-After`，正文为 `rate_limit.exceeded`，`error.details.retry_after_seconds` 给出同样的等待时长，仍保留 request_id。

注册/登录页面保留输入并显示倒计时，等待期间不能再次提交；时间到后按钮恢复，但不会自动发出请求。普通资源页面也会展示等待提示，API/Query 层不进行自动乘法重试。体验后恢复默认配置，避免学习时的小预算影响日常开发。

固定窗口可能在相邻窗口边界允许两批请求，不宣称滑动窗口或均匀速率。生产数值应结合部署规模与实测调整。

## 2. Redis 计数与本地计数各做什么

[Core 限流模块](../../crates/app/src/modules/rate_limit/mod.rs)在路由处理器前，根据真实匹配路由与 HTTP 方法选择策略，再对直接对端地址做 hash，生成内部桶标识。地址端口不参与标识，IPv4-mapped IPv6 归一为 IPv4；不信任请求自行声明的 `X-Forwarded-For`。

当前代理后的多个用户共享代理地址的预算。可信代理转发需要部署时明确建立边界，不能把任意客户端可伪造的 header 当作身份。缺少 TCP 上下文的自定义组装使用共享 unknown 桶，不因此跳过保护；实际 API 可执行文件已经传入 `ConnectInfo<SocketAddr>`。

[Redis WindowCounter](../../crates/platform/src/rate_limit.rs)使用一个 Lua 操作完成“读取当前计数 → 判断上限 → 带 TTL 更新”。同一 Redis namespace、策略和窗口的 API 实例共享预算；达到上限后不再增加远端计数。每个操作只尝试一次，有独立的并发和总时限。

本地也记录每次请求，包括 Redis 正常工作或拒绝时的消耗。Redis 失败时使用这个已消耗的窗口，并按更低的本地上限判断，不能因为切换存储而恢复全额。一次超时的远端命令可能已经执行，本地判断因此可以更保守，不重发它来试图获得“确定结果”。

本地 map 默认最多 4096 个对端/策略条目，每个新窗口清理过期项。容量满时，新来源共享各策略的保守溢出窗口，不通过淘汰旧条目恢复额度。进程重启会清除本地计数；这种回退面向单机运行，不假装是跨机器的持久配额。

## 3. Redis 不可用时仍有限制

停止自己的开发 Redis：

```bash
docker compose stop redis
```

已有消耗保留在本地窗口；如果已经超过较低的回退上限，会继续得到 429。下个窗口只恢复本地策略允许的数量。Redis 不可用不会把身份校验改成允许，也不会让 API 无法启动。

恢复 Redis：

```bash
docker compose up -d --wait redis
```

之后的独立请求会重新建立连接并尝试远端计数。缓存和限流复用 [私有 Redis transport](../../crates/platform/src/redis_transport.rs) 的连接/超时实现，但各有并发容量，限流不会进入缓存的无限重试或排队。

默认限流 Redis 操作总预算为 50 ms，包含创建连接、发送和等待回应，满并发容量立即转本地。时间由进程启动时的系统时间与单调经过时间组成；测试注入可控时钟，系统时钟回拨不会让本地窗口倒退。

## 4. 配置与观察

[生成配置参考](site:reference/config.md)列出 `RATE_LIMIT_*` 的默认值和范围：窗口、三个正常上限、三个回退上限、本地条目容量、Redis namespace 与操作时限。回退上限必须大于零且不超过对应正常上限。格式或范围错误在监听前失败，只报告字段名。

使用 Owner/Admin 在浏览器控制台读取：

```js
await fetch('/api/v1/system/rate-limits').then((response) => response.json());
```

结果只包含固定三类策略的允许、拒绝、回退累计计数和本地条目总量，不返回原始地址、桶 hash、邮箱、secret 或每用户标签。请求日志继续使用 route、status、request_id。计量入口本身也受普通资源预算保护。

运行配置入口默认启用限流。用于聚焦 HTTP 测试的基础 Router 组装默认不启用；自行组装应用时，通过 `CoreOptions.limiter` 提供明确的实例。标准 API 可执行文件已经使用 `RateLimiter::from_env`，不是只在测试里演示。

## 5. 前端与公开合同

[统一错误工厂](../../crates/app/src/http.rs)构造同一 429 envelope 与 `Retry-After`。最终组合的 OpenAPI 为受保护的全部操作声明这一响应，生成 SDK 不需要为每个业务重复定义另一种错误。

[通用等待提示](../../packages/views/src/system/rate-limit.tsx)只识别公开错误码和 1–3600 秒范围；不会把任意错误文本当作可执行提示。认证表单的计时器从实际请求失败启动，离开页面清理；倒计时结束仅恢复按钮，没有后台自动重发。业务错误 View 组合相同提示，保持原有的输入和错误处理。内嵌图片与附件链接也保留限流错误，并在等待期间禁用重试；提示使用合法的行内标记。

登录/注册的成功导航使用随页面观察者存活的回调，避免用户离开后迟到的认证响应把页面拉回。

## 6. 验证

```bash
node scripts/test-backend.mjs --test rate_limits --test cached_documents --test config
pnpm exec vitest run apps/web/src/rate-limits.test.tsx apps/web/src/registration.test.tsx apps/web/src/sessions.test.tsx
just check
```

真实 Redis/PostgreSQL 的 HTTP 测试使用可控时钟验证阈值、共享窗口和恢复；通过[共享 TCP 转发夹具](../../tests/support/redis_gate.rs)断开 Redis，证明旧消耗仍有效且本地额度有限。还验证本地容量溢出、三类策略独立、伪造转发地址无效、放行仍需认证、公开计量与生成合同。

View 测试使用受控计时器推进等待时间，验证没有自动 POST、表单输入仍在、等待后可明确重试。完成整条旅程后运行一次隔离浏览器配置：

```bash
RATE_LIMIT_AUTHENTICATION=2 RATE_LIMIT_AUTHENTICATION_FALLBACK=1 RATE_LIMIT_WINDOW_SECS=3 node scripts/e2e.mjs tests/e2e/rate-limits.spec.ts
```

真实 HTTP 请求消耗认证窗口，浏览器看到 429 和等待按钮，窗口恢复后以真实账号登录。常规开发仍使用较快的 HTTP/View 检查。

## 7. 扩展自己的业务

新增普通业务路由自动沿用 resource 策略和统一错误合同，处理器仍负责权限。需要不同策略时，在 Core 的明确分类与配置中增加有限类别，使用稳定标签计量；不要为每个文档、用户或 URL 建立指标标签。

限流、配置、通用 UI 提示、Redis transport、认证教程和对应 Core 测试在移除知识库后保留。自己的业务无需复制另一个限流器或让 Redis 成为身份与业务事实的唯一来源。
