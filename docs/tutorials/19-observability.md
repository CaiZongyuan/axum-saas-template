# 给自己的业务接入可观测性

目标：从自己的 HTTP 请求定位到 Job、存储操作与审计，排查故障而不让观测影响业务提交。前提是已有[公开 API](01-full-stack-request.md)，后台业务沿用[Jobs](10-document-exports.md)，成功事实写入[Audit](14-audit-history.md)。

## 启动可选观测组合

仓库根目录运行：

```bash
just dev-observability
```

它启动正常开发服务与 Collector、Tempo、Loki、Prometheus、Grafana。打开 [Grafana](http://127.0.0.1:3300) 的 SaaS operations 看板；本地匿名只读、查询端口仅 loopback，不是生产登录方案。普通 `just dev` 不启动这些服务。

[Compose overlay](../../compose.observability.yaml)、[Collector 配置](../../deploy/observability/collector.yaml)固定实际服务与数据源；端口通过 TELEMETRY_HTTP_PORT/TEMPO_PORT/LOKI_PORT/PROMETHEUS_PORT/GRAFANA_PORT 配置。独立操作可用 `just observability-up / observability-validate / observability-down`；单独启动 Collector 不让已运行进程自动开启导出，应用须重启或明确配置 TELEMETRY_ENDPOINT/TELEMETRY_LOG_DIRECTORY。

## 沿用公共接线

[HTTP 上下文](../../crates/app/src/http.rs)生成真实 request_id/trace span，[Jobs 入队](../../crates/app/src/modules/jobs/mod.rs)持久化安全 parent/correlation/actor，[Worker](../../crates/app/src/modules/jobs/worker.rs)为每次 attempt 建独立 span，[存储适配器](../../crates/platform/src/object_storage.rs)记录有限操作/结果。自己的模块无需让 Domain 依赖 OTel。

请求返回 `x-request-id / x-trace-id`，可在 Tempo 查询后关联 Loki。HTTP span 可在排队前结束，Worker 从数据库恢复 W3C parent；重启/重试创建新 span，不复用 span ID。traceparent 只作观测，不作授权，不持久化 baggage/tracestate/raw URI/完整 headers。

自己的 use case 只追加必要静态事件；方法与字段摘录：

```rust
tracing::info!(action = "tickets.export.requested", "business request accepted");
```

在真实成功位置记录事件，授权成功后才记录 actor；不记录正文、token、密码、signed URL、原始 AWS/Redis 错误。沿用有限 route/kind/operation/outcome 标签，用户/Job/资源/trace ID 只作关联字段，不作 metric label。

## 从关联查到持久结果

Loki 查询使用完整 trace ID 字符串替换示例值：

```text
{service_name=~"saas-api|saas-worker"} |= "YOUR_TRACE_ID"
sum by (route, status) (rate(saas_http_requests_total[5m]))
sum by (kind, outcome) (rate(saas_jobs_attempts_total[5m]))
```

第一行是 LogQL，后两行是 PromQL。JSON 日志把上下文保存在 span/spans、事件放 fields，不假设全部顶层。rate 至少等待两次抓取；Histogram P95 为桶内近似值。attempt 的 transient 不等于整个 Job 最终失败，必须对照任务 batch/history、业务结果和 Audit；看到 span 不证明事务提交。

## 故障不能反压业务

[Platform telemetry](../../crates/platform/src/telemetry/mod.rs)默认 span 队列 512、batch 64、日志有损队列 1024，满时丢观测；OTLP 总预算 1 秒，不自动重试。Collector 有 memory limiter、有限队列和最多 10 秒重试。Collector 不可用不使数据库 ready 失败、不触发重新执行业务。

TELEMETRY_ENDPOINT 为空禁用 exporter，当前只支持本地 HTTP loopback/collector 服务名。无效 parent 创建新 trace；上游不采样时即使响应有 ID，后端可能没有导出 trace。输出只接本项目受控 saas_* target，TRACE 级也不开放第三方 secret 输出。

关停先 drain 业务，再有界关闭 provider；Trace 最多 2 秒，当前 metrics reader 最多 5 秒，日志也有限等待，允许丢数据。应用文件按小时轮转最多 24 个，不是精确磁盘配额；Prometheus/Loki retention 异步，开发卷需检查容量。生产自行定义日志预算/留存，不把开发 profile 当无限保存。

## 验证接入

```bash
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test jobs
```

[公开测试](../../crates/app/tests/telemetry.rs)捕获真实 OTLP protobuf 并驱动 HTTP/Worker/存储，检查 parent、actor、审计和有限标签；[故障](../../crates/app/tests/telemetry_outage.rs)与[关停](../../crates/app/tests/telemetry_shutdown.rs)检查阻塞出口仍完成业务、有限积压和退出。

自己的业务应提供对应的 HTTP/任务结果与观测查询场景。部署自己的 SaaS 继续[生产指南](21-single-machine-production.md)。

<!-- example:knowledge:reference-01:start -->

观测接线变更时可运行 `node scripts/knowledge-observability-smoke.mjs`，在独立环境查询真实 Tempo/Loki/Prometheus/Grafana 与 Audit，保存安全关联 ID。它是知识库参考业务 smoke；容量验证见[性能预算](24-perf-gates.md)。

<!-- example:knowledge:reference-01:end -->
