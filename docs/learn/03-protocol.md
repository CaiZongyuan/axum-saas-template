# 03 定义输入输出与校验边界

起点：`crud` 检查点已创建并读回工单。本课不替换检查点，继续使用同一份 `tickets` 模块，把 HTTP 数据形状与业务规则分开。

## 找到本次协议实现

副本的 `crates/app/src/modules/tickets/mod.rs` 定义 CreateTicket、UpdateTicket、TicketQuery 和 Ticket。对应源片段：

<<< ../../examples/tutorial-tickets/mod.rs#ticket-protocol

CreateTicket 接受 title/description；UpdateTicket 另含 status/version。请求 DTO 拒绝未知字段，响应包含字符串 id、创建者、状态、版本和时间戳。查询 `limit` 为 1–100，默认 50。

`BoundedJson` 负责 JSON 解码、公开错误和读取期限，业务 Router 的 body limit 为 16 KiB；它不替代业务字段规则。纯规则由 `domain.rs` 提供：

<<< ../../examples/tutorial-tickets/domain.rs#content

标题先 trim，再要求 1–200 个字符；description 最多 8192 字节，两者不能包含 NUL。字符数与 UTF-8 字节数不同，数据库约束也使用相同口径。

## 发出一个无效请求

沿用第二课的 Session 与 CSRF，在副本根目录请求：

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: invalid-title" -H "Content-Type: application/json" \
  --data '{"title":"   ","description":"Not a valid title"}' \
  "$BASE_URL/api/v1/tickets"
```

预期 400，错误 code 为 `tickets.invalid_input`，带 request_id。输入在事务前拒绝，不创建工单、审计或幂等结果。改为有效 title 和新 key 后，仍应得到正常 201；后续 GET 读取新结果。

把请求额外加上 `"unexpected": true`，预期被 DTO 解码拒绝；它属于协议错误，不会走到领域校验。对超过 body limit、无效查询和错误路径参数也使用框架统一错误，不把原始解析错误或数据库细节暴露给客户端。

## 让协议只有一个来源

```bash
just generate
pnpm contracts:check
```

在副本执行，CreateTicket/Ticket 的 OpenAPI schema 与生成类型应一致。DTO 或 operationId 改变时重新生成，不手工改 `packages/contracts` 的派生类型。

完整处理流程见 [mod.rs](../../examples/tutorial-tickets/mod.rs)，校验在 [domain.rs](../../examples/tutorial-tickets/domain.rs)。更改字段限制时同步 Domain、数据库约束、OpenAPI 和行为检查。

上一课：[迁移与第一次写入](02-migrations.md)。下一课：[身份与工单资源授权](04-authorization.md)。
