# 项目结构

自己的业务放在 Rust Application 模块中，通过 API 和 Worker 入口接入。先找到这些位置，再开始写第一条接口。

## 后端目录地图

```text
apps/
  api/src/main.rs        HTTP 进程：配置、连接池、启动与停止
  api/src/lib.rs         API 组装：Router、OpenAPI、模块选项
  worker/src/main.rs     后台进程：Handler、维护任务与健康检查
crates/
  app/src/http.rs        RequestId、公开错误、输入提取器
  app/src/modules/      SaaS Core 与具体业务模块
  platform/src/         数据库、存储、邮件、Redis 与观测适配
migrations/             显式执行的 SQL 迁移
apps/api/tests/         组合应用的公开 HTTP 行为
crates/app/tests/       Core 的公开能力与纯业务规则
examples/               可替换业务的所有权与教学源码
packages/contracts/     Rust OpenAPI 生成的协议
packages/sdk/           生成客户端与少量 transport 配置
```

完整客户端、部署和文档布局见 [README](../../README.zh-CN.md)。这里聚焦开发后端会修改的位置。

## 一个新功能放在哪里

| 目标         | 位置                                   | 负责的内容                             |
| ------------ | -------------------------------------- | -------------------------------------- |
| 新增工单业务 | `crates/app/src/modules/tickets/`      | 实体、业务规则、用例、HTTP 与公开接口  |
| 声明模块     | `crates/app/src/modules/mod.rs`        | Rust 模块入口                          |
| 增加表       | `migrations/` 与模块 `module.json`     | SQL 迁移与表所有权                     |
| 接入 API     | `apps/api/src/lib.rs`                  | 合并业务 Router、OpenAPI 与可用 scopes |
| 增加耗时处理 | `apps/worker/src/main.rs`              | 注册业务 Handler 与维护任务            |
| 验证公开行为 | `apps/api/tests/`                      | 请求、响应、权限、持久化与失败结果     |
| 连接客户端   | `packages/contracts/`、`packages/sdk/` | 由 Rust 合同生成协议与方法             |

`tickets` 是学习者将新增的业务。默认模板已经注册知识库；新增业务可以与它共用 SaaS Core。

## 请求经过哪些职责

```text
HTTP 请求
  → 应用组装的 Router
  → 模块 HTTP 边界：DTO、提取器、错误映射
  → Application：授权、事务、公共能力协作
  → Domain 规则与 SQLx 查询
  → PostgreSQL / Platform 适配器
```

[Core 组装器](../../crates/app/src/lib.rs)接收额外 Router 和组合 OpenAPI。[API 入口](../../apps/api/src/lib.rs)决定实际注册的业务。Core 与 Platform 不 import 具体业务。

小模块可以先在 `mod.rs` 内完成一个用例。规则与编排变复杂时，再像现有参考业务一样拆出 `domain.rs` 和 `application.rs`：Domain 保持纯规则，Application 持有事务，HTTP 边界负责协议。

## 框架能力和业务的归属

SaaS Core 提供身份、成员、会话、审计、幂等、任务、文件、通知、邮件和通用 HTTP 能力。你的模块定义自己的资源与规则，并在自己的事务中调用公开接口。

例如审计的 `append` 接收调用者的连接，业务写入和审计一起提交。对象上传和邮件投递是数据库之外的 I/O，需要明确的发布、任务与失败恢复流程。

```bash
pnpm boundaries:check
```

这项检查验证包依赖、模块表归属、纯 Domain 的基础设施导入和示例清单；真实 HTTP 测试补充权限与事务行为。进一步说明见 [Core 与业务边界](module-boundaries.md)。

## 下一步

按[新增业务模块](../guides/develop-module.md)创建一个完整 Rust 文件，注册 Router 与 OpenAPI，然后用 HTTP 请求验证结果。
