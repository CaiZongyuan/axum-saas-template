# 跟做：第一条全栈请求

目标是理解一条真实请求经过哪些公开接口，以及如何验证它。先按[快速开始](../getting-started/quickstart.md)运行当前版本，不需要手动重写已经存在的同名模块。

## 1. 从迁移开始

[Core 的第一条迁移](../../migrations/0001_core.sql)建立命名空间；SQLx 记录迁移版本。`just migrate` 是显式步骤，API 启动不会修改数据库结构。

```bash
just migrate
```

如果启动一个未迁移的空数据库，readiness 必须是 `503`。这说明“进程在运行”和“可以接业务请求”是两件事。

## 2. API 入口只组装能力

[API 入口](../../apps/api/src/main.rs)读取经过校验的配置、创建连接池、初始化 tracing，然后组装 Core Router。后续 Reference Domain 的注册点也在入口层，Core 不反向依赖它。

<<< ../../apps/api/src/main.rs

[系统模块](../../crates/app/src/modules/system/mod.rs)读取真实迁移状态并返回状态 DTO。[HTTP 公共处理](../../crates/app/src/http.rs)添加 request_id 与统一错误结构。

等待必须有结束条件：状态查询最多等待 2 秒，包含连接池取连接的时间；迁移默认最多等待 30 秒，可用 `MIGRATION_TIMEOUT_SECS` 调整。停止 API 时，现有 HTTP 请求最多有 3 秒完成，随后最多用 1 秒关闭连接池，避免退出无限等待。

## 3. 从 Rust 生成合同和 SDK

OpenAPI 路径、响应类型和错误类型直接来自 Rust。运行：

```bash
just generate
pnpm contracts:check
```

生成器把 DTO 放进 contracts，把客户端放进 SDK；SDK 的类型桥接回 contracts，不手写第二份 DTO。

<<< ../../packages/sdk/src/index.ts

SDK 默认在 5 秒后中止无响应的请求，并保留调用者主动取消请求的能力。后端返回的错误带有 request_id；网络超时可能没有服务端响应，因此页面不能凭空生成一个服务端请求编号。

也可以打开运行中 API 的 `/api/openapi.json`，或查看本站[生成的 API 参考](site:reference/api.md)。

## 4. Web 只接入公开 SDK

[浏览器入口](../../apps/web/src/main.tsx)创建 QueryClient、同源 API Client 与 Router。[共享状态 View](../../packages/views/src/system/status-view.tsx)用 TanStack Query 请求生成 SDK，呈现 loading、success 和 error。

前端不保存 PostgreSQL 配置，不自己拼装 DTO，也不把同一份服务器资源复制进另一套状态容器。后续 Electron 可以复用这个 View。

## 5. 用相同入口验证

```bash
just test-backend
just test-frontend
just e2e
```

后端测试使用真实数据库与 Router；View 测试只在 HTTP 边界使用 MSW；E2E 启动独立数据库、真实 API 和浏览器，还会暂停数据库观察失败与恢复。

具体测试位置与观察点见[测试说明](../testing/t01-feedback-loop.md)。

## 换成自己的业务时改哪里

把系统状态查询换成自己的公开用例：定义模型/迁移，注册用例与 HTTP/OpenAPI，再生成 SDK 和接入 View。连接池、错误、request_id、开发入口和检查流程可以复用；自己的实体与规则留在自己的模块里。

此处演示的是当前源码的接线方式。后续知识库 example 会按同一条链路加入注册、文档、附件和后台任务，每项都有对应教程。
