# 01 新增工单模块与 HTTP 接口

起点：原模板已经可以启动，尚未注册工单业务。本课把一个完整 `tickets` 模块接入真实 Core Router 和 OpenAPI，返回静态 JSON。持久化与认证从下一检查点加入。

## 安装完整模块检查点

在原模板仓库根目录运行：

```bash
export TEMPLATE_ROOT="$PWD"
export COURSE_ROOT="$TEMPLATE_ROOT/.scratch/ticket-saas"
node scripts/tutorial-course.mjs --stage module --root "$COURSE_ROOT"
cd "$COURSE_ROOT"
pnpm install --frozen-lockfile
just dev
```

工具生成的副本使用独立 Compose 项目、卷和动态端口，不复用原开发数据。另开终端，在副本根目录加载公开地址并请求：

```bash
source .course.env
curl -i "$BASE_URL/api/v1/tickets/preview"
```

预期 HTTP 200、`x-request-id`，正文：

```json
{ "title": "First ticket", "status": "open" }
```

后文 HTTP 命令沿用这个终端的 `BASE_URL` / `ORIGIN`；新终端重新执行 `source .course.env`。这个文件只有公开请求地址，数据库与存储配置位于副本私有 `.env`。不要把原模板的 DATABASE_URL 或服务端口覆盖进课程环境。

## 代码如何进入应用

完整阶段代码来自 [preview.rs](../../examples/tutorial-tickets/preview.rs)，复制为副本的 `crates/app/src/modules/tickets/mod.rs`。最小处理器与合同是：

<<< ../../examples/tutorial-tickets/preview.rs#preview

工具同时修改四个接入位置：

| 文件                                         | 改动                                    |
| -------------------------------------------- | --------------------------------------- |
| `crates/app/src/modules/mod.rs`              | 声明 `tickets` 模块                     |
| `crates/app/src/modules/tickets/module.json` | 登记业务类型，当前没有表                |
| `apps/api/src/lib.rs`                        | 在普通与配置 Router 路径合并业务 Router |
| 同一 API 组装文件的 `openapi()`              | 合并业务 OpenAPI                        |

Core 的 `compose_routes_with_options` 接收组装结果，不需要 import Ticket。模块存在、路由注册和 OpenAPI 注册是三个不同条件。

## 验证与失败检查

在副本根目录另开终端：

```bash
cargo check --locked -p saas-api
pnpm boundaries:check
curl --fail "$BASE_URL/api/openapi.json"
```

OpenAPI 中应出现 `previewTicket` 和 `TicketPreview`。在副本暂时撤去业务 Router 合并，请求会变成统一 404；恢复后回到 200。不要只从编译成功判断 HTTP 已接入。

第一课的静态接口没有写入数据库，也不提供产品访问策略。完整模块接入说明见[新增业务模块](../guides/develop-module.md)。

上一页：[课程总览](index.md)。下一课：[加入自己的 schema 与迁移](02-migrations.md)。
