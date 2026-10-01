# 02 持久化工单与显式迁移

起点：第一课的静态模块。本课升级到 `crud` 完整检查点，拥有自己的 schema、迁移、DTO、权限与事务；后面四课继续解释同一份实现。本课先证明数据真的写入并能读回。

## 更新副本并执行迁移

停止副本的 `just dev`，回到原模板仓库根目录运行：

```bash
node scripts/tutorial-course.mjs --stage crud --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

开发入口先运行显式迁移再启动 API/Worker。已有依赖运行时也可在副本执行 `just migrate`，随后重启开发入口，让嵌入二进制的迁移集合一致。

工具把 [课程迁移](../../examples/tutorial-tickets/migrations/0001_tickets.sql)登记到副本 `migrations/` 的下一个可用版本，并把 `mod.rs`、`application.rs`、`domain.rs` 安装到 `crates/app/src/modules/tickets/`。`module.json` 登记 `support.tickets`。

<<< ../../examples/tutorial-tickets/migrations/0001_tickets.sql#ticket-schema

表引用 Core 的稳定用户 id，但读取身份/成员通过公共接口。状态与版本有数据库约束，表归属由业务自己维护。不要编辑已应用的迁移来增加字段；新增下一个版本。

## 取得 Session 并创建数据

在请求终端的副本根目录运行，使用上一课从 `.course.env` 加载的 `BASE_URL` / `ORIGIN`。以下文件只保存课程开发凭据，不提交：

```bash
mkdir -p .scratch/course-http
curl --fail-with-body -sS -c .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  --data '{"email":"ticket-owner@example.test","password":"course-test-password"}' \
  "$BASE_URL/api/v1/auth/register" > .scratch/course-http/session.json
export CSRF_TOKEN=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/session.json','utf8')).csrf_token")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: first-ticket" -H "Content-Type: application/json" \
  --data '{"title":"First ticket","description":"Investigate a request"}' \
  "$BASE_URL/api/v1/tickets" > .scratch/course-http/ticket.json
export TICKET_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/ticket.json','utf8')).id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID"
```

注册和创建返回 201，读回返回 200；工单的 title 为 `First ticket`、status 为 `open`、version 为 1，id 与创建结果相同。其他返回字段包括创建者和时间戳。重跑课程已有账号时，把注册请求路径换为 `/api/v1/auth/login`，用相同邮箱密码取新 Session。

## 迁移失败检查

```bash
curl -i "$BASE_URL/health/ready"
pnpm boundaries:check
```

预期 readiness 200。新增未执行的迁移后，源码与数据库集合不同会得到 503；执行 `just migrate` 并重启，再用工单读写确认业务 schema。API 启动不会替你迁移。

课程集成测试先跑 Core 迁移，再在隔离库执行课程 SQL；那条 fixture 路径的 Core readiness 不能单独证明工单表存在。副本将课程迁移纳入真正的根迁移集合，生产也要使用同一份源码重编译。

上一课：[模块接入](01-module.md)。下一课：[定义协议和校验边界](03-protocol.md)。
