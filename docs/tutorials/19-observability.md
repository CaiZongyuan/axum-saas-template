# 给自己的业务接入可观测性

目标：从自己的 HTTP 请求定位到 Job、存储操作与审计，排查故障而不让观测影响业务提交。前提是已有[公开 API](01-full-stack-request.md)，后台业务沿用[Jobs](10-document-exports.md)，成功事实写入[Audit](14-audit-history.md)。

## 启动可选观测组合

仓库根目录运行：

```bash
just dev-observability
```

它启动正常开发服务与 Collector、Tempo、Loki、Prometheus、Grafana。以 Owner 或 Admin 登录应用，进入「设置 → 监控与诊断」（`/settings?section=monitoring`）；详细查询可打开 [Grafana](http://127.0.0.1:13300) 的 SaaS operations 看板。链接使用 `.env.example` 的默认端口；自定义端口以启动输出为准。本地 Grafana 匿名只读、查询端口仅 loopback，不是生产登录方案。普通 `just dev` 不启动这些服务。

[Compose overlay](../../compose.observability.yaml)、[Collector 配置](../../deploy/observability/collector.yaml)固定实际服务与数据源；端口通过 TELEMETRY_HTTP_PORT/TEMPO_PORT/LOKI_PORT/PROMETHEUS_PORT/GRAFANA_PORT 配置。独立操作可用 `just observability-up / observability-validate / observability-down`；单独启动 Collector 不让已运行进程自动开启导出，应用须重启或明确配置 TELEMETRY_ENDPOINT/TELEMETRY_LOG_DIRECTORY。

## 在设置里检查运行情况

监控页包含「运行概况」「请求与性能」「后台任务」「采集与告警」四个标签，可切换最近 15 分钟或 1 小时。指标旁的小问号支持鼠标悬浮、键盘聚焦和点击，解释单位与含义；页面只保留必要提示。P95 表示 95% 的请求在该耗时以内完成，服务端错误率只计算 5xx。后台任务同时区分当前排队情况、执行尝试和最终失败，重试次数不能直接当作失败任务数。

应用通过管理员接口 `GET /api/v1/system/monitoring?window_minutes=15` 读取摘要，窗口参数也支持 `60`，浏览器无需连接 Prometheus。请求统计排除健康检查和监控接口，避免自动刷新掩盖业务流量；当前任务队列独立于指标采集，可以在没有 Prometheus 时查看。

未启用、等待数据、正常采集、数据过期和查询失败有各自状态；没有样本不显示为零错误或正常。刚启动时至少等待两次抓取，切换到业务页面产生请求，再回来查看趋势。采集器缓存旧指标也可能仍能被抓取，因此 API 与 Worker 每次导出都会更新 `saas_telemetry_heartbeat_seconds{service=~"saas-api|saas-worker"}` 的时间戳；它不依赖用户请求，超过 180 秒未更新的数据视为过期。

这三个部署设置分别连接不同的入口：

| 设置                        | 用途与本地启动行为                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MONITORING_PROMETHEUS_URL` | API 与 Worker 查询指标的基础地址；`just dev-observability` 根据 `PROMETHEUS_PORT` 填入本机地址。                              |
| `MONITORING_WORKER_URL`     | API 检查 Worker 就绪状态的基础地址；开发脚本根据 `WORKER_PORT` 推导本机地址。生产 Compose 使用内部地址 `http://worker:3001`。 |
| `MONITORING_GRAFANA_URL`    | 浏览器打开详细看板的地址；`just dev-observability` 根据 `GRAFANA_PORT` 填入本机地址。                                         |

明确配置的地址优先于脚本推导值。Prometheus 与 Worker 使用 HTTP(S) 基础地址，不带路径、账号密码、查询参数或片段；Grafana 可以包含路径，非本机地址必须使用 HTTPS，同样不携带凭据或查询参数。环境变量由 API 与 Worker 启动时读取，修改后重启两者；页面保存的是告警规则，不会安装或启动监控服务。生产中为运营方的采集与查询服务配置内部连接，并为浏览器访问的 Grafana 配置登录；无需把 Prometheus 或 Worker 端口发布到公网。

## 配置站内告警

「采集与告警」支持保存错误率阈值与持续时间，默认关闭；默认阈值为 1%，持续 5 分钟。Worker 每 30 秒独立评估，使用最近 5 分钟的请求计算规则；该周期不受 `JOB_MAINTENANCE_SECS` 影响。至少 100 次请求才参与判断，避免一次偶发错误在低流量下引起误报。满足持续条件后向当前有效 Owner/Admin 的站内收件箱发送告警，数据确认恢复后发送恢复通知；规则持久化，关闭浏览器仍会检查。

「发送测试通知」仅向当前操作管理员的收件箱发送一条测试消息，可点击「查看结果」回到监控页。它验证站内通知链路，不代表阈值已触发，也不会给所有成员发送通知。规则接口是 `GET/PUT /api/v1/system/monitoring/alerts`，测试入口是 `POST /api/v1/system/monitoring/alerts/test`；修改和测试需要 Session、管理员权限与 CSRF 校验。邮件、短信和外部通知渠道未接入这条规则。

故障检查可在本地开发的另一个终端运行 `just observability-down`：监控应显示采集或查询异常，而不是零错误；已有告警不能把缺失或过期样本当作恢复依据。运行 `just observability-up` 恢复服务，等到新样本再判断。站内告警依赖 Worker、数据库和通知读取链路；整台服务器或 Worker 停止时，应由部署环境之外的可用性检查通知维护者。

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
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test monitoring --test monitoring_alerts --test jobs
```

[公开测试](../../crates/app/tests/telemetry.rs)捕获真实 OTLP protobuf 并驱动 HTTP/Worker/存储，检查 parent、actor、审计和有限标签；[故障](../../crates/app/tests/telemetry_outage.rs)与[关停](../../crates/app/tests/telemetry_shutdown.rs)检查阻塞出口仍完成业务、有限积压和退出。

[监控接口测试](../../crates/app/tests/monitoring.rs)检查管理员权限、采集状态与查询摘要；[告警测试](../../crates/app/tests/monitoring_alerts.rs)检查规则保存、站内测试通知与持续异常/恢复。

自己的业务应提供对应的 HTTP/任务结果与观测查询场景。部署自己的 SaaS 继续[生产指南](21-single-machine-production.md)。

<!-- example:knowledge:reference-01:start -->

观测接线变更时可运行 `node scripts/knowledge-observability-smoke.mjs`，在独立环境查询真实 Tempo/Loki/Prometheus/Grafana 与 Audit，保存安全关联 ID。它是知识库参考业务 smoke；容量验证见[性能预算](24-perf-gates.md)。

<!-- example:knowledge:reference-01:end -->
