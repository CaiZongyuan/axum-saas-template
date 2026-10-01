# 快速开始：后端开发环境

启动模板的 API 与依赖，确认 HTTP、PostgreSQL 和迁移正常，再进入自己的业务开发。

## 1. 准备工具与副本

使用仓库固定版本：Rust 1.96.0、Node 24.18.0、pnpm 11.17.0、just 1.58.0，以及能够运行 Linux 容器的 Docker / Compose。版本来源是 `rust-toolchain.toml`、`.node-version`、`package.json` 与 `.tool-versions`。

```bash
git clone https://github.com/CaiZongyuan/axum-saas-template.git
cd axum-saas-template
pnpm install --frozen-lockfile
just dev
```

从仓库根目录执行。首次运行需要下载依赖和编译 Rust；开发脚本启动 PostgreSQL、Redis、RustFS、Mailpit，显式执行迁移并初始化存储，然后启动 API、Worker 与 Web。

没有 `.env` 时使用 `.env.example` 的开发默认值。需要覆盖端口或服务设置时建立本地 `.env`；所有配置来源见[配置参考](site:reference/config.md)。

## 2. 发出第一条真实请求

保持开发入口运行，在另一个终端执行：

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:3000/api/v1/system/status
```

预期均返回 HTTP 200，每个响应带有 `x-request-id`。status 返回 `status: "ok"`、`database: "connected"` 和实际 `schema_version`；版本随源码迁移改变。

live 证明进程运行；ready 核对依赖与完整迁移集合。API 启动不会自动修改数据库结构。

## 3. 观察依赖失败与恢复

只在自己的开发环境操作。另一个终端停止 PostgreSQL：

```bash
just db-down
curl -i http://127.0.0.1:3000/health/ready
```

ready 返回 503，live 仍返回 200。恢复数据库后重新请求：

```bash
docker compose up -d --wait postgres
curl -i http://127.0.0.1:3000/health/ready
```

ready 应恢复 200。若连接成功但迁移历史不匹配，运行 `just migrate` 并确认源码与数据库版本一致。

## 4. 准备认证请求

默认 Web 为 `http://127.0.0.1:5173`，可以在 `/register` 创建开发账号。首个成功注册者为 Owner，后续为 Member；密码长度 12–128 字符。

自己的受保护 HTTP 接口复用当前 Session、可信 Origin 和 CSRF。接入方式见[认证与会话](../tutorials/03-sessions.md)，邮件恢复可通过 [Mailpit](http://127.0.0.1:8025)查看。

<!-- example:knowledge:quickstart:start -->

已有知识库示例展示[业务写入](../tutorials/04-personal-documents.md)、[资源授权](../tutorials/07-library-grants.md)和[后台导出](../tutorials/10-document-exports.md)，供自己实现业务时查阅。

<!-- example:knowledge:quickstart:end -->

## 5. 进入开发循环

```bash
just generate
pnpm contracts:check
pnpm boundaries:check
```

Rust DTO 定义合同，SDK 与类型从 OpenAPI 生成。自己的模块、迁移、路由和测试应同步增加。先阅读[项目结构](../architecture/project-structure.md)，再完成[新增业务模块](../guides/develop-module.md)。

Rust `.rs` / `.toml` 变更会重启 API 与 Worker。新增 SQL 迁移后显式执行 `just migrate`，并重启开发入口使编译进二进制的迁移集合刷新。Web 使用 HMR。

## 停止与排错

`Ctrl+C` 停止宿主机 API/Worker/Web；`just services-down` 停止依赖并保留数据卷。

| 症状                | 检查与恢复                                                        |
| ------------------- | ----------------------------------------------------------------- |
| Docker 服务未就绪   | 确认 Docker daemon、镜像与端口，再启动开发入口                    |
| ready 返回 503      | 检查 PostgreSQL、显式迁移和当前源码 checksum                      |
| API 或 Web 端口占用 | 同步修改 APP_BIND / VITE_API_PROXY；Web 端口改变时更新 APP_ORIGIN |
| 数据库端口改变      | 同时更新 POSTGRES_PORT 与 DATABASE_URL                            |
| 请求失败            | 按 request_id 查 API JSON 日志，并核对公开错误                    |

本地文档通过 `just docs` 启动，默认地址为 `http://127.0.0.1:5174/axum-saas-template/docs/`。页脚的源码版本表示构建来源；需要复现某个版本时检出该提交再执行步骤。
