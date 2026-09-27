# 跟做：移除知识库示例，接入你自己的业务

本章回答“这个模板怎么变成我的产品”。知识库示例的存在是为了教你：文档、附件、导出这些真实业务展示了 Core 的每个能力如何被使用。当你开始写自己的业务时，示例应该被**真正删掉**——不是隐藏菜单，而是源码、路由、迁移、任务、教程导航一起消失，而 Core（注册/登录、成员、文件服务、任务、通知、API Key、审计、邮件、限流、遥测）原样保留并继续可验证。这由[所有权清单](../../examples/knowledge-base/manifest.json)驱动：示例拥有什么、在哪些组装点注册，全部显式登记；[移除工具](../../scripts/example-remove.mjs)按清单操作，不靠文件名关键词猜。

## 1. 所有权清单：示例到底拥有什么

[manifest.json](../../examples/knowledge-base/manifest.json) 登记五类信息，每类都有检查器钉住：

| 登记项                   | 内容                                                                                                           | 谁在检查                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `ownedPaths`             | 示例整删的后端模块、Views、迁移、测试、E2E、教程页与研究文档（本示例没有种子数据；若有，同样登记为 ownedPath） | `pnpm boundaries:check`、清单测试 |
| `registrationMarkers`    | 组装点文件里的 `example:knowledge:*:start/end` 注册区块                                                        | 同上，成对且有序才通过            |
| `compositionPoints`      | API/Worker/Web/文档导航等需要改动（而非删除）的文件                                                            | 存在性检查                        |
| `ownedDependencies`      | 只有示例在用的 npm 依赖（如 react-markdown）                                                                   | 移除时从对应 package.json 剥离    |
| `ownedCargoDependencies` | 只有示例在用的 Rust 依赖（zip、pulldown-cmark）                                                                | 移除时从对应 Cargo.toml 剥离      |

反向约束同样成文：Core 模块（含后加入的邮件与 telemetry）**不 import Knowledge**——`boundaries:check` 逐文件扫描 import 方向、SQL 字符串里的表归属与跨模块 Views 引用，注册一个人的“个人库初始化”这类把示例写进 Identity 的捷径，会在检查器处直接失败。每个模块的 `module.json` 声明自己的表（如 `knowledge.documents`），迁移里出现的每张表都必须有主人。

## 2. dry-run：先看清楚会发生什么

```bash
just example-remove --dry-run
```

[移除工具](../../scripts/example-remove.mjs)列出将要删除的每一条路径、将移除的每个标记区块、导航里将消失的教程页、将剥离的依赖，以及之后要重跑的再生命令——**不写任何文件**。同时它运行保护检查并如实报告：“这份副本现在应用会被拒绝，因为存在未提交改动”。

保护是硬性的：工具只面向干净的 git 工作副本工作。检测到未提交改动，它会列出脏文件并拒绝执行、一个字节都不动；某个登记标记区块被用户改得不再成对（start/end 各恰好一次），同样拒绝并列出位置。被拒绝时你得到的是清单，不是覆盖——你需要先提交或丢弃自己的改动，或手工解开与示例纠缠的定制。

## 3. 移除与两条迁移路径

```bash
just example-remove
```

工具按清单精确执行：删除示例拥有的路径，移除组装点里的标记区块（`apps/api/src/lib.rs` 的路由与 OpenAPI 注册、`apps/worker/src/main.rs` 的任务注册、Web 路由与视图导出、README、快速开始、`.env.example`、E2E 环境策略），从 `docs/site.json` 摘掉示例教程页，剥离示例独占依赖，把清单置为 `status: removed`（清单本身保留——desktop-smoke 等脚本按它自适应），最后原地重新生成派生产物：`pnpm install`、`cargo update --workspace`、`pnpm generate`（OpenAPI/contracts/SDK）、项目文档引用。结束后用 Core 门禁验收：

```bash
just check-core    # fmt、clippy、后端测试、contracts 漂移、边界检查
just docs-build    # 文档站构建，死链会在这里暴露
```

迁移历史有两条路径，工具默认走**保守**的那条：

