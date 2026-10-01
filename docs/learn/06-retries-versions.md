# 06 保护重试与并发更新

起点：同一份 CRUD 模块、第一张工单和创建 Session。幂等处理“请求是否已经执行”，预期版本处理“我修改的仍是读到的那一版”；两者是不同责任。

## 创建重放使用公共幂等接口

副本 `application.rs` 在成员授权后，对规范化标题和描述建立指纹，用 actor、端点 scope 和 Idempotency-Key 认领：

<<< ../../examples/tutorial-tickets/application.rs#idempotent-create

新请求在同一事务中完成业务、审计和 complete。重放记录只保存 ticket_id，再重新授权读取当前资源；记录不是可绕过撤权的响应缓存。key 为 1–128 个可见 ASCII 字节，默认 Core 保留期限为 24 小时。

沿用第二课的同一个输入和 key 请求：

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: first-ticket" -H "Content-Type: application/json" \
  --data '{"title":"First ticket","description":"Investigate a request"}' \
  "$BASE_URL/api/v1/tickets"
```

预期仍为 201，id 与 `TICKET_ID` 一致，不新增工单或创建审计。同 key 改为 `"title":"Different input"` 时返回 409/`tickets.key_conflict`；明确的新操作要使用新 key。

## 更新由业务自己的版本条件保护

完整更新使用 SQL 条件 `WHERE id = ... AND version = expected`，成功后 version 增加 1。当前源码：

<<< ../../examples/tutorial-tickets/application.rs#version-update

工单写锁与有效成员锁固定授权依据，版本条件拒绝旧草稿。Core Idempotency 没有自动替你实现业务乐观并发。

以下从第二课创建的 version 1 开始；已执行过更新时，先 GET 取得当前版本并代入第一次请求，第二次仍保留同一个旧版本。

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"title":"Investigating","description":"The request is assigned","status":"closed","version":1}' \
  -X PUT "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

第一次返回 200、version 2。重复同一个 version 1 的更新返回 409/`tickets.version_conflict`。随后 GET 应保留第一次成功的字段和 version 2；请求超时后先读取当前结果，不能把版本盲目增加再覆盖。

## 验证并发和零重复副作用

在原模板根目录执行：

```bash
node scripts/test-backend.mjs --test tutorial_course creation_replays_one_result_and_rejects_changed_input
node scripts/test-backend.mjs --test tutorial_course two_updates_of_one_version_have_one_winner
```

[课程 HTTP 检查](../../crates/app/tests/tutorial_course.rs)分别验证重放/输入冲突和两个同时更新的 `[200, 409]` 结果，最后读回成功者。不能用单次顺序请求代替竞态检查，也不能让前端自行决定哪个写入有效。

上一课：[事务与审计](05-transactions.md)。下一课：[让工单使用 Files](07-files.md)。
