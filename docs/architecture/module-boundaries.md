# Core、Platform 与自己的业务边界

SaaS Core 提供身份、企业成员和通用能力；自己的业务模块拥有模型、规则、表、HTTP 接口和 Handler。Platform 提供配置与外部系统适配。应用入口把它们显式组装起来，Core 与 Platform 都不反向认识业务类型。

先读[项目结构](project-structure.md)。本页解释新增能力应该放哪里；具体接入从[新增业务模块](../guides/develop-module.md)开始。

## 依赖与请求流

```text
apps/api/src/lib.rs ──组装──→ Core Router + 自己的业务 Router/OpenAPI
                                │               │
                                │公共能力调用 ←─┘
                                ↓
                      crates/platform（配置、PG、S3、Redis、SMTP、遥测）

apps/worker/src/main.rs ──组装──→ Handler Registry + Jobs Worker
apps/web/src/app-examples.tsx ──组装──→ Universal App Shell + 业务 Views
```

后端各模块位于 `crates/app/src/modules/<name>/`。小模块可先放 `mod.rs`，复杂后再拆 HTTP、Application 和纯 `domain.rs`；纯 Domain 不 import Axum、SQLx 或基础设施。实际边界由职责决定，不要求每个接口创建 Repository/Service 层。

| 所有者     | 负责                                                                                              | 不应持有                      |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------------------------- |
| Platform   | Settings、连接池、迁移运行、有限 Redis/S3/SMTP 操作、Telemetry                                    | Organization 策略和某业务 DTO |
| Core 模块  | Identity、Organization、Audit、Idempotency、Files、Jobs、Notifications、Mail、API Keys、RateLimit | 业务资源规则、业务表          |
| 自己的业务 | 输入/输出、领域规则、资源授权、事务编排、自有表和任务处理                                         | 其他模块私有 SQL              |
| 应用组装点 | Router/OpenAPI、scope、Handler 与 UI 贡献                                                         | 被所有模块隐式读取的注册状态  |
| 客户端包   | contracts → SDK → Views；UI 与平台无关 helper 各司其职                                            | 第二份协议 DTO 和后端权限结论 |

`packages/core` 是平台无关的客户端 helper，不等同于 Rust SaaS Core；`packages/ui` 是通用 React DOM 组件。

## 最小的后端组装接口

[crates/app/src/lib.rs](../../crates/app/src/lib.rs)公开 `compose_routes` 与 `compose_routes_with_options`。以下完整函数只组装 Core，可放在一个应用适配模块中：

```rust
pub fn core_router(
    pool: sqlx::PgPool,
    auth: saas_platform::config::AuthSettings,
) -> axum::Router {
    saas_app::compose_routes(
        pool,
        auth,
        axum::Router::new(),
        saas_app::openapi(),
    )
}
```

加入业务时把自己的 Router 与合并后的 OpenAPI 交给相同接口，不修改 Core 来 import 业务。生产使用 `configured_router`，测试也使用 `router_with_cache`；新增模块需要覆盖这两处实际接入路径。高级组装通过 `CoreOptions` 传 scope、Cache、RateLimiter 和密码重置服务。

## 模块协作与提交责任

业务自己的迁移与 `module.json.tables` 登记表归属。引用 `saas_core.users(id)` 等稳定标识可以建立数据库约束；读取资料、有效成员或跨模块写入仍通过公共能力。

| 能力                  | 调用者责任                                                                            |
| --------------------- | ------------------------------------------------------------------------------------- |
| Identity/Organization | 取当前身份、确认有效 Membership，并执行自己的资源授权；关键写入可用成员锁固定授权依据 |
| Audit                 | 在自己的事务中 `audit::append`，失败就回滚业务                                        |
| Idempotency           | claim、业务变更和 complete 共用事务；按规范化输入建立指纹                             |
| Jobs/Notifications    | 请求事务内入队和登记通知意图；终态由 Jobs 原子发布                                    |
| Files                 | 业务先授权资源，Files 管状态与对象；对象网络 I/O 不假装属于 PostgreSQL 原子提交       |
| API Key/Cache         | 注册实际 scope，凭据授权与当前资源权限取交集；缓存命中前重新授权                      |
| Telemetry             | 使用 tracing 和公开 scope；request/trace id 仅用于关联，不用于授权                    |

Core 的 Organization role 与业务资源资格不同：Owner/Admin/Member 不能自动替代每项业务的权限规则。当前一次部署只有一个 Organization；新增模块不增加租户边界，见[ADR 0001](../adr/0001-single-organization-deployment.md)。

缓存和限流复用 Platform 的有界 Redis 能力，业务不发送任意命令。Identity 管密码重置有效性与短期密文，Jobs 只保存 reset id；凭据和签名 URL 不进入日志、Job 载荷或缓存。Domain 不持有运行时 OTel Context。

## 验证边界并处理失败

```bash
pnpm boundaries:check
cargo check --locked --workspace
```

[检查器](../../scripts/check-boundaries.mjs)验证包导入方向、Core 对业务的反向引用、Domain 基础设施导入、表归属、所有权冲突与注册 marker。临时把一张 Core 私有表登记/读写进业务模块，检查应拒绝；恢复后再运行自己的 HTTP 与事务测试。

SQL 检查基于源码字符串和已登记表名，不能证明全部动态 SQL、带引号标识或别名行为。Rust 可见性、代码评审和真实数据库测试共同补足。自有业务作为可移除参考业务时，同步登记源码、迁移、教程和测试，按[移除指南](../tutorials/23-example-removal.md)在临时副本验证 Core 仍能构建。

边界取舍与组合责任见 [ADR 0002](../adr/0002-executable-removable-reference.md)和 [ADR 0003](../adr/0003-static-example-composition.md)。下一步：[选择自己业务的公开行为测试](../testing/t01-feedback-loop.md)。
