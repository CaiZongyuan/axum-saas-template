# Axum SaaS Template

Rust/Axum + React 的模块化全栈模板，以可移除的知识库 example 作为可运行教程。

**当前实现：全栈状态链路与邮箱密码注册。** 打开 `/register` 创建账号并自动登录，首个成功注册者成为 Owner，其余为 Member。登录/退出、Markdown 业务和附件按后续实施票继续交付。

[在线教程](https://caizongyuan.github.io/axum-saas-template/) · [实施计划](docs/plans/template-v1.md) · [架构规范](docs/saas-template-architecture-spec.md)

## 启动

准备 Docker/Compose、Rust 1.96.0、Node 24.18.0、pnpm 11.17.0、just 1.58.0。

```bash
pnpm install --frozen-lockfile
just dev
```

访问 http://127.0.0.1:5173/。PostgreSQL 运行在 Docker 中，API/Web 在宿主机运行，支持 API 源码重启与 Web HMR。缺少 `.env` 时使用 `.env.example` 的本地默认值；自定义配置放入不提交的 `.env`。

`Ctrl+C` 停止 API/Web，保留数据库数据；`just db-down` 停止开发数据库。

## 验证

```bash
just check
```

`just test-backend` 使用独立 PostgreSQL 容器，`just test-frontend` 使用 Vitest/Testing Library，`just e2e` 运行真实 API 与 Chromium。测试不会清空开发数据库。

日常运行 `just check`；关键旅程完成后运行 `just e2e`（首次需 `pnpm exec playwright install chromium`），里程碑完整验证用 `just check-full`。

## 文档与合同

```bash
just docs
just docs-build
just generate
pnpm contracts:check
```

本地文档：http://127.0.0.1:5174/axum-saas-template/。仓库 Markdown 是唯一可编辑来源，VitePress 投影不提交。OpenAPI、TS contracts 和 SDK 从 Rust 生成并检查漂移。

新增能力时同步更新源码、测试和教程。参见 [Core/示例边界](docs/architecture/module-boundaries.md)与 [T01 教程](docs/tutorials/01-full-stack-request.md)。
