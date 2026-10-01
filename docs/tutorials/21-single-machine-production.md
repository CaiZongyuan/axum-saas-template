# 部署自己的 SaaS 后端

把业务模块、迁移和 Worker Handler 提交到同一个源码版本，再用生产组合发布。当前部署模型是一次部署服务一个 Organization；企业内部资源仍需各自授权，多个业务模块也不构成多个租户。共享部署多家企业需要重新设计数据归属，见[单企业部署 ADR](../adr/0001-single-organization-deployment.md)。

本指南需要 Docker Compose、Rust/Node/pnpm 工具链、可访问的 TLS 域名，以及已通过 HTTP 检查的业务代码。以下命令都在仓库根目录运行，会创建或更新生产数据库与对象卷。

## 配置与构建

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
just production-build
```

填写 [环境模板](../../deploy/production/env.production.example)中的 `DOMAIN`、`POSTGRES_PASSWORD`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`，确认 `APP_ORIGIN` 与 `S3_PUBLIC_ENDPOINT` 都指向公开 HTTPS 入口。密码和密钥由部署方生成，环境文件不提交到 Git，也不进入镜像。完整类型、默认值与校验见[配置参考](site:reference/config.md)。

启用邮件时，API 和 Worker 必须使用相同的 `MAIL_ENCRYPTION_KEY`（32 字节 hex）；未配置 SMTP 时邮件关闭。遥测端点可以留空。配置邮件或遥测后，其出口失联也不会阻塞普通业务请求。

[Dockerfile](../../deploy/production/Dockerfile)构建 API/Worker 并嵌入迁移；Web 产物由 Caddy 服务。自己的迁移必须在构建上下文的 `migrations/` 内，Handler 必须在 [Worker 组装点](../../apps/worker/src/main.rs)注册。容器使用非 root 用户、只读根文件系统和临时目录。

## 显式迁移，再启动进程

```bash
just production-up .env.production
```

`just` 的环境文件是位置参数；省略时默认使用 `.env.production`。配方按以下顺序执行：

```text
PostgreSQL / Redis / RustFS 健康
  → migrate 一次性容器
  → storage-init 一次性容器
  → API / Worker / Caddy 健康
```

迁移和建桶在 `ops` profile 中显式运行。API 与 Worker 启动不会修改 schema；未迁移或迁移集合/checksum 与源码不一致时，readiness 失败。迁移失败会让配方在启动应用前退出，修复原因后重跑：

```bash
just production-migrate .env.production
just production-up .env.production
```

[生产组合](../../compose.production.yaml)只发布 Caddy 的 80/443；API、Worker、数据库、Redis 与 RustFS 留在内部网络。手动调用 Compose 时，`--env-file` 负责插值，服务的 `env_file` 还需要 `ENV_FILE`：

```bash
ENV_FILE=.env.production docker compose -f compose.production.yaml --env-file .env.production ps
```

## 验证自己的公开合同

在 shell 中将 `DOMAIN` 设为环境文件里的域名，再检查：

```bash
curl --fail "https://$DOMAIN/health/live"
curl --fail "https://$DOMAIN/health/ready"
curl -I "http://$DOMAIN/"
```

预期两个健康接口返回 200，明文入口重定向到 HTTPS。随后用自己的 API 完成“创建 → 读取 → 更新”，检查重启后数据和 Session 仍有效，并执行一个 Worker 任务直到终态。资源拒绝与版本冲突也应通过同一 HTTPS 入口验证；健康接口不能证明业务授权正确。

对象 URL 使用公开入口签名。[Caddyfile](../../deploy/production/Caddyfile)把桶路径原样转发给 RustFS，不能在反向代理中改写签名的 Host 或路径。新增业务应通过 Files 使用这条通道。

## 故障与进程生命周期

| 故障               | 需要保持的合同                                                          |
| ------------------ | ----------------------------------------------------------------------- |
| PostgreSQL 不可达  | readiness 和依赖数据库的业务返回受控 503，带 request_id；恢复后无需重启 |
| Redis 不可达       | 缓存回源数据库，限流使用有界保守回退；readiness 不因此失败              |
| RustFS 不可达      | 数据库内容仍可读；对象上传/完成返回受控失败，恢复后可重试               |
| 邮件或遥测出口失联 | 业务继续；邮件由 Job 重试，遥测导出与停止刷新有截止时间                 |
| Worker 停止        | 请求可入队，任务保存在 PostgreSQL，Worker 恢复后继续认领                |

停止 API 先 drain HTTP 请求；停止 Worker 先停止认领并排空在手工作。

| 进程   | 内部停止期限                                                                          | Compose 宽限期 |
| ------ | ------------------------------------------------------------------------------------- | -------------- |
| API    | HTTP 排空 3 秒、连接池关闭 1 秒，再有界刷新遥测                                       | 30 秒          |
| Worker | 在手任务 `JOB_SHUTDOWN_SECS`（默认 10 秒），健康 HTTP 与连接池各 1 秒，再有界刷新遥测 | 45 秒          |

遥测 trace 刷新最多 2 秒，metrics reader 使用 SDK 的 5 秒停止等待。生产 smoke 和备份要求 API 在 25 秒前、Worker 在 40 秒前退出并具有 drain 日志，以避开强杀宽限期。调大任务收尾期限时同步检查总预算与 Compose 宽限期；自己的 Handler 也要尊重取消、租约和退出期限，不能用无限等待阻塞维护窗口。

## 升级与失败恢复

先按[备份指南](22-backup-restore.md)生成并核对归档，再停止旧应用、构建已审阅版本并迁移：

```bash
just production-down .env.production
just production-build
just production-up .env.production
```

`production-down` 保留数据卷。迁移失败时保留失败日志与数据库，排除问题后重试；新迁移可能已提交，不能假定换回旧镜像就能回滚 schema。恢复应进入独立环境，并使用归档对应的应用版本。

框架的可重复验证入口是：

```bash
node --test tests/tooling/production-compose.test.mjs
just production-smoke
```

`production-smoke` 创建测试密钥和临时生产组合，经真实 TLS 验证参考应用、依赖故障、持久性和 drain，结束删除其测试卷。它需要空闲的 80/443，不能与现有生产入口共用端口；它不验证读者新增的业务，应补自己的 HTTPS 旅程。

下一步：[保护业务数据并验证独立恢复](22-backup-restore.md)。
