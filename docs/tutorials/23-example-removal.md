# 组合与移除参考业务

模板默认注册知识库（完整业务）；便签（只为验证组合接口的最小示例）源码随仓库附带但默认不注册——用[接入章节](27-add-example.md)的装回工具 `scripts/example-add.mjs` 可随时注册它。本章回答"这个模板怎么变成我的产品"：先看清示例拥有什么，再预览移除、删除**任意一个**、或一路移除到零示例——源码、路由、迁移登记、任务、教程导航一起消失，而 Core（注册/登录、成员、文件服务、任务、通知、API Key、审计、邮件、限流、遥测）原样保留并继续可验证。前端接入与四种应用组合的运行方式见[接入一个参考业务](27-add-example.md)；本章专注移除侧的工具、保护与边界。

## 1. 所有权清单：示例到底拥有什么

每个示例在 `examples/<id>/manifest.json` 登记五类信息，每类都有检查器钉住。以[知识库](../../examples/knowledge-base/manifest.json)与[便签](../../examples/notes/manifest.json)为例：

| 登记项                   | 内容                                                         | 谁在检查                          |
| ------------------------ | ------------------------------------------------------------ | --------------------------------- |
| `ownedPaths`             | 示例整删的后端模块、Views、迁移、测试、E2E、教程页与研究文档 | `pnpm boundaries:check`、清单测试 |
| `registrationMarkers`    | 组装点文件里的 `example:<前缀>:*:start/end` 注册区块         | 同上，成对且有序才通过            |
| `compositionPoints`      | API/Worker/Web/文档导航等需要改动（而非删除）的文件          | 存在性检查                        |
| `ownedDependencies`      | 只有示例在用的 npm 依赖（如 react-markdown）                 | 移除时从对应 package.json 剥离    |
| `ownedCargoDependencies` | 只有示例在用的 Rust 依赖（zip、pulldown-cmark）              | 移除时从对应 Cargo.toml 剥离      |

独占性是硬约束：两个示例声明同一条 `ownedPaths`，或声明同一份清单里的同一个独占依赖，都属于所有权冲突，删除工具无法裁决，验证处直接失败并列出冲突双方；移除命令在动第一个字节之前就运行同一验证。反向约束同样成文：Core 模块（含后加入的邮件与 telemetry）**不 import 任何示例**，示例之间也不得互相引用（包括经由共享 views 桶文件绕道）——`boundaries:check` 逐文件扫描 import 方向、SQL 字符串里的表归属与跨模块 Views 引用，把示例写进 Identity 这类捷径会在检查器处直接失败。每个模块的 `module.json` 声明自己的表（如 `knowledge.documents`），迁移里出现的每张表都必须有主人。

## 2. dry-run：先看清楚会发生什么

```bash
just example-remove --dry-run                    # 默认移除知识库
node scripts/example-add.mjs --example notes     # 便签默认未注册；先装回
node scripts/example-remove.mjs --example notes --dry-run   # 再预览移除便签
```

[移除工具](../../scripts/example-remove.mjs)列出将要删除的每一条路径、将移除的每个标记区块、导航里将消失的教程页、将剥离的依赖，以及之后要重跑的再生命令——**不写任何文件**。示例 id 用 `--example <id>` 显式选择；id 不存在时工具直接报错并列出当前注册的全部 id，不会默默作用于"最像的那个"。

保护是硬性的，拒绝时你得到的是清单而不是覆盖：检测到未提交改动，它列出脏文件并拒绝执行、一个字节都不动；某个登记标记区块被改得不再成对（start/end 各恰好一次），同样拒绝并列出位置。工具只面向干净的 git 工作副本工作——这份谨慎同样保护你对模板的定制：先提交或丢弃自己的改动，或手工解开与示例纠缠的部分。

## 3. 移除任意一个，或一路移除到零

```bash
just example-remove                              # 移除知识库（默认源码已只注册知识库 → 零示例）
node scripts/example-add.mjs --example notes     # 装回便签 → 双示例
node scripts/example-remove.mjs                  # 移除知识库 → 仅剩便签
node scripts/example-remove.mjs --example notes  # 移除便签 → 仅剩 Core
```

工具按清单精确执行：删除示例拥有的路径，移除组装点里的标记区块（`apps/api/src/lib.rs` 的路由与 OpenAPI 注册、`apps/worker/src/main.rs` 的任务注册、Web 路由与视图导出、教程导航），从 `docs/site.json` 摘掉示例教程页，剥离示例独占依赖，把清单置为 `status: removed`（清单本身保留——desktop-smoke 等脚本按它自适应），最后原地重新生成派生产物：`pnpm install`、`cargo update --workspace`、`pnpm generate`（OpenAPI/contracts/SDK）、项目文档引用。

要移除多个示例，请**逐个执行并在两次移除之间提交一次副本改动**——工具只改干净的副本，这也是它保护你的方式。移除全部示例后只剩 Core，登录回到通用首页；如果删除的是声明默认入口的示例（今天是知识库的「我的文档」），登录着陆同样自然回到通用首页，不存在指向已删页面的入口。每次移除结束后用同一组门禁验收：

```bash
just check-core    # fmt、clippy、后端测试、contracts 漂移、边界检查
just docs-build    # 文档站构建，死链会在这里暴露
pnpm typecheck && pnpm test:frontend && pnpm --filter @saas/web build && pnpm boundaries:check
```

