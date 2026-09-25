# 快速开始

当前版本完成了 T01：**Web → 生成 SDK → Axum → 真实 PostgreSQL**，以及与源码同步的在线教程。注册、Markdown 业务与附件属于后续实施票；当前页面会真实显示服务连接状态。

## 准备工具

使用仓库固定的 Rust 1.96.0、Node 24.18.0、pnpm 11.17.0、just 1.58.0，以及能运行 Linux 容器的 Docker / Compose。版本记录在 `rust-toolchain.toml`、`.node-version`、`package.json` 和 `.tool-versions`。

先取得本页对应的源码版本，在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
just dev
```

`just dev` 启动 Docker 中的 PostgreSQL，显式运行迁移，再启动宿主机 API 与 Web。Web 支持 HMR；修改 Rust 源码会重新启动 API。没有 `.env` 时使用 `.env.example` 中的本地开发设置，需要调整时先复制为 `.env`。

打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。正常情况下会看到“服务已就绪”“PostgreSQL 已连接”和迁移版本 `1`。

API 默认监听 `127.0.0.1:3000`：

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:3000/api/v1/system/status
```

每个响应都有 `x-request-id`。状态请求实际读取 PostgreSQL 的迁移记录，不是写死的前端展示数据。

## 观察一个失败场景

保持 `just dev` 运行，在另一个终端暂时停止开发数据库：

```bash
just db-down
```

再次点击页面的“重新检查”。页面显示失败提示和请求编号；`/health/ready` 返回 `503`，`/health/live` 仍返回 `200`。

恢复数据库后重新检查即可：

```bash
docker compose up -d --wait postgres
```

`Ctrl+C` 停止开发 API/Web，数据库与数据卷保留。`just db-down` 只停止数据库，不删除数据。

## 文档与下一步

```bash
just docs
```

本地文档入口为 [http://127.0.0.1:5174/axum-saas-template/](http://127.0.0.1:5174/axum-saas-template/)。在线站点和本地站点使用同一组 Markdown 源文件。

复制模板后，按[发布教程站点](publish-docs.md)启用自己的 GitHub Pages；后续合并到 `main` 时由 CI 检查并发布。

继续阅读[第一条全栈请求](../tutorials/01-full-stack-request.md)、[测试反馈循环](../testing/t01-feedback-loop.md)以及 [Core/示例边界](../architecture/module-boundaries.md)。完整后续范围记录在[架构规范](../saas-template-architecture-spec.md)。

## 常见问题

- **数据库能连接但 ready 仍失败**：运行 `just migrate`；API 进程本身不自动迁移。
- **端口已占用**：修改 `.env` 中的 `APP_BIND` / `VITE_API_PROXY`；更改数据库端口时同时调整 `POSTGRES_PORT` 与 `DATABASE_URL`，然后重启开发入口。
- **Rust 配置报错**：检查[生成的配置参考](site:reference/config.md)。错误不会打印数据库凭据。
- **浏览器请求失败**：用 request_id 对照 API 的 JSON 日志；页面通过 Vite 同源代理访问 API，数据库 URL 不进入浏览器。
