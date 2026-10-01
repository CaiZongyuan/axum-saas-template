# 04 复用 Session 并实现工单资源授权

起点：`crud` 检查点与第二课保存的 Session。本课保持同一模块，为“谁能访问这张工单”验证一个完整拒绝路径。角色来自 Organization，工单策略属于自己的业务。

## 身份、成员与资源分三步判断

`crates/app/src/modules/tickets/mod.rs` 的 Handler 使用 `identity::require_session`。写请求传 `mutation = true`，检查 Cookie、可信 Origin 和 CSRF；当前身份不能从请求 body 的 user_id 接受：

<<< ../../examples/tutorial-tickets/mod.rs#create-handler

`application.rs` 在调用者事务中使用 `organization::active_role_in`，持有成员 FOR SHARE 锁，再锁工单并检查自己的策略：

<<< ../../examples/tutorial-tickets/application.rs#authorization

课程策略：创建者和当前 Owner/Admin 可读写；其他有效成员读取目标得到 404，避免泄露资源是否存在。列表应用同样的过滤，不能先返回全部再让客户端隐藏。企业内的两个工单集合仍属于同一 Organization。

## 从另一个身份证明拒绝

在课程副本的请求终端，保留原来的 cookies / `TICKET_ID`，为第二个 Member 建立独立 Cookie 文件：

```bash
curl --fail-with-body -sS -c .scratch/course-http/other-cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"email":"ticket-other@example.test","password":"course-test-password"}' \
  "$BASE_URL/api/v1/auth/register" > .scratch/course-http/other-session.json
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

第二个成员得到 404/`tickets.not_found`，原创建者得到 200，内容未改变。已有第二个账号时改用 `/api/v1/auth/login`。再不带 Cookie 请求相同地址，应得到 401。

## 写入时的失败边界

原 Session 写请求仍需 Origin 和 `X-CSRF-Token`。有 Cookie 但缺少 CSRF 的更新返回 403，不能因调用来自自己的命令行而跳过：

```bash
curl -i -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"title":"Rejected change","description":"No CSRF","status":"open","version":1}' \
  -X PUT "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

随后 GET 确认标题与版本未变。退出、过期或停用后 Session 失效；晚到的请求、幂等重放和后续文件发布也要重新授权。Core 的 `active_role` 无事务锁，不能替代关键写入中的 `active_role_in`。

完整身份合同见[认证与 Session 指南](../tutorials/03-sessions.md)，成员合同见[企业成员指南](../tutorials/08-members.md)。本课程不新增 API Key 写入协议。

上一课：[协议与校验](03-protocol.md)。下一课：[把业务与审计放入同一事务](05-transactions.md)。
