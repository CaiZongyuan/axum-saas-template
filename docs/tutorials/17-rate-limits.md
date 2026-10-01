# 分类限流与有限 Redis 回退

目标：让自己的 API 复用 Core 的请求预算、统一 429 和 Redis 故障回退。前提是通过 Core 组装业务 Router；限流放行后仍需认证、CSRF 与资源授权。

## 在实际组装点启用

[RateLimiter](../../crates/app/src/modules/rate_limit/mod.rs)公开 `from_env`、`local(limits, clock)` 和 `redis(limits, clock, settings)`。接入片段如下，完整应用见[configured_router](../../apps/api/src/lib.rs)：

```rust
let options = saas_app::CoreOptions {
    limiter: saas_app::modules::rate_limit::RateLimiter::from_env()?,
    ..Default::default()
};
```

将 options 传给 `compose_routes_with_options`，合同用 `rate_limit::describe` 补全 429。生产 API 入口已启用；默认 CoreOptions 的 limiter 为禁用，聚焦测试或自己的组装必须明确选择，不假设任意 Router 自动启用。

| 固定 60 秒窗口策略 | 当前分类                    | Redis 上限 | 本地回退 |
| ------------------ | --------------------------- | ---------: | -------: |
| registration       | POST 注册                   |         20 |        5 |
| authentication     | 认证类 POST，不含注册/退出  |         60 |       20 |
| resource           | 其他 API/业务请求，包括退出 |        600 |      120 |

`/health/live /health/ready` 不消耗预算。普通新业务路由归 resource；特殊类别需显式改 Core 分类/配置与合同，不在业务复制另一套无限标签限流器。

## 明确客户端标识与回退

桶按直接 TCP 对端 IP hash，忽略端口、规范化 IPv4-mapped IPv6，不信任 `X-Forwarded-For`。代理后用户会共享代理 IP 的预算；可信代理支持需另行定义。缺 ConnectInfo 使用 shared unknown 桶，API 可执行文件已经提供真实 ConnectInfo。

[Redis 计数器](../../crates/platform/src/rate_limit.rs)一次 Lua 原子判断/更新 TTL，同 namespace/策略/窗口可跨 API 实例共享。每次请求也消耗本地窗口，即使 Redis 正常或拒绝。故障时按已消耗本地值及更低上限判断，切换不会恢复全额；超时命令可能已经被 Redis 接受，不重发。

默认 Redis 总预算 50 ms、独立并发容量，一次尝试；本地最多 4096 条，容量满进入保守溢出窗口，不淘汰旧条恢复额度。进程重启清本地计数，它不是跨机器持久配额。固定窗口边界可能允许相邻两批，不是均匀滑动速率。

## 从 HTTP 观察限制

在自己的 `.env` 临时设置并重启开发 API，体验后恢复默认：

```dotenv
RATE_LIMIT_RESOURCE=2
RATE_LIMIT_RESOURCE_FALLBACK=1
RATE_LIMIT_WINDOW_SECS=3
```

```bash
curl -i http://127.0.0.1:18000/api/v1/system/status
curl -i http://127.0.0.1:18000/api/v1/system/status
curl -i http://127.0.0.1:18000/api/v1/system/status
```

同窗口第三次得到 `429 rate_limit.exceeded`、整数秒 Retry-After、`error.details.retry_after_seconds` 与 request_id；其他并发请求也会消耗预算。等待窗口后用户明确重试，不自动重复 POST。配置/范围由[参考](site:reference/config.md)生成，fallback 必须大于零且不超过正常上限。

Owner/Admin 可查询 `/api/v1/system/rate-limits` 固定类累计计数和本地条数，不含原 IP/桶/凭据。该入口也消耗 resource 预算。Redis 不可用不绕过身份校验，也不影响数据库 ready。

## 验证

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test rate_limits --test config
```

[公开 HTTP 检查](../../crates/app/tests/rate_limits.rs)用真实 Redis 与可控时钟验证窗口、共享、旧消耗回退、溢出、伪造转发无效和仍需认证。自己的业务增加 429 合同与手动恢复断言；继续[密码恢复与邮件](18-password-reset.md)或[可观测性](19-observability.md)。