迁移历史有两条路径，工具默认走**保守**的那条：

- **已运行过或发布过迁移的项目**：什么都不做。示例拥有的迁移原样保留，`_sqlx_migrations` 历史完整——源码移除绝不等于删除已有业务数据，这些迁移描述的表留在数据库里，直到你用**新增迁移**显式处理它们。保留路径同时把这些文件登记进清单的 `retainedMigrations`：它们的表已经没有代码主人，表归属检查器据此豁免这几个历史文件，而"每张表必须有主人"的规则对其余一切照旧生效。
- **全新项目（还没有任何数据库）**：`just example-remove --trim-migrations` 裁掉示例迁移，新空库从 Core 迁移直接初始化。裁剪只对"从未应用过这些迁移"的副本合法；CI 的删例验收走的就是这条路径，在一个真正的空库上验证。

## 4. 移除后 Core 还剩什么、什么退场

注册/登录与会话、企业成员、文件服务与对象清理、任务与恢复、通知、API Key、审计、密码重置邮件、限流、遥测——全部保留，且有测试钉着：删例后的 `just check-core` 跑的就是这些幸存测试（`registration`、`members`、`jobs`、`config`、`migration`）。邮件与 telemetry 模块不在任何 `ownedPath` 中，这是手递说明里点名的验收点。

历史记录不随源码消失：指向已删业务的历史通知显示"此通知的功能当前不可用"，不再是可点击的目标；旧书签与外部深链接落在"相关功能当前不可用"页面，页面提供返回首页的出口，地址不被悄悄改写。生产工具分层清楚：`production-backup` 与 `production-restore` 与业务无关（它们只认数据库与对象清单），删例后照常可用；`production-smoke` 与 `production-restore-drill` 的种子旅程以示例数据为载体，删例后它们会诚实说明并退出，提示你按同样的骨架为自己的业务写演练——备份数据平面没有变，变的只是旅程。

性能预算按同一条线分层：注册预算（`perf_registration.rs`）属于 Core，删例后继续被后端测试钉住；文档列表、创建与导出的预算（`perf_documents.rs`）和查询计划脚本里的示例列表 SQL 以示例为载体退场——`just perf` 里的测试选择要换成你自己业务的性能测试，`just perf-ci` 里的查询计划脚本会诚实说明并退出。

CI 在每个 PR 上做真实演练：把模板克隆到临时副本，制造脏文件验证保护拒绝；在第一个副本先跑默认（仅知识库）装配的前端门禁，用装回工具注册便签并提交，得到双示例组合过整组门禁，随后实际执行 `--trim-migrations` 移除知识库得到仅便签组合并复跑整组门禁，再移除便签得到仅 Core 组合并复跑前端门禁；在第二个副本移除便签得到仅知识库组合，同样过整组门禁。四种组合各自完成构建与测试——最后执行下一节的接入练习。

## 5. 接入你自己的业务

删除示例只是开始，教程的承诺是"新业务沿同一套公开接口接入"。前端页面与导航的接入方式见[接入一个参考业务](27-add-example.md)；后端沿以下步骤：

1. **自己的模型与迁移**：新建 `migrations/00XX_<业务>.sql`，`CREATE SCHEMA` 建自己的表，`module.json` 登记表归属（`boundaries:check` 要求每张表有主人；引用 `saas_core.users(id)` 这类 Core 稳定标识是允许的跨模块引用）。
2. **实现模块**：在 `crates/app/src/modules/mod.rs` 声明模块，在 `crates/app/src/modules/<业务>/` 里写 HTTP handler（用 `identity::require_session` 取当前用户）与领域查询；模块不碰其他模块的私有表。标识符保持字符串、在 SQL 边界显式转换（`$1::uuid`、`RETURNING id::text`）——workspace 的 sqlx 不开 uuid 编解码 feature。
3. **注册路由与 OpenAPI**：在 `apps/api/src/lib.rs` 的组装点把模块 router 并入 `domain_routes`、把 openapi() 并入文档。
4. **生成 SDK**：`pnpm generate` 让 contracts/SDK 出现你的资源类型。
5. **测试**：像 `apps/api/tests/notes.rs` 那样在公开 HTTP 接口上断言注册 → 创建 → 读取（`#[sqlx::test]` 需要一个 PostgreSQL，`just test-backend` 会自备一次性实例）。

练习脚本（`scripts/example-new-business.mjs`）替你把这些文件写进临时副本，借助[同一条测试 postgres 通道](../../scripts/lib/postgres.mjs)跑 `cargo test` 与 clippy——CI 绿灯就是"删例后接入路径可用"的可执行证据。

## 6. 运行本章检查

```bash
node --test tests/tooling/example-remove.test.mjs
just example-remove --dry-run
just check
```

清单与工作副本之间的漂移由两层钉住：`boundaries:check` 在每次 `just check` 里验证登记路径、独占性与标记区块，[清单工具测试](../../tests/tooling/example-remove.test.mjs)在合成副本上验证移除语义本身——dry-run 零写入、精确删除与标记编辑、未知 id 与所有权冲突的拒绝、导航裁剪、依赖剥离、迁移默认保留与 `--trim-migrations`、脏副本与结构破坏的拒绝。真正的删例验收在 CI 的 `example-removal` job 里对全新副本完整执行。