- **已运行过或发布过迁移的项目**：什么都不做。`0003`、`0007`、`0009`、`0012`（示例拥有的迁移）原样保留，`_sqlx_migrations` 历史完整——源码移除绝不等于删除已有业务数据，这些迁移描述的表留在数据库里，直到你用**新增迁移**显式处理它们。保留路径同时把这四个文件登记进清单的 `retainedMigrations`：它们的表已经没有代码主人，表归属检查器据此豁免这几个历史文件，而“每张表必须有主人”的规则对其余一切照旧生效。
- **全新项目（还没有任何数据库）**：`just example-remove --trim-migrations` 裁掉示例迁移，新空库从 Core 迁移直接初始化。裁剪只对“从未应用过这些迁移”的副本合法；CI 的删例验收走的就是这条路径，在一个真正的空库上验证。

## 4. 移除后 Core 还剩什么、什么退场

注册/登录与会话、企业成员、文件服务与对象清理、任务与恢复、通知、API Key、审计、密码重置邮件、限流、遥测——全部保留，且有测试钉着：删例后的 `just check-core` 跑的就是这些幸存测试（`registration`、`members`、`jobs`、`config`、`migration`）。邮件与 telemetry 模块不在任何 `ownedPath` 中，这是手递说明里点名的验收点。

示例教学的一些能力章节随示例退场（附件、导出、API Key 演示、缓存演示、可观测性演示都以知识库文档为载体）；能力本身和它们的测试留在 Core。生产工具分层清楚：`production-backup` 与 `production-restore` 与业务无关（它们只认数据库与对象清单），删例后照常可用；`production-smoke` 与 `production-restore-drill` 的种子旅程以示例数据为载体，删例后它们会诚实说明并退出，提示你按同样的骨架为自己的业务写演练——备份数据平面没有变，变的只是旅程。

CI 在每个 PR 上做真实演练：把模板克隆到临时副本，制造脏文件验证保护拒绝，实际执行 `--trim-migrations` 移除，跑 `check-core` 与 `docs-build`，再执行下一节的接入练习。

## 5. 接入你自己的业务

删除示例只是开始，教程的承诺是“新业务沿同一套公开接口接入”。CI 里的接入练习由[示例脚本](../../scripts/example-new-business.mjs)执行，你手工操作时沿完全相同的步骤：

1. **自己的模型与迁移**：新建 `migrations/00XX_notes.sql`，`CREATE SCHEMA notes` 建自己的表，`module.json` 登记表归属（`boundaries:check` 要求每张表有主人；引用 `saas_core.users(id)` 这类 Core 稳定标识是允许的跨模块引用）。
2. **实现模块**：在 `crates/app/src/modules/mod.rs` 声明 `pub mod notes;`，在 `crates/app/src/modules/notes/` 里写 HTTP handler（用 `identity::require_session` 取当前用户）与领域查询；模块不碰其他模块的私有表。标识符保持字符串、在 SQL 边界显式转换（`$1::uuid`、`RETURNING id::text`）——workspace 的 sqlx 不开 uuid 编解码 feature。
3. **注册路由与 OpenAPI**：在 `apps/api/src/lib.rs` 的组装点把 `notes::router` 并入 `domain_routes`、把 `notes::openapi()` 并入文档。
4. **生成 SDK**：`pnpm generate` 让 contracts/SDK 出现你的资源类型。
5. **测试**：像 `apps/api/tests/notes.rs` 那样在公开 HTTP 接口上断言注册 → 创建 → 读取（`#[sqlx::test]` 需要一个 PostgreSQL，`just test-backend` 会自备一次性实例）。

练习脚本替你把这些文件写进临时副本，借助[同一条测试postgres通道](../../scripts/lib/postgres.mjs)跑 `cargo test` 与 clippy——CI 绿灯就是“删例后接入路径可用”的可执行证据。

## 6. 运行本章检查

```bash
node --test tests/tooling/example-remove.test.mjs
just example-remove --dry-run
just check
```

清单与工作副本之间的漂移由两层钉住：`boundaries:check` 在每次 `just check` 里验证登记路径与标记区块，[清单工具测试](../../tests/tooling/example-remove.test.mjs)在合成副本上验证移除语义本身——dry-run 零写入、精确删除与标记编辑、导航裁剪、依赖剥离、迁移默认保留与 `--trim-migrations`、脏副本与结构破坏的拒绝。真正的删例验收在 CI 的 `example-removal` job 里对全新副本完整执行。
