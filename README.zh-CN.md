# Dougong（斗拱）

**使用 Rust + Axum 开发自己的 SaaS 后端，再接入共享 Web 与 Desktop 客户端。**

斗拱是中国木构建筑中标准化、预制装配的承托构件——不同的屋顶架在同一套构件上。本模板借用这个意象：一套可复用的核心，加上可组装、可移除的参考应用。

[English](README.md) · 简体中文

[![CI](https://github.com/CaiZongyuan/axum-saas-template/actions/workflows/ci.yml/badge.svg)](https://github.com/CaiZongyuan/axum-saas-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

从已经接好的认证、权限、后台任务、文件存储和共享 Web/Desktop 界面开始。保留可复用的 SaaS Core，沿着参考应用学习完整业务流程，再替换成自己的业务。

[开发者文档](https://caizongyuan.github.io/axum-saas-template/docs/) · [快速开始](docs/getting-started/quickstart.md) · [项目结构](docs/architecture/project-structure.md) · [能力覆盖](docs/architecture/v1-coverage.md)

## 开发自己的业务

先读[项目结构](docs/architecture/project-structure.md)，再按[新增业务模块](docs/guides/develop-module.md)写自己的第一条接口。指南说明代码归属、路由/OpenAPI 组装与 HTTP 验证。模块拥有自己的数据和规则，通过公开接口复用 Core 的身份、成员、审计、幂等、文件与任务。

连续学习从[工单 SaaS 后端课程](docs/learn/index.md)开始：十课、四个可运行检查点，带同一个模块走过持久化、授权、事务、附件、Worker 导出、测试与恢复。

知识库用于查阅完整实现；后端合同完成后再接客户端。文档与教学源码一起维护中英文版本，规则见[作者指南](docs/guides/maintain-docs.md)。

## 为什么选择这个模板

- **核心能力已经串联。** 会话、成员、文件、任务、审计与通知在同一套应用和数据库中协作。
- **参考应用可以真正移除。** 所有权清单登记示例代码、路由、依赖与教程，CI 实际演练移除并验证 Core 继续可用。
- **多端共享 API 合同。** 从 Rust 生成 OpenAPI、TypeScript 合同与 SDK，Web 和 Electron 共享视图，并通过检查发现合同漂移。
- **性能有验证入口。** 确定性预算约束数据库工作量与载荷大小，可复现的负载场景产出延迟、吞吐与内存报告。
- **沿着实现学习。** 教程把用户操作、源码、公开接口、测试和部署步骤对应起来。

当前采用**每次部署服务一家企业（Organization）**的模式，支持企业内多成员与资源级授权，适合按客户企业独立部署的产品和内部工具。

## 已包含的能力

| 能力     | 已提供的行为                                                           |
| -------- | ---------------------------------------------------------------------- |
| 身份认证 | 邮箱密码注册、Cookie 会话、CSRF 防护、退出、密码重置与会话撤销         |
| 访问控制 | 企业角色、成员管理、资源授权，以及可限定范围和撤销的 API Key           |
| 可靠执行 | PostgreSQL 任务队列、租约、重试、尝试历史、幂等操作与通知              |
| 文件服务 | 通过 RustFS 提供私有 S3 兼容存储、上传下载流程与后台对象清理           |
| 运行维护 | 审计记录、请求 ID、结构化日志、追踪与指标、Redis 缓存和限流            |
| 客户端   | React Web 界面与 Electron 壳，共享视图、生成合同和 API SDK             |
| 部署     | 单机 Docker Compose、Caddy HTTPS、数据库迁移、备份与独立恢复演练       |
| 验证     | Rust HTTP/集成测试、界面测试、浏览器旅程、模块边界、合同检查与性能预算 |

技术栈：**Rust、Axum、Tokio、Tower、SQLx、PostgreSQL、Redis、RustFS、React、TypeScript、TanStack Router/Query、Tailwind CSS、shadcn/ui 与 Electron**。

## 快速开始

<!-- scaffold:creator:start -->

用 `create-axum-saas` 创建完成改名、端口与 Docker namespace 隔离的项目；`--no-examples` 生成只含 Core 的起点。首次 npm 发布前，运行 `pnpm scaffold:pack` 并通过 `npx` 使用本地 tarball。完整命令与多副本流程见[创建自己的项目](docs/getting-started/create-project.md)。

<!-- scaffold:creator:end -->

准备 Docker / Compose，以及仓库固定的工具链：**Rust 1.96.0、Node 24.18.0、pnpm 11.17.0、just 1.58.0**。版本记录在 [rust-toolchain.toml](rust-toolchain.toml)、[.node-version](.node-version) 和 [.tool-versions](.tool-versions)。

```bash
git clone https://github.com/CaiZongyuan/axum-saas-template.git
cd axum-saas-template
pnpm install --frozen-lockfile
just dev
```

在另一个终端先检查后端：

```bash
curl -i http://127.0.0.1:18000/health/ready
curl -i http://127.0.0.1:18000/api/v1/system/status
```

预期 HTTP 200，响应携带 `x-request-id`。打开 **[http://127.0.0.1:15400/register](http://127.0.0.1:15400/register)** 创建开发账号：首位成功注册者为 Owner，后续为 Member；密码长度 12–128 字符。

`just dev` 在 Docker 中启动 PostgreSQL、Redis、RustFS 与 Mailpit，执行迁移、初始化存储，然后在宿主机启动 API、Worker 和 Web。修改 Rust 源码会重启 API/Worker，Web 支持热更新。

开发默认值来自 [.env.example](.env.example)，需要调整时复制为不提交的 `.env`。

| 本地服务       | 地址                                    |
| -------------- | --------------------------------------- |
| Web 应用       | http://127.0.0.1:15400                  |
| API 就绪检查   | http://127.0.0.1:18000/health/ready     |
| OpenAPI Schema | http://127.0.0.1:18000/api/openapi.json |
| 开发邮件       | http://127.0.0.1:18025                  |

保持 `just dev` 运行，使用 `just desktop` 在 Electron 中打开同一应用。`Ctrl+C` 停止宿主机进程；`just services-down` 停止 Docker 服务并保留数据卷。

<!-- example:knowledge:readme:start -->

## 通过知识库示例学习

当前参考应用是支持个人库和共享库的知识库，展示业务模块如何使用 Core：

1. 注册账号，在个人库创建 Markdown 文档。
2. 编辑、预览、搜索和分页浏览文档，处理并发编辑冲突。
3. 授予共享库 Reader 或 Editor 权限，并验证撤权效果。
4. 上传附件、下载有权访问的文件、插入图片引用。
5. 申请 ZIP 导出，跟踪 Worker 任务并接收通知。
6. 查询审计记录，删除内容后由后台任务清理对象。

可以从[第一篇文档](docs/tutorials/04-personal-documents.md)、[资源权限](docs/tutorials/07-library-grants.md)或[导出与任务](docs/tutorials/10-document-exports.md)开始跟做。

<!-- example:knowledge:readme:end -->

## 换成自己的业务

Core 持有可复用的 SaaS 能力；参考应用持有业务模型、视图、路由和教学资源。依赖约束见[模块边界](docs/architecture/module-boundaries.md)。

先预览示例移除计划：

```bash
just example-remove --dry-run
```

[替换示例教程](docs/tutorials/23-example-removal.md)说明如何移除示例并接入自己的模块。实际移除要求 Git 工作副本干净，默认保留迁移历史，不操作数据库、对象存储或密钥。

## 性能与验证

性能合同覆盖数据库往返次数、写入行数、响应大小和前端包体，随日常检查运行。负载结果单独留档，用于夜跑和版本发布分析。

<!-- example:knowledge:performance:start -->

```bash
just perf-ci            # 包体预算与查询计划报告
just perf-load          # 稳态混合负载
just perf-saturation    # 逐级增加并发
just perf-trajectory    # 完整用户旅程
just perf-soak          # 持续负载与资源采样
```

负载命令需要安装 [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)，使用 release 构建启动独立的一次性环境。当前场景以知识库示例为载体。报告包含数据规模、吞吐、P50/P95/P99、业务错误、预期限流、队列深度、数据库连接采样，以及 API/Worker 的 RSS。

命令、测试条件与初始测量见[性能预算](docs/tutorials/24-perf-gates.md)和[负载报告](docs/tutorials/25-load-reports.md)。评估部署容量时，应结合每份结果对应的负载与机器配置。

<!-- example:knowledge:performance:end -->

```bash
just check              # 主检查、测试、构建与文档验证
just test-backend       # 使用隔离服务的后端测试
just test-frontend      # Vitest 与 Testing Library
just e2e                # 真实 API 与 Chromium 用户旅程
just check-full         # 主检查加浏览器 E2E
```

首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。测试基础设施使用隔离资源，详见[测试指南](docs/testing/t01-feedback-loop.md)。

## 项目结构

```text
apps/          API、Worker、Web、Desktop 与文档入口
crates/        应用模块与共享平台基础设施
packages/      合同、SDK、客户端 Core、UI 与共享视图
migrations/    PostgreSQL 迁移历史
examples/      参考应用所有权清单
scripts/       开发、验证、性能与部署工具
docs/          教程、架构、决策与运维指南
```

## 文档与部署

[在线教程](https://caizongyuan.github.io/axum-saas-template/)目前以中文提供，每页均链接对应的源码版本。运行 `just docs` 后，可在 http://127.0.0.1:5174/axum-saas-template/ 访问本地站点。

- [跟随一条请求走完整个技术栈](docs/tutorials/01-full-stack-request.md)
- [单机部署](docs/tutorials/21-single-machine-production.md)
- [备份与恢复](docs/tutorials/22-backup-restore.md)
- [查看已实现能力](docs/architecture/v1-coverage.md)

新增功能时同步更新行为、测试和教程。使用 `just generate` 重新生成 API 合同，`pnpm contracts:check` 检查漂移，`just docs-build` 验证文档构建。

## 许可证

[MIT](LICENSE) — Copyright (c) 2026 Dougong contributors.
