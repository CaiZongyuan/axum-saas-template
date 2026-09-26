# 跟做：从导出请求追踪到 Worker 与 RustFS

本章回答“文档导出卡在哪里、失败原因是什么”。应用状态仍由 PostgreSQL 决定；trace、日志和指标帮助定位，不参与授权、任务领取或业务事务。

## 1. 启动可选观测组合

```bash
just dev-observability
```

它启动正常开发组合和五项观测服务：Collector 接收数据，Tempo 保存 trace，Loki 查询日志，Prometheus 抓取指标，Grafana 提供看板与 Explore。普通 `just dev` 保持原来的轻量组合。

打开 [Grafana](http://127.0.0.1:3300)，从 Dashboards 进入 **SaaS operations**。本地 profile 允许匿名只读查看；所有查询/管理端口只绑定 loopback，不是面向公网的生产登录方案。API 默认端口仍为 3000，Grafana 使用 3300。

[Compose overlay](../../compose.observability.yaml)固定五个镜像版本和 digest；[配置目录](../../deploy/observability/collector.yaml)包含真实接收器、数据源、看板和持久卷。端口冲突时在 `.env` 调整 `TELEMETRY_HTTP_PORT`、`TEMPO_PORT`、`LOKI_PORT`、`PROMETHEUS_PORT`、`GRAFANA_PORT`。开发入口据此构造本地 OTLP endpoint，并验证 Collector 实际接受 OTLP 请求以及四项后端已就绪。

`just dev-observability` 自动使用 `.runtime/telemetry` 存放私有 JSON 日志。Collector 将该目录只读挂载；为读取宿主机用户创建的私有目录，它在容器内以 root 运行，只保留 `DAC_READ_SEARCH` 能力，根文件系统只读。它不挂载 Docker socket。配置和日志卷均只读，读取进度另存于自己的 volume。

也可以分别启动/停止服务：

```bash
just observability-up
just observability-validate
just observability-down
```

单独启动观测服务不会让已经运行的 API 自动开始导出；需要重启为 `just dev-observability`，或明确设置 `TELEMETRY_ENDPOINT` 和 `TELEMETRY_LOG_DIRECTORY` 后启动应用。停止观测服务保留其数据卷；停止开发应用也保留观测服务，便于继续查询。

## 2. 找到一个真实导出

注册并登录，创建 Markdown 文档，上传一个附件，点击“导出当前文档”。在浏览器 Network 中找到 `POST /api/v1/knowledge/documents/{id}/exports`，记下响应中的 `x-request-id` 和 `x-trace-id`。前者标识这次 HTTP 请求，后者关联这次请求产生的完整执行链。

在 Grafana Explore 选择 Tempo，输入 trace ID。可看到：

1. `http.request`：导出申请的路由模板、方法、request_id、认证后的 actor_id。
2. `job.attempt`：Worker 的独立执行 span，包含 job_id、attempt、原 request_id/actor_id、correlation_id 和 causation_id。
3. `storage.operation`：`download_to`、`put_file_if_absent`、`head` 等真实 RustFS adapter 操作，包含安全的操作名与结果。

Job 排队期间 HTTP span 可以先结束；Worker 从数据库恢复 W3C parent，继续相同 trace。进程重启、租约恢复和自动重试各创建新的 attempt span，不重用 span ID。原始 Job payload 无需装入 OTel 对象或邮件秘密。

使用 Owner/Admin 在“后台任务”按 job_id 查看实际持久状态。在“审计记录”按 correlation_id 查询，可以把申请与 Worker 的完成记录对到同一 trace。观测显示发送过一个 span，不代表业务事务必然提交；真实结果以任务、导出与审计 API 为准。

## 3. 从 trace 切到日志和指标

Tempo 数据源提供到 Loki 的关联查询；Loki 日志中的 trace_id 也可点击打开 Tempo。直接查询：

```text
{service_name=~"saas-api|saas-worker"} |= "替换为你的trace_id"
```

默认 JSON 日志使用 `span` / `spans` 保存上下文，事件字段在 `fields`。例如 Worker 的 `job attempt finished` 带 outcome 和可选静态 error_code；并非所有字段都提升到了 JSON 顶层。用完整 trace ID 搜索可同时看到 API 与 Worker。

看板的主要 PromQL 是：

```text
sum by (route, status) (rate(saas_http_requests_total[5m]))
sum by (kind, outcome) (rate(saas_jobs_attempts_total[5m]))
histogram_quantile(0.95, sum by (le, operation) (rate(saas_storage_duration_seconds_bucket[5m])))
```

延迟以秒记录，显式 histogram 桶覆盖 1ms、5ms、10ms、25ms 等毫秒/亚秒刻度，直到 300 秒；P95 是桶内插值的近似值。刚启动时需要等待至少两次抓取才有 rate。指标只使用 method、route 模板、status 类别、注册的 kind、operation 和有限 outcome；不把 trace_id、用户、Job、文档或对象 key 放进 label。每个 metric stream 还限制为 128 个系列，超过限制会进入 SDK 的溢出聚合。

`saas.jobs.attempts` 计量观察到的 Handler 结果，`transient` 不等于整个 Job 最终失败；重试、管理员重开批次和强制取消需要结合持久任务历史判断。Histogram 记录 Handler/存储调用的耗时，业务错误仍保留已有错误语义。

## 4. 复现一个可解释的失败

在开发环境停止 Worker，然后申请导出、退出登录，再启动 Worker。请求时绑定的 Session 已被撤销，导出会失败，任务保留 `knowledge.export_credential_revoked`。重新登录后仍能查看自己导出的失败状态；重试旧任务不会绕过原凭据校验，需要重新发起导出。

在 Loki 用 trace ID 查到 Worker 的失败事件。错误码解释为什么被拒绝，不记录 Session secret、Markdown、附件正文或签名 URL。存储出错也只记录 `not_found`、`unavailable`、`too_large` 等有限结果，不格式化原始 AWS SDK 错误。

若只是想一次性验证全部接线，运行：

```bash
node scripts/knowledge-observability-smoke.mjs
```

这个里程碑脚本使用独立 PostgreSQL/RustFS、随机端口、专属 Compose project 和临时日志目录。它完成带附件的真实 ZIP 导出并比对正文，复现撤销会话后的导出失败，再查询实际 Tempo、Loki、Prometheus、Grafana 和审计 API。成功后只保存 `.scratch/t19-observability-evidence.json` 中的安全关联 ID 与检查名称，清理自己创建的环境，不操作开发数据。

## 5. Collector 故障为什么不会拖住业务

[Platform telemetry](../../crates/platform/src/telemetry/mod.rs)在专用线程批量发送 OTLP/HTTP protobuf。默认 span 队列最多 512 条、batch 64 条；满时丢弃新的观测数据。每个 span 的字段、事件和 links 数量也有限制，应用仅填受控且有界的字段。日志使用独立 1,024 行有损队列；出口慢时可以丢日志，不反压 HTTP/Worker。

每个 OTLP 请求默认总预算 1 秒，不启用 exporter 自动重试；Collector 自己也有 memory limiter、有限 batch/发送队列和最多 10 秒的重试期限。故障时可能缺少 trace/日志，这不影响数据库里的 Audit。正常请求不会为了补发 telemetry 重做业务。

`TELEMETRY_ENDPOINT` 为空时不创建 exporter；当前只支持 loopback 或 Compose 的 collector 服务名，使用本机 HTTP。传入的 `traceparent` 仅作为观测上下文，不用于授权；不转存 baggage、tracestate、请求头全集或 raw URI。无效 parent 会建立新 trace；上游明确不采样时，响应仍可能有有效 ID，但 Tempo 中没有导出数据。

配置错误在监听前只报告字段名；Collector 不可用不会成为 ready 失败原因。即使 `RUST_LOG=trace`，输出层也仅接收本项目受控的 `saas_*` target，避免第三方 HTTP/存储库的 debug 输出带入签名 URL 或连接参数。

关停先完成原有 HTTP/Worker drain，再在阻塞线程关闭观测 provider。Trace 关闭最多等 2 秒；固定的 SDK 0.33 metrics reader 最多等 5 秒，它不遵从自定义 shutdown timeout。日志 writer 还有有限退出等待，开发脚本为观测额外预留 10 秒。超时允许丢失 telemetry，不声称已取消远端接收。

## 6. 保存周期与资源边界

应用 JSON 文件按小时轮转，每服务最多保留 24 个文件；这不是单文件字节上限或精确的 24 小时磁盘保证。Collector 的文件 offsets 保存在自己的 volume，避免每次重启从头重读全部文件。

开发 Prometheus 使用 24h/512MB block retention，Loki 使用 24h retention 与 compactor；这些都是异步清理，不能当作总磁盘配额。Tempo 使用该固定版本的本地存储默认保留策略。开发数据卷需要定期检查容量；生产日志预算与保存位置在部署时明确配置，不从这个本地 profile 推导无限保存承诺。

Collector 容器限制 256 MiB，内部 memory limiter 使用 128 MiB 阈值；这是有余量的单机教学配置。其他后端的规模与生产资源预算仍应按实际负载测量。

## 7. 公开测试与自己的业务

```bash
node scripts/test-backend.mjs --test telemetry --test telemetry_outage --test telemetry_shutdown --test jobs
just check
```

测试捕获真实 OTLP protobuf，驱动实际 Axum/PostgreSQL/Worker/RustFS，验证 parent、actor、持久上下文、审计与指标标签；在 TRACE 级别检查秘密样例不进入输出。出口阻塞测试连续完成 1,024 次 HTTP 请求并观察有限积压；另测 Collector 503 和不回应时的业务 ready、有限关停。日常开发使用这些较快的接口测试，完整 profile smoke 留给观测变更和里程碑。

自己的业务只需沿用 Core 的认证和 Job 事务接口，用 `tracing` 记录必要的静态事件；Domain 不直接依赖 OTel。授权成功后才记录 actor，业务 payload 与观测 metadata 分开，任何新指标都先确定有限标签集合。

移除知识库会删除本章与特定的导出 smoke 脚本；通用 telemetry、Core HTTP/Job/Audit 接线、观测 profile、看板、配置参考和三个 Core 集成测试保留。更换业务无需另起一套观测管线。
