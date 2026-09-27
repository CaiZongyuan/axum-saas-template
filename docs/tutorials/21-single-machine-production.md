# 跟做：把知识库部署到单机生产并验证启停与降级

本章回答“模板如何上单机生产”。一台 Docker 主机、一个 Caddy TLS 入口，静态 Web 由 Caddy 直接服务，API、Worker、PostgreSQL、Redis 与 RustFS 全部留在内部网络、不发布任何端口；数据库迁移与存储初始化永远显式执行。生产组合不是开发 [compose](../../compose.yaml) 的复制品：它有自己的[组合文件](../../compose.production.yaml)、[镜像构建](../../deploy/production/Dockerfile)与[入口配置](../../deploy/production/Caddyfile)，并且用测试锁住这些差异。

## 1. 准备部署环境与密钥

复制模板并填写部署环境文件：

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
```

需要修改的最小集合：`DOMAIN`（TLS 域名，Caddy 据此自动签发证书——公网域名走 ACME，localhost 走本地 CA）、`POSTGRES_PASSWORD`、`S3_ACCESS_KEY`/`S3_SECRET_KEY`。`MAIL_SMTP_HOST` 留空表示邮件关闭（注册与写作不受影响，只有重置邮件不发）；启用 SMTP 时必须同时设置 `MAIL_ENCRYPTION_KEY`（32 字节 hex，api 与 worker 一致），之后即使 SMTP 失联，注册与写作也不受影响，投递任务留在队列按租约重试。`TELEMETRY_ENDPOINT` 留空表示不上报 OTLP；采集器不可达也不阻塞业务。

这个文件装着生产密钥，已被 `.gitignore` 与 `.dockerignore` 排除，永远不进入镜像或仓库。组合文件里的服务 `env_file` 走的是 `ENV_FILE` 环境变量，而 `--env-file` 只喂给插值——[justfile](../../justfile) 的 `production-*` 配方已代为传递 `ENV_FILE`，手动调用 docker compose 时必须带上它。所有键的语义与校验规则见[生成配置参考](site:reference/config.md)或 `deploy/production/env.production.example` 内注释。

## 2. 构建、启动与显式迁移

```bash
just production-build                       # 构建 Web 产物与应用镜像（不需要环境文件）
just production-up ENV_FILE=.env.production # 依赖 → 显式迁移 → 应用
```

`production-up` 的顺序是有意的：先 `--wait` 等 PostgreSQL/Redis/RustFS 健康，再以一次性容器跑 `migrate` 与 `storage-init`（compose 的 `ops` profile，普通 `up` 看不见它们），最后才启动 api、worker、caddy 并等待健康。API 与 Worker 从不偷偷迁移：行为测试让二进制对着空数据库启动，断言 `/health/ready` 持续 503（`database.unavailable`/`worker.unavailable`）、五秒内 `public` schema 仍然零表、进程保持存活（[API 侧](../../apps/api/tests/migration.rs)、[Worker 侧](../../apps/worker/tests/no_implicit_migration.rs)）。

镜像构建是多阶段：Rust 构建阶段带 registry/target 缓存挂载，运行时是 slim Debian + 非 root 用户 + 只读根文件系统（`read_only: true`、tmpfs `/tmp`），基础镜像按 digest 固定。`migrations/` 会被 `sqlx::migrate!` 在编译期嵌入，因此必须留在构建上下文里。

## 3. 验证入口与主旅程

```bash
just production-smoke
```

[冒烟脚本](../../scripts/production-smoke.mjs)随机生成一套密钥、启动完整生产组合，然后经真实 Caddy TLS 链完成：入口检查（`/health/live` 200、首页带 HSTS 与 CSP、明文 HTTP 重定向）、主旅程（注册成 owner、写文档、传附件并回读）、重启持久性、Redis/RustFS/PostgreSQL 三种故障的降级行为、Worker 停机后排队的导出恢复，以及 API 与 Worker 的优雅停止。整个旅程刻意在“邮件已配置但 SMTP 失联、遥测采集器不可达”的环境里跑——注册与写作全程可用，正是降级矩阵承诺的行为。每个阶段失败都会以 `[阶段名]` 前缀抛出，脚本结束时自动 `down -v` 清理。

手工抽查入口也可以：

```bash
curl https://$DOMAIN/health/live
curl -I http://$DOMAIN/   # 期待 308 → https
```

预签名对象 URL 之所以能经入口工作，是因为应用以 `S3_PUBLIC_ENDPOINT`（即 `APP_ORIGIN`）签名，而 [Caddyfile](../../deploy/production/Caddyfile) 把 `/<bucket>/*` 原样转发给 rustfs:9000，路径与 Host 都不改动，v4 签名保持有效。

## 4. 停止、重启与降级规则

`docker compose restart api worker`（或 stop/start）验证的是同一件事：会话 Cookie 与数据都活过容器替换，因为状态只落在 PostgreSQL 与对象卷里。停止超时由组合文件的 `stop_grace_period` 与进程内预算匹配：

| 容器   | 进程内停止预算                                                      | stop_grace_period |
| ------ | ------------------------------------------------------------------- | ----------------- |
| api    | 3s HTTP drain + 1s 连接池 + 有界遥测刷新（合计 ≤15s）               | 30s               |
| worker | api 预算 + `JOB_SHUTDOWN_SECS`（默认 10s）在手任务收尾（合计 ≤25s） | 45s               |
| 其余   | 无自定义逻辑，默认停止即可                                          | 10–30s            |

冒烟脚本会掐表验证这一点：api 的停止耗时必须明显低于 30s 宽限期（证明是自行退出而不是被强杀），日志里出现 `draining HTTP requests`；Worker 停止同理，日志里出现 `stopping worker claims and draining current work`。

非核心依赖故障按规格矩阵降级，每种行为都被冒烟覆盖：

| 故障             | 行为                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| PostgreSQL 停止  | `/health/ready` 变 503，业务读返回受控 503（带 `request_id`），恢复后无需重启即恢复 200 |
| Redis 停止       | 缓存回退数据库，注册与写作继续；就绪探针只看数据库，容器不会被误判为不健康              |
| RustFS 停止      | Markdown 仍在 PostgreSQL 可读；新上传的 PUT 失败、完成返回受控 503；恢复后重试成功      |
| 邮件已配置但失联 | 注册与写作不受影响；重置/验证邮件任务留在队列按租约重试                                 |
| 遥测采集器不可达 | 业务不受影响；批量导出有界，进程停止时按截止时间刷新                                    |

Worker 停机时不丢工作：导出请求照常 202 受理，Worker 回来后从数据库任务表认领并完成（租约由 `JOB_LEASE_SECS` 保护）。

## 5. 升级与维护窗口

升级 = 换镜像 + 显式迁移，顺序固定：

```bash
just production-down ENV_FILE=.env.production    # 或只 stop api worker 做滚动窗口
git pull && just production-build
just production-migrate ENV_FILE=.env.production # 显式执行新迁移
just production-up ENV_FILE=.env.production
```

失败处理是同一条命令的自然结果：`migrate` 一次性容器以非零退出时，`production-up` 在启动应用之前中止，数据库停留在上一个成功迁移，旧容器停止、新容器尚未接管——排除问题（最常见是环境文件缺键或数据库不可达）后重跑 `production-migrate` 即可，已成功的迁移不会重复执行。

`docker compose up -d` 只重建镜像或配置变化的服务；数据卷（PostgreSQL 数据、对象存储、Caddy 证书）在升级之间持久。任何时刻不要手工进入容器改数据——恢复路径属于备份与恢复教程（T23）。

## 6. 运行本章检查

```bash
node --test tests/tooling/production-compose.test.mjs   # 组合文件与安全属性
just production-smoke                                    # 真实组合全旅程
just check
```

[组合测试](../../tests/tooling/production-compose.test.mjs)在每次 `just check` 里校验生产组合的结构属性：只有 Caddy 发布端口、长驻服务都有健康检查与资源上限、迁移服务藏在 `ops` profile 且不被依赖、API/Worker 命令里没有 migrate、只读根文件系统、env 模板不含真实密钥、`.dockerignore` 排除 `.secrets` 与 `.env*`。重点是：迁移显式、入口唯一、故障按矩阵降级、宽限期匹配停止预算。
