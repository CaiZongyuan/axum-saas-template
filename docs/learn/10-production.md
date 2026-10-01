# 10 部署、观测并恢复自己的工单业务

起点：`jobs` 检查点和第九课的公开检查。把同一份模块带到生产，目标是证明工单、文件和排队任务真实可恢复，不是只让健康接口返回 200。

前提是单机 Docker 主机、可访问 TLS 域名、生产配置和已经审阅的源码。下面在课程副本根目录执行，生产步骤会创建持久数据与开放入口；先完整阅读[生产部署指南](../tutorials/21-single-machine-production.md)。

## 确认自己的业务已组装

```bash
pnpm boundaries:check
cargo check --locked -p saas-api -p saas-worker
```

API 的两条 Router 路径和 OpenAPI 必须含 tickets，Worker 必须注册工单导出 Handler，以及 Core 文件清理/维护与业务导出期限维护。默认模板未注册工单，不能在原模板直接构建并期待课程接口出现。

把这份副本中的业务变更保存到自己的源码版本；课程 `.env`、Cookie 与下载产物都是本地开发数据，不复制进生产密钥配置。

## 构建与显式迁移

```bash
cp deploy/production/env.production.example .env.production
$EDITOR .env.production
just production-build
just production-up .env.production
```

填写真实 DOMAIN、Origin、数据库/存储密钥；启用邮件时 API/Worker 使用相同加密 key。构建嵌入包含工单表的迁移集合；启动顺序是依赖健康 → migrate → storage-init → API/Worker/Caddy。不要用 API 启动隐式补 schema。

将请求终端的 `BASE_URL` / `ORIGIN` 改为这个 HTTPS 入口，然后重新执行第二课注册/创建和第七课上传下载，生成这次生产演练的数据。开发副本的数据不会因部署源码自动迁移进生产卷。

```bash
curl --fail "$BASE_URL/health/ready"
curl --fail -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

预期 readiness 与工单读取 200，TLS 入口与授权规则一致。迁移不匹配时 readiness 503，应核对当前镜像、迁移与数据库，再显式迁移。

## 关联请求、任务和持久事实

保留创建/导出响应的 request_id，查询工单、Core Job 和审计。当前 tracing/Jobs/Audit 接线会关联请求与每次 Worker attempt；请求结束后任务也有自己的 span。产物和通知可查询才证明提交，看到 trace 不等于成功。

需要本地观测组合时在开发环境运行 `just dev-observability`，按[观测指南](../tutorials/19-observability.md)查日志、队列和存储操作；新增业务无需让 Domain 依赖 OTel。已有观测服务占端口时先配置空闲观测端口。日志不保存正文、Cookie、密码或完整签名 URL，资源 id 不作为高基数 metric label。

Redis 或遥测失联不改变工单持久状态。Worker 暂停时导出请求可以排队，恢复后继续领取；自己的任务依然必须尊重租约、取消与发布时重新授权。

## 备份与独立恢复

在原模板根目录可先运行工单专用的本地演练：

```bash
pnpm tutorial:recovery:check
```

它要求本地 Docker 及空闲的 80/443，创建独立课程副本、镜像和两个生产 Compose 项目，通过 localhost TLS 执行真实工单创建/更新、附件上传、停 Worker 入队、备份和独立恢复。恢复后比对工单字段/版本、附件字节、JSON 导出和终态通知；结束清理自己创建的项目、卷与私有临时数据，只保留脱敏报告。它验证课程业务的本地交付与恢复，自己的公网域名和生产主机仍按下面的步骤验收。完整入口见[工单恢复演练](../../scripts/check-tutorial-recovery.mjs)。

按[备份指南](../tutorials/22-backup-restore.md)进入维护窗口，先 drain API 再 Worker：

```bash
just production-backup .env.production backups/ticket-course
just production-down .env.production
just production-restore backups/ticket-course .env.production
```

检查 backup/restore 报告 PASS，生产卷保留，恢复项目使用新网络与新卷。归档包含业务 schema 和 Files ready 对象，不包含密钥；准备归档对应镜像和受保护配置，不把新迁移强行应用到历史恢复库。

恢复后再请求同一个生产 `TICKET_ID`，比对字段/版本；按第七课下载附件比对 sha256；备份前排队的导出应由恢复 Worker 完成。pending 上传按 TTL 处理，1 小时导出到期后停止签下载并由业务维护回收。

框架 `production-smoke` / `production-restore-drill` 默认验证知识库旅程，不会自动断言工单。自己的上述恢复结果必须单独记录；健康或清单通过不能替代业务旅程。任何流量切换都显式决定，不能用删除生产卷解决端口冲突。

上一课：[公开验证与 SDK](09-verification.md)。课程完成后，从[能力指南](../getting-started/documentation.md)继续加入自己的业务规则和独立交付检查。
