# 变量来源与作用域

配置先按读取者分类。API、Worker 的变量与默认值在 [生成服务端配置](site:reference/config.md)；它们来自 [Rust 配置导出程序](../../apps/api/src/bin/config-reference.rs)，不在本页重复默认值。添加服务端配置时同时更新所属 `FIELDS`、实际读取逻辑和 `.env.example`，文档检查会发现缺少的示例键。

## API 与 Worker

| 变量范围                           | 读取来源                                                                                                                    | 作用域 / 边界                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 数据库、监听、认证、文件和上传限额 | [Settings / AuthSettings / FileLimits](../../crates/platform/src/config.rs)                                                 | 服务端启动验证；生产环境中 APP_ORIGIN 是可信浏览器 origin，不是 API 内部容器地址 |
| Worker 监听、租约、心跳与停机      | [WorkerPolicy / FIELDS](../../crates/app/src/modules/jobs/worker.rs)                                                        | Worker 进程；API 与 Worker 共用数据库和对象存储设置                              |
| 缓存与限流策略                     | [Cache](../../crates/platform/src/cache.rs)、[RateLimiter](../../crates/app/src/modules/rate_limit/mod.rs)                  | API 启动构造并共享实例；Redis 失联时按策略降级                                   |
| SMTP、邮件加密、密码恢复           | [邮件配置](../../crates/platform/src/mail.rs)、[PasswordReset](../../crates/app/src/modules/identity/password_reset/mod.rs) | API/Worker 必须使用一致密钥版本；生产秘密由部署方提供                            |
| 遥测队列、端点与超时               | [TelemetrySettings](../../crates/platform/src/telemetry/settings.rs)                                                        | API/Worker 的有界导出；`RUST_LOG` 由进程的 EnvFilter 读取                        |

<!-- example:knowledge:configuration-source:start -->

知识库导出的 `EXPORT_*` 变量由 [ExportPolicy](../../crates/app/src/modules/knowledge/exports/configuration.rs)读取，属于参考业务。移除该业务时，所有权清单同时移除导出配置；你自己的工单导出应定义自己的策略。
<!-- example:knowledge:configuration-source:end -->

## 本地开发与容器

| 变量                                                                                                        | 来源                                                                                              | 用途与限制                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `POSTGRES_PASSWORD`、`POSTGRES_PORT`、`REDIS_PORT`、`RUSTFS_PORT`、`MAILPIT_SMTP_PORT`、`MAILPIT_HTTP_PORT` | [compose.yaml](../../compose.yaml)、[.env.example](../../.env.example)                            | 开发容器凭据和宿主机端口；不是前端配置                    |
| `WEB_PORT`、`VITE_API_PROXY`                                                                                | [Web Vite 配置](../../apps/web/vite.config.ts)、[dev.mjs](../../scripts/dev.mjs)                  | 本地监听 / 开发服务器代理目标；不会让浏览器读取数据库 URL |
| `TELEMETRY_HTTP_PORT`、`PROMETHEUS_PORT`、`LOKI_PORT`、`TEMPO_PORT`、`GRAFANA_PORT`                         | [可观测性脚本](../../scripts/lib/observability.mjs)、[组合配置](../../compose.observability.yaml) | 可选本地观测依赖端口                                      |
| `CARGO_BUILD_JOBS`                                                                                          | [开发进程工具](../../scripts/lib/process.mjs)、Cargo                                              | 编译并发；影响构建资源，不是业务运行参数                  |

`developmentEnv()` 使用 Node 的 dotenv parser，合并顺序为 `.env.example` → 未跟踪的 `.env` → 进程环境；后者覆盖前者。开发捕获邮件启用且未提供加密 key 时，由 [开发密钥工具](../../scripts/lib/development-mail-key.mjs)创建本机受保护文件，文档构建不读取该文件。直接 `cargo run` 不会自动套用这套合并，优先使用 task runner。

在 `.env` 中只改对应的 `*_PORT`。开发环境读取器从 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 和端口派生 `DATABASE_URL`；同时派生 Redis/S3 地址、`APP_BIND`、`WORKER_BIND`、`APP_ORIGIN`、`VITE_API_PROXY`、桌面入口和 SMTP 端口。显式填写这些派生变量仍可连接外部服务；沿用旧 `.env` 时移除不再需要的显式地址，才能让端口修改自动生效。默认宿主端口采用高位段，容器内部端口保持服务原生值。

`just services-up` 和 `just dev` 都先检查宿主监听与 Docker 已发布端口，再启动并核对真实端口映射。`compose.yaml` 无固定项目名，开发入口按目录名称和完整路径摘要派生容器、卷和网络 namespace。复制已创建的项目后应重新分配 `.env` 端口；通过脚手架创建的各副本已经分配独立端口。

## 浏览器与桌面

| 变量                                                                              | 来源                                            | 作用域                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `VITE_DOCS_URL`                                                                   | [文档入口配置](../../apps/web/src/main.tsx)     | Vite 构建进浏览器的公共文档 URL；只填公开地址      |
| `SAAS_DESKTOP_ORIGIN`、`SAAS_DESKTOP_DOWNLOADS_DIR`、`SAAS_DESKTOP_USER_DATA_DIR` | [Electron main](../../apps/desktop/src/main.ts) | 桌面进程的页面入口、下载与用户数据目录；API 不读取 |

Vite 前缀变量可能进入公开 bundle。数据库密码、Session secret、API Key、SMTP 密码和邮件加密 key 不能使用 `VITE_` 命名或放进客户端源码。

## 文档发布与部署

| 变量                                    | 来源                                                                                                        | 用途                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GITHUB_REPOSITORY`、`DOCS_BASE`        | [VitePress 配置](../../apps/docs/.vitepress/config.mts)、[构建链接检查](../../scripts/check-docs-build.mjs) | 仓库 URL / 发布子路径；默认路径由仓库名推导                                 |
| `DOCS_SOURCE_REF`                       | [文档投影器](../../scripts/lib/docs.mjs)                                                                    | 源码链接和页脚版本；未设置时取当前 Git HEAD。页脚不代表每个教程命令都运行过 |
| `ENV_FILE` 与生产域名、端口和数据库凭据 | [生产环境样例](../../deploy/production/env.production.example)、[生产组合](../../compose.production.yaml)   | 部署容器、HTTPS 与受保护配置；不由文档构建读取                              |

查不到变量时，先在读取代码确认其类别，再查看对应样例；不要把开发容器端口或文档发布变量加入 Rust Settings。生产配置的启动验证与 HTTPS 操作见 [部署指南](../tutorials/21-single-machine-production.md)。
