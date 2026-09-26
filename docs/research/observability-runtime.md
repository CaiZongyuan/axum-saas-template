# T19 可观测性运行时：固定版本、传播与可选单机 profile

查证日期：2026-09-26。范围为 Rust 1.96 / Tokio、Core HTTP → durable Job → Worker → S3、JSON 日志与可选 Collector/Prometheus/Loki/Tempo/Grafana。**只查阅官方源码、发布信息和 registry manifest；未添加依赖、编译片段、拉取镜像或启动服务。** 下列代码/配置是实施起点，不代表本仓库已实现或已通过兼容性测试。

仓库当前只有 `tracing_subscriber::fmt().json()`；HTTP 已有 request ID 和路由模板，Job 已有 correlation/causation，Audit 表有尚未写入的 trace ID。实现应保留这些业务关联，新增 W3C context 的持久化和实际导出。Core 观测能力不依赖参考业务；Domain 不 import OTel。[现有 telemetry](../../crates/platform/src/telemetry/mod.rs)、[HTTP](../../crates/app/src/http.rs)、[Jobs](../../crates/app/src/modules/jobs/mod.rs)、[Audit](../../crates/app/src/modules/audit/mod.rs)、[T19](https://github.com/CaiZongyuan/axum-saas-template/issues/20)、[ADR 0002](../adr/0002-executable-removable-reference.md)

## 1. 固定 Rust API，避免旧版初始化范例

下面四个版本均未撤回，MSRV 为 1.75，满足本项目 1.96。`tracing-opentelemetry 0.34.0` 明确依赖 OTel 0.33、tracing ≥0.1.35、tracing-subscriber ≥0.3.22，与当前 tracing 0.1.44 / subscriber 0.3.22 相容。这里只核对 manifest，最终以 Cargo.lock 和实际编译为准。[registry][crates-api]、[bridge manifest][bridge-cargo]、[OTLP manifest][otlp-cargo]

```toml
opentelemetry = { version = "=0.33.0", default-features = false, features = ["trace", "metrics"] }
opentelemetry_sdk = { version = "=0.33.0", default-features = false, features = ["trace", "metrics"] }
opentelemetry-otlp = { version = "=0.33.0", default-features = false, features = ["trace", "metrics", "http-proto", "reqwest-blocking-client"] }
tracing-opentelemetry = { version = "=0.34.0", default-features = false }
```

**建议：**OTLP/HTTP protobuf；应用仍写 JSON，Collector 从文件读取日志，所以不用 Rust OTel logs bridge。直接用 OTel metrics instruments，不需要 tracing-opentelemetry 的 `metrics` feature。上述 transport 没有 TLS，仅适用于本机 loopback/Compose 内网；HTTPS 另启用 `reqwest-rustls`。OTLP 0.33 使用 reqwest 0.13，勿误以为复用了项目现有 reqwest 0.12 的 client。[OTLP manifest][otlp-cargo]

- 构造链：`SpanExporter::builder().with_http().with_endpoint(full_trace_url).with_timeout(duration).with_retry_policy(RetryPolicy::disabled()).build()`；导入 `WithExportConfig`、`WithHttpConfig`。metrics 对应 `MetricExporter::builder()`，接 `PeriodicReader::builder(exporter).with_interval(duration).build()` 与 `SdkMeterProvider::builder().with_reader(reader)`。[HTTP exporter][http-exporter]、[PeriodicReader][periodic-reader]
- **Rust `.with_endpoint()` 必须给完整 `/v1/traces` 或 `/v1/metrics` 路径。**只有通用环境变量 `OTEL_EXPORTER_OTLP_ENDPOINT` 自动追加信号路径；signal-specific 环境变量与程序传值均原样使用。不要把 Collector 的 base endpoint 配置语义照搬给 Rust builder。[endpoint 源码][http-exporter]
- 默认 `BatchSpanProcessor` / `PeriodicReader` 各有专用线程，支持 blocking HTTP client。异步 `reqwest-client` / `hyper-client` 不支持这两个默认 processor；若依赖 feature 合并启用了异步 client，它的选择优先级更高，需要显式 blocking client 或改用 experimental async processor。`grpc-tonic` 也受支持，但 provider 要在 Tokio runtime 内创建。[batch][batch-spans]、[reader][periodic-reader]
- 用 `Resource::builder_empty().with_service_name("saas-api" / "saas-worker")` 加少量固定 service/version/environment 属性，避免任意环境资源属性流入标签。`SdkTracerProvider::builder().with_span_processor(processor).with_resource(resource)` 后取得 tracer，挂 `tracing_opentelemetry::layer().with_tracer(tracer)`；保留 provider 所有权到关停。[provider][trace-provider]、[Resource][resource]

## 2. 有界出口与关停的真实保证

| 源码保证/限制 | 建议配置或处理 |
| --- | --- |
| BatchSpanProcessor 使用 bounded channel 与 `try_send`；满时丢弃新 span，不在业务线程等待 Collector。默认 queue 2048、batch 512、delay 5s。[batch][batch-spans] | 显式设 queue 512、batch 64、delay 1s；这是开发起点。限制每 span 的 attributes/events/links 数量以及自有字符串长度，队列“条数有界”本身不等于字节有界。 |
| 默认专用线程 processor 不执行 `BatchConfig.max_export_timeout`；对应 setter 只在 experimental async feature 下提供。[batch][batch-spans] | 在 exporter 设 1s timeout；不把 `OTEL_BSP_EXPORT_TIMEOUT` 当默认 processor 的硬时限。 |
| 0.33 HTTP exporter 默认重试 3 次；retry budget 只决定是否开始下一次尝试/等待，不能取消已开始的操作。默认 blocking reqwest client 另有配置的请求 timeout。[HTTP][http-exporter]、[retry][retry] | `RetryPolicy::disabled()` 只做一次请求；Collector 承担短期有限重试。减少 outage 时积压和关停延迟；接受 telemetry 丢失。 |
| PeriodicReader 后台聚合导出，不按每个 measurement 入队；observable callback 没有超时。stream 默认 cardinality limit 2000。[reader][periodic-reader]、[Stream][metric-stream] | 用固定 instruments、低基数属性、同步 counter/histogram；view 通过 `Stream::builder().with_allowed_attribute_keys(...).with_cardinality_limit(128)` 限制每个流。不在 callback 查询 DB/S3。 |
| Trace provider `shutdown_with_timeout` 将 timeout 交给每个 processor；不是跨多个 processor 的共享总预算。[provider][trace-provider] | 只设一个 batch processor，drain HTTP/Worker 后，在 blocking 线程关闭 provider。 |
| **`SdkMeterProvider::shutdown_with_timeout` 在 0.33 忽略传入 timeout**；默认 PeriodicReader 使用固定 5s 等待。`force_flush` 的等待也不能作为可配置 deadline。[meter][meter-provider]、[reader][periodic-reader] | 关停预算要包含该 5s；不要声称传入 500ms 就满足 500ms 合同。需要更短全局上限时，用受控线程/进程退出预算，并测试真实 hanging endpoint；丢弃 `spawn_blocking` handle 不会取消其工作。 |

Collector outage 不进入 readiness 必要依赖，不 fail API/Worker 启动，不把 exporter error 返回给业务，也不重试业务以补偿 telemetry 丢失。默认关闭 OTel `internal-logs`，防止它把原始网络错误/endpoint 再写回 tracing；若开启诊断，需独立过滤并脱敏。[OTLP features][otlp-cargo]、[架构规范 §18](../saas-template-architecture-spec.md#18-可观测性健康与安全基线)

JSON 输出也可用 `tracing-appender = "=0.2.5"` 的 `NonBlockingBuilder::buffered_lines_limit(1024).lossy(true)`，持有 `WorkerGuard`；`error_counter().dropped_lines()` 可观测丢失。它限制消息条数，需同时限制行长度；`lossy(false)` 会反压业务。guard Drop 最多分别等待 100ms 发送 shutdown 与 1s 完成握手，不保证所有日志已落盘。文件轮转/保留与磁盘容量仍需单独配置。[appender][appender]

## 3. HTTP → 持久化 Job → Worker，和日志/Audit 的关联

**建议在 Platform 封装传播，在 Core Application 的事务/执行边界调用；以下不是新 Domain 接口。**

1. HTTP 仅提取 W3C `traceparent`/`tracestate`，经 `TraceContextPropagator` + `Extractor` 解析；无效/全零 ID 会被上游拒绝，创建新 root。限定 header 长度，不转存完整 header map 或 baggage；这些值不用于授权。[propagator][propagator]
2. 创建 request span 后立即 `span.set_parent(parent_context)`，**先于 `span.context()`、enter 或事件**；0.34 返回 `Result<(), SetParentError>`，已激活的 span 不能重设 parent。用 `future.instrument(span)` 穿越 await，不持有 enter guard。[bridge][bridge-ext]
3. 获取真实 `span.context().span().span_context()`；有效时将 32 位小写 hex trace ID / 16 位 span ID 记录到受控字段。`.json()` 不会自行读取 OTel ID；需显式填 span 字段，或专门的 JSON formatter 提升关联字段。标准 JSON formatter 有 `span` / `spans` 层级，必须让日志查询与测试匹配最终结构。[bridge][bridge-ext]、[JSON formatter][json-format]
4. enqueue 时把 `TraceContextPropagator::inject_context(&current_context, &mut HashMap<String,String>)` 的两个字符串写进 **同一 Job INSERT 事务的独立 metadata 列**，与业务 payload 分开；同时保留 origin request ID、actor ID、correlation ID 与 causation ID。OTel Context / tracing Span 不能作为持久化格式。[propagator][propagator]、[Jobs](../../crates/app/src/modules/jobs/mod.rs)
5. Worker claim 后从持久化 carrier 提取 remote parent，给每次 attempt 新建 consumer span，再 `set_parent`、记录 job/correlation/causation/actor/attempt、instrument handler future。重试不能复用 span ID；建议自动重试沿用原 parent，人工重试保留原 correlation 并记录当前操作的 causation。租约、事务语义不变。
6. S3 调用形成该 attempt 的 child spans，日志/Audit 从当前有效 context 取 ID；Audit 的 trace ID 与记录本身同事务持久化。实际请求响应可提供 `x-trace-id`，但 request ID、correlation ID 不等同于 trace ID。采样未导出的 trace 仍可能有有效 ID；没有 OTel layer 时不要写全零伪 ID。[bridge][bridge-ext]、[Audit](../../crates/app/src/modules/audit/mod.rs)

开发追踪可用 `Sampler::ParentBased(Box::new(Sampler::AlwaysOn))`；测试传 sampled=1 的 header，避免 sampled=0 被正确继承后误判丢 span。采样是观测策略，不改变 Audit/Job 是否持久化。长生命周期 Job 更适合新 trace + span link，但 T19 的直接 parent 方案更容易在一个 trace 看完整演示；这是选择，不是 OTel 要求。[provider][trace-provider]、[links API][bridge-ext]

**字段策略建议：**metric 仅允许 route **模板**（未知路由统一 `unmatched`）、标准 method、status class、注册过的 job kind、有限 outcome / error kind / S3 operation；未知 method/kind 归为固定 `other`。ID、raw URL、对象 key、文件名、actor、错误文本不得成为 metric label。用固定业务错误码定位 `not_found / denied / timeout / unavailable / integrity` 等故障；S3 span 保留操作、耗时、结果和受控资源 ID，不记录原始 SDK error Debug/Display、body、bucket/key/path、credential、完整 endpoint 或签名 URL query。也不要自动开启 SDK HTTP debug instrumentation。保留有限错误码足以区分可重试服务故障和数据/授权问题；原始响应不会因放进 span event 而变安全。[架构规范 §18](../saas-template-architecture-spec.md#18-可观测性健康与安全基线)

## 4. 已查证的官方镜像 pins

下列 digest 是 2026-09-26 从 Docker Hub Registry V2 带 Accept manifest-list/OCI-index 读取的 **多架构 manifest list digest**，均包含 linux/amd64 与 linux/arm64；不是单架构 layer digest。官方 release 对应版本存在，但不代表此组合已经联调。[Collector release][collector-release]、[Prometheus release][prom-release]、[Loki release][loki-release]、[Tempo release][tempo-release]、[Grafana release][grafana-release]

| 服务 | 固定 image |
| --- | --- |
| Collector contrib | `otel/opentelemetry-collector-contrib:0.161.0@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1` |
| Prometheus | `prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e` |
| Loki | `grafana/loki:3.7.8@sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193` |
| Tempo | `grafana/tempo:3.0.3@sha256:0296560ac66f8a3600d7fb3014a52c189d4d9c3549ad6ff441bf2409855d68d5` |
| Grafana | `grafana/grafana:13.2.2@sha256:ac461fb352abc50da10a51c7d02462e9c05488f11f53f14b3ad79a8145f638a0` |

复查入口为 `https://registry-1.docker.io/v2/<repository>/manifests/<tag>` 的 `Docker-Content-Digest` header（需正常 registry pull token），例如 [Collector manifest][collector-manifest]。不要替换为 `latest`。

**建议 Compose 合同：**单独 override 文件，全部服务标 `profiles: [observability]`；Collector 4318、Grafana 3000 及调试用 Tempo 3200/Loki 3100/Prometheus 9090 只绑定 `127.0.0.1`。容器内 receiver 必须监听 `0.0.0.0`，通过服务名互通。原本在宿主机运行的 API/Worker 发送到 `http://127.0.0.1:4318`；容器内应用用 `http://collector:4318`。各后端独立 named volume，配置只读挂载；确认镜像默认 UID 对数据卷的写权限。Collector 可设容器内存上限 256MiB，下面 limiter 128MiB；limiter 是抽样控制，不是精确 RSS 硬界限。[OTLP receiver][collector-receiver]、[memory limiter][memory-limiter]

## 5. 最小配置起点

以下数据流是 **traces → Tempo，metrics → Collector Prometheus exporter → Prometheus scrape，JSON log files → filelog → Loki 原生 OTLP**。无需 Docker socket、不运行旧 Loki exporter，不给 Tempo 开 metrics-generator/remote-write。每个配置文件路径由实施时 Compose 明确挂载。

Collector 0.161 已将 exporter 正名为 `otlp_http`；`otlphttp` 是尚可用的 deprecated alias。Collector 的 `endpoint` 自动追加 `/v1/<signal>`，因此 Loki 用 `/otlp` base。[exporter][collector-http]、[Loki OTLP][loki-otlp]

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
  filelog/api:
    include: [/logs/api.jsonl]
    start_at: beginning
    max_log_size: 16KiB
    resource: {service.name: saas-api}
    operators:
      - type: json_parser
        parse_to: body
        timestamp:
          parse_from: body.timestamp
          layout_type: gotime
          layout: '2006-01-02T15:04:05.999999999Z07:00'
        severity: {parse_from: body.level}
  filelog/worker:
    include: [/logs/worker.jsonl]
    start_at: beginning
    max_log_size: 16KiB
    resource: {service.name: saas-worker}
    operators:
      - type: json_parser
        parse_to: body
        timestamp:
          parse_from: body.timestamp
          layout_type: gotime
          layout: '2006-01-02T15:04:05.999999999Z07:00'
        severity: {parse_from: body.level}
processors:
  memory_limiter: {check_interval: 1s, limit_mib: 128, spike_limit_mib: 32}
  batch: {timeout: 1s, send_batch_size: 128, send_batch_max_size: 256}
exporters:
  otlp_http/tempo:
    endpoint: http://tempo:4318
    timeout: 2s
    sending_queue: {queue_size: 1024, sizer: items, num_consumers: 2, block_on_overflow: false}
    retry_on_failure: {initial_interval: 1s, max_interval: 5s, max_elapsed_time: 10s}
  otlp_http/loki:
    endpoint: http://loki:3100/otlp
    timeout: 2s
    sending_queue: {queue_size: 1024, sizer: items, num_consumers: 2, block_on_overflow: false}
    retry_on_failure: {initial_interval: 1s, max_interval: 5s, max_elapsed_time: 10s}
  prometheus:
    endpoint: 0.0.0.0:8889
    translation_strategy: UnderscoreEscapingWithSuffixes
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
    logs:
      receivers: [filelog/api, filelog/worker]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/loki]
```

filelog 的 parsed body map 会由 Loki 转成 JSON string；trace ID 保留在 JSON body，Grafana 用下文 derived field 关联。需要原生 OTLP LogRecord trace/span fields 时另加有缺失字段 guard 的 `trace_parser`，不要假设 json_parser 自动识别 IDs。缺少 file storage extension 时 offsets 只在内存，重启 + `start_at: beginning` 可重复摄入；此起点适合开发演示。正式实现的日志目录必须只存应用 JSON，避免 cargo 编译输出混入；明确宿主机目录与 `/logs:ro` 的挂载，文件滚动时调整 include/保留策略。Collector 故障不与应用写日志形成 socket/pipe 反压。[filelog][filelog]、[JSON parser][json-parser]、[trace parser][trace-parser]、[Loki mapping][loki-otlp]

`send_batch_size` 只是触发阈值，`send_batch_max_size` 才限制输出 batch；exporter `sizer: items` 使 queue_size 按 spans/log records 计数，overflow 不阻塞，重试最长时间不设 0。Prometheus exporter 不开启“所有 resource attributes 转 labels”。[batch config][collector-batch]、[queue][collector-queue]、[Prometheus exporter][collector-prom]

Tempo 3.0.3：command `['-target=all', '-config.file=/etc/tempo.yaml']`；这是当前官方 single-binary 部署，旧 `example/docker-compose/local` 路径已不存在。最小配置取官方示例的 receivers 和本地 WAL/storage，关闭演示不需要的 generator 配置；容器数据挂 `/var/tempo`。[官方 Tempo 示例][tempo-config]、[Compose][tempo-compose]

```yaml
server: {http_listen_port: 3200}
distributor:
  receivers:
    otlp:
      protocols:
        http: {endpoint: '0.0.0.0:4318'}
storage:
  trace:
    backend: local
    wal: {path: /var/tempo/wal}
    local: {path: /var/tempo/blocks}
usage_report: {reporting_enabled: false}
```

Loki 3.7.8：command `['-config.file=/etc/loki.yaml']`，数据挂 `/loki`。`tsdb` + schema `v13` 支持 structured metadata；原生 OTLP 需要它。只把固定 service.name 索引成标签，避免默认 service.instance.id 高基数。[local config][loki-config]、[OTLP mapping][loki-otlp]、[override][loki-override]

```yaml
auth_enabled: false
server: {http_listen_port: 3100}
common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem: {chunks_directory: /loki/chunks, rules_directory: /loki/rules}
  replication_factor: 1
  ring:
    kvstore: {store: inmemory}
schema_config:
  configs:
    - from: '2024-01-01'
      store: tsdb
      object_store: filesystem
      schema: v13
      index: {prefix: index_, period: 24h}
limits_config:
  allow_structured_metadata: true
  otlp_config:
    resource_attributes:
      ignore_defaults: true
      attributes_config:
        - action: index_label
          attributes: [service.name]
analytics: {reporting_enabled: false}
```

Prometheus 使用 `--config.file=/etc/prometheus/prometheus.yml`，数据挂 `/prometheus`；无需 remote-write receiver。3.15 已支持 `storage.tsdb.retention` 配置，旧 retention 命令行 flags 标为 deprecated；以下开发保留值只约束 blocks，不是总磁盘硬配额。[官方配置][prom-config]、[storage][prom-storage]

```yaml
global: {scrape_interval: 5s}
storage:
  tsdb:
    retention: {time: 24h, size: 512MB}
scrape_configs:
  - job_name: saas
    honor_labels: true
    static_configs:
      - targets: [collector:8889]
```

Grafana 13.2.2 仍支持文件 provisioning；挂 `/etc/grafana/provisioning/datasources/saas.yaml`。此示例假定实现后的日志有可搜索的 `trace_id` JSON 字段；regex 可从默认 nested span 字段提取，但 LogQL 具体路径需和最终日志格式一致。文件里的 `$$` 是 Grafana 环境变量展开转义，不是 shell。[provisioning][grafana-provision]、[Loki derivedFields][grafana-loki]、[Tempo provision][grafana-tempo]

```yaml
apiVersion: 1
datasources:
  - {name: Prometheus, uid: prometheus, type: prometheus, access: proxy, url: 'http://prometheus:9090'}
  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: http://loki:3100
    jsonData:
      derivedFields:
        - name: TraceID
          matcherRegex: '"trace_id"\s*:\s*"([0-9a-f]{32})"'
          datasourceUid: tempo
          url: '$${__value.raw}'
  - name: Tempo
    uid: tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: '-1m'
        spanEndTimeShift: '1m'
        filterByTraceID: false
        filterBySpanID: false
        customQuery: true
        query: '{service_name=~"saas-api|saas-worker"} |= "$${__span.traceId}"'
```

最小有用视图：Loki `{service_name=~"saas-api|saas-worker"} |= "<trace-id>"`；若 canonical 顶层 IDs，`| json | job_id="..."`；Tempo Explore 直接粘贴 trace ID；Prometheus 按实际 `/metrics` 名称创建 HTTP rate/error、Job outcome、S3 latency 三组图。比如 counter instrument `saas.jobs.completed` 配 outcome，在此 translation strategy 下查询 `sum by (outcome) (rate(saas_jobs_completed_total[5m]))`，须以实际抓取验证名称。dashboard 通过 `apiVersion: 1` / `providers: [{name: saas, type: file, updateIntervalSeconds: 30, options: {path: /var/lib/grafana/dashboards}}]` 加 JSON 文件，不需要操作 Grafana HTTP API；30s 轮询规避 bind-mount watch 事件缺失。[provisioning][grafana-provision]、[metric translation][collector-prom]

## 6. 能观察真实协议的测试 seam 与未验证项

1. **真实 OTLP 捕获端点**：测试启动随机 loopback 端口的 Axum HTTP server，接 `/v1/traces`、`/v1/metrics`，以 `opentelemetry-proto = { version = "=0.33.0", default-features = false, features = ["gen-tonic-messages", "trace", "metrics"] }` + `prost 0.14` 解码真实 protobuf；返回相应 ExportResponse protobuf，HTTP 200 与 `application/x-protobuf`。测试 provider endpoint 指向它；不替换应用 tracer、Worker、Job/DB 或 S3。官方 proto 中 `tonic::collector::trace::v1::ExportTraceServiceRequest.resource_spans` 给出 trace_id/span_id/parent_span_id/attributes。[proto manifest][proto-cargo]、[generated message][proto-message]
2. 驱动真实 HTTP enqueue + PostgreSQL + 受控真实 Worker，捕获完整结束 span 后，断言 server → attempt → S3 的 parent IDs、跨进程 trace ID 和 request/actor/job/correlation/causation 字段；查询真实 Job/Audit 比对。另一场景停止 API、重建 Worker，证明 context 来自 DB，不是进程内 task local。用测试持有的 provider/dispatch 或独立子进程隔离全局 subscriber；避免并行测试抢 `set_global_default`。
3. 端点以 barrier 确认已接收请求但不回复，设小 queue/batch，驱动远超容量的真实请求/任务，证明业务在独立 deadline 内完成；释放端点后仅有限 backlog、正常恢复后新 span 可导出。结合出口计数与单独进程内存观测检查无随请求数线性增长；不拿一次 RSS 读数当严格内存证明。再验证 HTTP 503、拒绝连接、关停 deadline。不要只用 SDK InMemorySpanExporter 假装测试了网络 outage。
4. 注入包含测试 secret/签名 query 的依赖错误，检查捕获 OTLP、JSON、Audit、Job history 都不含原始值；断言 metrics 属性是 allowlist，IDs 只出现在允许的 log/span/Audit 字段。测试不把秘密样例输出进失败报告。
5. 最后用固定镜像真实 profile 运行一次完整用户操作，轮询 Tempo `/api/traces/<id>`、Loki `/loki/api/v1/query_range`、Prometheus `/api/v1/query` 和 Grafana provisioning 的数据源，确认三类数据实际落地。先运行 Collector `validate --config=...`，再检查每个容器日志/就绪与数据卷权限。这些工作属于 T19 实施验收，**本研究未执行**。[Tempo API][tempo-api]、[Loki API][loki-api]、[Prometheus API][prom-api]

剩余明确限制：上面的精简配置未启动联调；实际 JSON 字段层级、文件滚动/目录配置、Tempo/Loki 开发数据保留、Grafana dashboard JSON schema、应用现有 drain 预算与额外 telemetry 预算都要在实现中落实。镜像 pins/源码兼容性不能替代这些验证。该 note 仅链接 Core 文件，不依赖可移除参考业务的本地路径。

[crates-api]: https://crates.io/api/v1/crates/opentelemetry/0.33.0
[bridge-cargo]: https://docs.rs/crate/tracing-opentelemetry/0.34.0/source/Cargo.toml
[otlp-cargo]: https://docs.rs/crate/opentelemetry-otlp/0.33.0/source/Cargo.toml
[http-exporter]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry-otlp-0.33.0/opentelemetry-otlp/src/exporter/http/mod.rs
[batch-spans]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/trace/span_processor.rs
[periodic-reader]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/metrics/periodic_reader.rs
[trace-provider]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/trace/provider.rs
[resource]: https://docs.rs/opentelemetry_sdk/0.33.0/opentelemetry_sdk/struct.Resource.html
[retry]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry-otlp-0.33.0/opentelemetry-otlp/src/retry.rs
[meter-provider]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/metrics/meter_provider.rs
[metric-stream]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/metrics/instrument.rs
[appender]: https://docs.rs/crate/tracing-appender/0.2.5/source/src/non_blocking.rs
[propagator]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry_sdk-0.33.0/opentelemetry-sdk/src/propagation/trace_context.rs
[bridge-ext]: https://docs.rs/crate/tracing-opentelemetry/0.34.0/source/src/span_ext.rs
[json-format]: https://docs.rs/crate/tracing-subscriber/0.3.22/source/src/fmt/format/json.rs
[collector-release]: https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.161.0
[prom-release]: https://github.com/prometheus/prometheus/releases/tag/v3.15.0
[loki-release]: https://github.com/grafana/loki/releases/tag/v3.7.8
[tempo-release]: https://github.com/grafana/tempo/releases/tag/v3.0.3
[grafana-release]: https://github.com/grafana/grafana/releases/tag/v13.2.2
[collector-manifest]: https://registry-1.docker.io/v2/otel/opentelemetry-collector-contrib/manifests/0.161.0
[collector-receiver]: https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/receiver/otlpreceiver/README.md
[collector-http]: https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/exporter/otlphttpexporter/README.md
[collector-queue]: https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/exporter/exporterhelper/README.md
[collector-batch]: https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/processor/batchprocessor/README.md
[memory-limiter]: https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/processor/memorylimiterprocessor/README.md
[collector-prom]: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.161.0/exporter/prometheusexporter/README.md
[filelog]: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.161.0/receiver/filelogreceiver/README.md
[json-parser]: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.161.0/pkg/stanza/docs/operators/json_parser.md
[trace-parser]: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.161.0/pkg/stanza/docs/types/trace.md
[tempo-config]: https://github.com/grafana/tempo/blob/v3.0.3/example/docker-compose/single-binary/tempo.yaml
[tempo-compose]: https://github.com/grafana/tempo/blob/v3.0.3/example/docker-compose/single-binary/docker-compose.yaml
[loki-config]: https://github.com/grafana/loki/blob/v3.7.8/cmd/loki/loki-local-config.yaml
[loki-otlp]: https://github.com/grafana/loki/blob/v3.7.8/docs/sources/shared/otel.md
[loki-override]: https://github.com/grafana/loki/blob/v3.7.8/docs/sources/send-data/otel/_index.md
[prom-config]: https://github.com/prometheus/prometheus/blob/v3.15.0/docs/configuration/configuration.md
[prom-storage]: https://github.com/prometheus/prometheus/blob/v3.15.0/docs/storage.md
[grafana-provision]: https://github.com/grafana/grafana/blob/v13.2.2/docs/sources/administration/provisioning/index.md
[grafana-loki]: https://github.com/grafana/grafana/blob/v13.2.2/docs/sources/datasources/loki/configure/index.md
[grafana-tempo]: https://github.com/grafana/grafana/blob/v13.2.2/docs/sources/datasources/tempo/configure-tempo-data-source/provision.md
[proto-cargo]: https://docs.rs/crate/opentelemetry-proto/0.33.0/source/Cargo.toml
[proto-message]: https://github.com/open-telemetry/opentelemetry-rust/blob/opentelemetry-proto-0.33.0/opentelemetry-proto/src/proto/tonic/opentelemetry.proto.collector.trace.v1.rs
[tempo-api]: https://grafana.com/docs/tempo/latest/api_docs/
[loki-api]: https://grafana.com/docs/loki/latest/reference/loki-http-api/
[prom-api]: https://github.com/prometheus/prometheus/blob/v3.15.0/docs/querying/api.md
