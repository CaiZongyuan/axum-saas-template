# 新增业务模块

为自己的工单 SaaS 新增 `tickets` 模块，提供一条 HTTP 接口，并把它接到框架的请求上下文和 OpenAPI 中。

前提：完成[快速开始](../getting-started/quickstart.md)，在自己的开发副本修改源码。本章接口返回静态开发数据；后续章节加入持久化、认证和业务规则。

## 1. 创建完整模块

新增 `crates/app/src/modules/tickets/mod.rs`，写入以下内容。它公开 Router 与 OpenAPI，内部处理器和 DTO 保持模块私有。

<<< ../../examples/tutorial-tickets/preview.rs

这份源码也被[公开 HTTP 检查](../../apps/api/tests/tutorial_module.rs)直接编译。`pnpm tutorial:check` 在临时源码副本中应用下列声明、路由与 OpenAPI 步骤，并从两种应用入口验证结果；检查不会修改当前工作副本或访问已有数据库。示例的响应类型与 HTTP 声明来自同一份 Rust 定义。

## 2. 声明模块与表归属

在 `crates/app/src/modules/mod.rs` 的知识库标记区块之外追加：

```rust
pub mod tickets;
```

创建 `crates/app/src/modules/tickets/module.json`：

```json
{ "kind": "business", "tables": [] }
```

目前没有数据库表。加入迁移时同步填入自己的表名，边界检查据此判断各模块可以读写哪些表。

## 3. 合并应用路由

在 `apps/api/src/lib.rs` 中接入自己的 Router。当前默认进程调用 `configured_router`；测试和其他调用者还会使用 `router_with_cache`。

在 `router_with_cache` 中，知识库标记区块结束之后、调用 Core 组装器之前追加：

```rust
let domain_routes = domain_routes.merge(saas_app::modules::tickets::router());
```

在 `configured_router` 中，对应位置追加：

```rust
let routes = routes.merge(saas_app::modules::tickets::router());
```

公开业务路由由应用入口组合；Core 的 `compose_routes_with_options` 接收组合结果，不需要认识工单类型。

## 4. 合并 OpenAPI

在同一文件的 `openapi()` 中，调用 `rate_limit::describe(document)` 前追加：

```rust
let mut document = document;
document.merge(saas_app::modules::tickets::openapi());
```

在知识库标记区块之外登记新业务，移除知识库时自己的接入不会一起删除。`previewTicket` 是本操作的稳定 operationId，之后生成 SDK 会使用它。

## 5. 编译并请求

从仓库根目录运行：

```bash
cargo check --locked -p saas-api
pnpm boundaries:check
curl -i http://127.0.0.1:18000/api/v1/tickets/preview
```

`just dev` 在 Rust 文件变更后重启 API。预期得到 HTTP 200 和 `x-request-id`，正文为：

```json
{ "title": "First ticket", "status": "open" }
```

请求 `/api/openapi.json`，检查 `previewTicket` 和 `TicketPreview`。再生成客户端合同：

```bash
just generate
pnpm contracts:check
```

## 6. 改一个条件

把 `First ticket` 改为自己的文本，再请求同一接口。然后暂时撤去应用入口的 Router 合并：请求会返回框架的 404 错误；恢复合并后再次得到 JSON。由此区分“Rust 模块存在”和“能力已在应用注册”。

静态接口只用于这个开发阶段。自己的创建、查询和修改应在后续用例中接入当前身份、数据模型、授权与事务。

## 下一步

阅读[Core 与业务边界](../architecture/module-boundaries.md)，再从[第一条请求](../tutorials/01-full-stack-request.md)查阅 DTO、统一错误、生成 SDK 与测试的完整接线。连续工单路径将沿用本模块继续增加能力。
