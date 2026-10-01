# 05 让业务与审计共同提交

起点：同一份受保护 CRUD 模块。本课把“创建成功”定义成工单和审计共同持久化，而不是先插入工单再另发一条审计请求。

## 事务由用例拥有

副本 `crates/app/src/modules/tickets/application.rs` 的 create 用例在一个 PostgreSQL 事务中完成成员检查、幂等认领、业务插入、审计、重放记录与提交。聚焦写入边界：

<<< ../../examples/tutorial-tickets/application.rs#create-transaction

`audit::append` 接受调用者的 PgConnection，返回错误时 `?` 退出，未提交事务回滚。它不接受任意请求 JSON metadata；事件只有当前 actor、稳定 action/resource、RequestId 或 Job 来源和可选受影响用户。

不要让 Handler 在事务外补发审计，也不要从工单模块直接写 `saas_core.audit_events`。自己的资源和跨模块副作用需要同一个提交决定。

## 从公开结果观察审计

在课程副本请求终端使用第二课创建的 Owner Session：

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/audit-events"
```

工单读回 200；审计列表应包含 action 为 `tickets.create`、resource_type 为 `tickets.ticket`、resource_id 为 `TICKET_ID` 的事件。来源 request_id 与创建响应的关联 id 可以串到日志。列表结构以生成 [HTTP 参考](site:reference/api.md)为准，不假定数组包装相同。

当前课程的首个账号为 Owner，可以读取 Core 审计；普通成员不能把审计列表当成自己的跨资源数据入口。

## 证明审计失败会回滚业务

回到原模板仓库根目录，执行定向公开 HTTP 检查：

```bash
node scripts/test-backend.mjs --test tutorial_course a_failed_audit_rolls_back_ticket_and_request_replay
```

[课程测试](../../crates/app/tests/tutorial_course.rs)只在隔离 PostgreSQL 中让 `tickets.create` 审计写入失败：创建返回 503，工单列表为空；解除失败后使用同一个 key 重试，创建成功且只有一个结果。这同时证明失败事务没有留下无法完成的幂等占位。

不要在自己的开发或生产数据库安装故障 trigger。测试观察的是 HTTP 503、公开列表和恢复后的结果，不以“调用了 append 一次”证明事务。

需要给其他操作添加副作用时，照同一边界把 Job、通知意图或 Files 发布登记纳入自己的事务；网络 I/O 本身不能靠 PostgreSQL 回滚。

上一课：[资源授权](04-authorization.md)。下一课：[保护重试与并发更新](06-retries-versions.md)。
