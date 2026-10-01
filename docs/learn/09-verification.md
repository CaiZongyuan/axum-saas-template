# 09 验证公开 HTTP 行为并生成 SDK

起点：`jobs` 检查点的工单、附件和 JSON 导出已能通过真实 API 使用。本课把成功、拒绝与恢复变成可重复检查，再核对客户端合同来自当前模块。

## 测试直接组装真实模块

回到原模板仓库根目录，使用隔离依赖运行课程测试：

```bash
node scripts/test-backend.mjs --test tutorial_course
pnpm tutorial:check
pnpm tutorial:course:check
```

[完整课程检查](../../crates/app/tests/tutorial_course.rs)通过真实 Core Router + 工单 Router 驱动 HTTP，使用 PostgreSQL、Files 对象协议和受控 Worker。创建后读取的最小路径是：

<<< ../../crates/app/tests/tutorial_course.rs#crud-test

测试里的课程 SQL 安装在隔离库，不写自己的开发数据。`pnpm tutorial:check` 检查第一课静态模块。`pnpm tutorial:course:check` 在临时副本逐步升级四个检查点，验证真实迁移账本、两条 API 接入、HTTP/存储/任务行为与 Worker 编译；与实际 curl 跟做共同验证完整课程。

需要覆盖的结果包括：输入拒绝、他人资源不可见、同 key 重放/冲突、旧版本拒绝、审计失败回滚、附件完成前不可见、对象下载字节、任务产物与终态通知。Worker 的 `run_once` 返回 true 只表示执行过任务，要继续读取 Job 与业务结果。

## 从自己的副本生成工单合同

在课程副本根目录运行：

```bash
just generate
pnpm contracts:check
pnpm typecheck
```

[生成工具](../../scripts/generate-contracts.mjs)读取这个副本组装后的 OpenAPI，输出：

| 产物                                            | 需要检查                                                   |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `packages/contracts/openapi.json`               | 工单、上传与导出路径、DTO、公开错误                        |
| `packages/contracts/src/generated/types.gen.ts` | CreateTicket、UpdateTicket、Ticket 与相关请求类型          |
| `packages/sdk/src/generated/sdk.gen.ts`         | createTicket、readTicket、updateTicket、listTickets 等操作 |
| `packages/sdk/src/index.ts`                     | 稳定客户端配置，使用生成类型/方法                          |

Rust DTO/operationId 是协议来源。新增或删除字段后重新生成，让 drift 检查拒绝过期产物；不要在 SDK 写另一份 Ticket 接口。浏览器 Cookie 与 CSRF 的接线属于之后的客户端工作，本课程不实现前端页面。

## 一个合同失败检查

在自己的副本暂时修改 Ticket 的输出字段但不再生成，运行 `pnpm contracts:check`，应报告漂移。恢复代码或运行 `just generate` 后再通过。与此同时通过 curl 读取当前 JSON，确认生成内容和正在运行的 API 使用同一版二进制。

```bash
curl --fail "$BASE_URL/api/openapi.json"
curl --fail -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

## 记录证据并保留维护边界

完成当前课程检查后，在副本执行 `just check`，记录实际运行版本与结果。编译、HTTP、存储/任务和文档构建各证明不同责任；未运行的部署或客户端检查不能写成通过。

自己的模块、迁移、HTTP 检查、双语教程与课程工具要一起维护。删知识库参考业务不会删除这条独立课程；课程自有文件及共享引用记录在[课程所有权清单](../../examples/tutorial-tickets/ownership.json)。它未默认注册为产品模块，裁剪时同步维护共享引用，`example-remove` 管理的应用示例与教学 fixture 分别维护。

上一课：[后台执行与通知](08-jobs.md)。下一课：[部署自己的工单业务](10-production.md)。
