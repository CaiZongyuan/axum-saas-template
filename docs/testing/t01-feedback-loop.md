# 测试自己的后端与开发反馈循环

为自己的业务选择能观察真实结果的测试入口：普通用例从 Axum HTTP 进入，任务/存储一致性从公开能力进入；复杂纯规则才单独测试 Domain。先运行一个失败的行为，再实现完整路径，不用文件存在或私有方法调用代替结果。

需要 Rust、Node/pnpm、Docker 与已安装依赖。下面命令在仓库根目录运行，测试依赖由工具创建，不使用开发或生产数据库。

## 先给新模块一个可执行 HTTP 检查

新建 `apps/api/tests/my_business.rs`，先确认真实迁移和应用组装可用：

```rust
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "../../migrations")]
async fn migrations_make_the_application_ready(pool: PgPool) {
    let app = saas_api::router(pool, Default::default());
    let response = app
        .oneshot(
            Request::get("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
}
```

```bash
node scripts/test-backend.mjs --test my_business
```

成功证明实际迁移、Router 与请求上下文工作。随后用自己的公开业务请求替换这条基础检查：创建后读取并比较字段；无权写入后读取确认资源与版本未变；同一幂等请求只生成一份结果。业务路由未组装时应得到 404，无效请求应得到统一错误和 request_id。

已有模块接入的完整受检查示例见 [tutorial_module.rs](../../apps/api/tests/tutorial_module.rs)和 `pnpm tutorial:check`；它在临时源码副本验证模块声明、两种 Router 与 OpenAPI，不访问已有数据库。

## 选择足够的观察入口

| 风险                                     | 入口与真实依赖                                     | 验证结果                     |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------- |
| 身份、资源权限、CRUD、冲突、幂等         | Axum Router + 隔离 PostgreSQL                      | 响应与后续可查询结果         |
| Audit/Job 事务、租约、文件发布、缓存降级 | 公开 Application/Adapter + PostgreSQL/Redis/RustFS | 回滚、终态、对象字节与恢复   |
| 最后 Owner、状态转换等纯规则             | Domain，无基础设施                                 | 完整规则边界                 |
| 自己的 Web 表单与错误反馈                | View + Testing Library，MSW 只替代 HTTP            | 用户输入、可见反馈、草稿保留 |
| Cookie/CSRF、生成 SDK 与真实页面组合     | 少量真实浏览器旅程                                 | 完整接线与关键用户结果       |

后端完整入口：

```bash
just test-backend
```

[test-services.mjs](../../scripts/lib/test-services.mjs)隔离创建 PostgreSQL、RustFS、Redis 与 Mailpit，注入动态配置，结束逆序清理。`#[sqlx::test]` 执行实际迁移；并发事务必须使用真实多连接，不能藏在单连接回滚夹具里。故障测试只暂停/清理自己创建的资源。

[迁移检查](../../apps/api/tests/migration.rs)验证空库不可就绪、迁移锁和查询有截止时间；[Jobs 检查](../../apps/api/tests/jobs.rs)验证认领/恢复。新增业务应复用这些公开入口，为自己独有的成功、拒绝和回滚写断言。

## 日常组合检查

```bash
just check
```

当前包括 Rust fmt/clippy、前端格式/lint/typecheck、合同漂移、依赖边界、工具/后端/View 测试、确定性预算，以及 Web 和文档构建。新增接口时同步生成合同、SDK、教程和所有权。低风险正文修改可先运行 `pnpm docs:check` 与 `pnpm docs:build`；它们不验证业务状态机。

需要客户端时，定向运行：

```bash
just test-frontend
pnpm test:tooling
```

View 测试每次新建 QueryClient；MSW 不 mock 自己的 hooks/状态。工具测试验证真实子进程退出与端口清理等工程合同。

## 何时运行浏览器或桌面

```bash
pnpm exec playwright install chromium
just e2e
```

`just e2e` 启动隔离真实应用栈，用于关键 Web 旅程、浏览器回归或里程碑。少量旅程证明 Cookie/CSRF、SDK、页面与后端正确组合，权限和故障全矩阵留在更快的后端测试。`just check-full` 组合主检查与应用 E2E。

`just e2e-docs` 只构建并浏览静态文档站，验证导航、语言、主题、阅读布局与部署 base，不启动应用依赖。这里的“桌面宽度”是浏览器 viewport，与 Electron 桌面壳测试不同。正文/命令改写通常不需要运行 Electron；`just desktop-smoke` 与资源长测仅在提供或修改桌面客户端时使用。

## 失败、记录与下一步

保留首次失败和脱敏 request/job id，定位响应、事务或进程问题后再重跑。竞态使用可控同步点，等待有截止时间。认证旅程不记录凭据、原始动作参数、页面快照或完整签名 URL；按[测试策略](strategy.md)处理产物。

记录检查对应的提交与未提交范围：编译、HTTP、文档构建和浏览器分别证明不同责任。通过主检查后，不因每次 push/合并重复同一套未变化旅程。

下一步：[部署已经通过业务测试的后端](../tutorials/21-single-machine-production.md)。
