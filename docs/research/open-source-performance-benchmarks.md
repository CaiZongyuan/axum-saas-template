# 同类 FastAPI 模板如何测试性能与在 README 表达优势

查证日期：2026-09-27。对象按用户指定，聚焦 `fastapi/full-stack-fastapi-template` 与 `benavlabs/fastapi-boilerplate`，框架自身的宣传仅作为背景。目的：为本 Rust/Axum SaaS Core 模板判断性能证据和 README 的写法。

结论：**所检查的两个模板快照都没有提供可复现的端到端吞吐、延迟和成本对照报告。它们主要通过集成能力、生产配置、开发体验和测试表达价值。** Benav Labs 有一个局部计时测试，也有性能相关技术描述；这些需要与整套模板的容量证据区分。

固定源码快照：

- Full Stack FastAPI Template：`cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7`。
- Benav Labs FastAPI Boilerplate（当前品牌 Fastro）：`7f4d22f22d12f406f09b50f44e2589a058971083`。这比本仓库先前模板研究笔记所读的快照更新。

本次没有运行外部项目或重新压测本仓库；下文区分源码事实、作者宣传与建议。

## 1. README 怎样写优势

| 方面 | Full Stack FastAPI Template | Benav Labs / Fastro |
| --- | --- | --- |
| 首要定位 | 标题直接表明全栈 FastAPI 模板，主体是 Technology Stack and Features、截图与开发部署入口 | “Batteries-included FastAPI starter”，强调 “vertical-slice modules, swappable infrastructure, plugin-ready CLI” |
| 技术与性能相关表述 | FastAPI、SQLModel、Pydantic、PostgreSQL 等技术栈；没有模板 RPS、P95、内存或成本对比 | “Fully async FastAPI + SQLAlchemy 2.0”、“FastCRUD for efficient CRUD & pagination”、Redis/Memcached 缓存与后台任务；没有模板 RPS、P95、内存或成本对比 |
| 主要价值证明 | 认证、密码恢复、React 前端、生成 Client、邮件、Pytest、Playwright、CI/CD、Docker/部署、界面截图 | Sessions/CSRF、OAuth、API Keys、Tier 限流、CRUD、缓存、Taskiq、可替换基础设施、生成部署配置的 CLI、详细文档 |
| 对用户的承诺 | 一套可以起步的完整全栈工程 | 带合理默认值、可以选择模块、逐步扩展的后端基础；同时明确免费基础与付费 SaaS 产品范围 |
| 原文依据 | [README][f-readme] | [README][b-readme] |

这是项目的宣传结构，不等于性能已被测量。Full Stack 使用闪电/火箭图标也不构成量化速度声明。

Benav 的**文档首页**另有 “Performance & Scalability” 段，列举全异步架构、Pydantic V2、SQLAlchemy 查询和缓存；还写 “Pydantic V2 ... rewritten in Rust (5x-50x faster)”。这个倍数在文中描述的是依赖库 Pydantic，不能改写成“这个 FastAPI 模板快 5–50 倍”，更不能用于与本 Rust 模板对比。这里也不能误称为根 README 的实测结果。[b-index]

## 2. 他们实际怎样测试

### Full Stack FastAPI Template

- **后端正确性**：CI 启动 PostgreSQL/Mailpit，运行 `coverage run -m pytest`，覆盖率检查使用 90% 下限。测试包括 API 与 CRUD；这是功能覆盖证据。[f-ci][f-test-script][f-tests]
- **整栈启动验证**：另一个工作流构建并启动 Compose，执行迁移，再用 curl 检查健康接口和前端可达性。它不产生持续负载、饱和点或延迟分布。[f-compose-ci]
- **浏览器测试**：README 宣传 Playwright，仓库也有相应前端测试，包括 Items 的增删改等操作；它们验证交互行为。[f-readme][f-e2e]
- **本次未找到**：在固定快照的文件树和代码/文档/工作流文本中，未发现模板专属负载套件或公开吞吐、延迟、CPU/RSS、成本报告。搜索覆盖 benchmark、load/stress test、locust、k6、wrk、autocannon、throughput、latency、RPS/QPS 等，并检查上述实际测试入口。这个结论仅针对所查快照，不代表作者从未私下或在别处测量。[f-tree]

### Benav Labs / Fastro

- **后端正确性**：CI 使用 Python 3.11，执行 `cd backend && uv run --no-sync pytest`；依赖包含 pytest、pytest-asyncio、httpx、PostgreSQL testcontainers 等。[b-ci][b-pyproject]
- **测试环境与生产不同**：`conftest.py` 使用 PostgreSQL testcontainer、httpx `ASGITransport`，会话与限流使用内存后端，Redis pipeline 被替换；部分认证客户端覆盖用户/Principal 依赖。因此这些测试可以验证应用行为，但不能据此报告生产 HTTP 服务、Redis 会话或网络的吞吐。[b-fixtures]
- **确实存在一个局部性能测试**：`test_correlation_id_filter_performance` 在同一进程循环调用日志 `CorrelationIdFilter` 1,000 次，断言总时间小于 1 秒。它不启动 HTTP 负载，不查数据库，也不提供模板 RPS/P95。[b-filter-test]
- **标记不等于负载实现**：integration conftest 注册 `performance`、`stress` 标记，并按文件/函数名打标；仅有这个分类机制不能说明存在完整压测套件。[b-markers]
- **生产文档有观测建议**：要求关注错误率、P95/P99、数据库连接饱和、队列深度、Redis 内存，也解释 worker 与连接池的资源关系。这些是部署指导，不是附有输入、机器和实测输出的报告。[b-production]
- **本次未找到**：检查源码树，并读取/检索 `docs/`、`backend/`、`cli/`、工作流等 255 个文本文件后，未发现该模板的端到端负载工具入口、容量报告或与其他模板的数值对照；文件名和上述性能关键词均检查过。[b-tree]

Benav 的 Testing 文档仍写 “No example tests ship yet”，但当前源码已有大量单元和集成测试。因此这里以源码和 CI 为准，没有照抄文档中的缺失声明，也没有执行测试来验证是否全部通过。[b-testing][b-tests][b-ci]

| 与容量测量相关的条件 | Full Stack | Benav / Fastro |
| --- | --- | --- |
| 默认生产 HTTP 进程 | Dockerfile 使用 Python 3.14、`fastapi run --workers 4` | Dockerfile 使用 Python 3.11、`WORKERS=1`；CLI 生成部署配置时默认参数为 4，并通过 Compose 注入；实际数量取决于部署入口 |
| 数据库与路径 | SQLModel、同步路由；普通用户 Items 列表按 owner 过滤，执行 count 与分页 select | 全异步 SQLAlchemy，配置默认 PostgreSQL `pool_size=20`、`max_overflow=0`；每进程有自己的 engine/pool |
| 鉴权与额外工作 | JWT 解码后读取 User 并检查 active；所查 Item 创建路由 add/commit/refresh，没有审计/幂等步骤 | Sessions/CSRF、权限、限流、缓存和 Taskiq 可配置；产线配置示例使用 Redis sessions，测试则有内存/替身配置 |
| 可核验依据 | [Dockerfile][f-docker]、[Item 路由][f-items]、[鉴权][f-auth] | [Dockerfile][b-docker]、[CLI 默认值][b-deploy]、[生成模板][b-compose]、[数据库设置][b-settings]、[engine][b-db]、[生产指南][b-production] |

这个表是**将来设计对照实验必须披露的条件**，不是已经开展的 benchmark。不能仅比较某一个 Python worker 的 RSS；应统计所有 API worker 与所计基础设施，也不能让不同进程数悄悄扩大数据库连接预算。

## 3. 对本模板意味着什么

两个参考模板提供的是现成能力与工程流程，当前没有可以直接拿来和本仓库“308 req/s 初步基线”对比的同口径数字。不能由“它们没有公开报告”推导出 Rust 更快，也不能用裸框架的 hello-world RPS 补上它们的整套应用证据。

本仓库已有 `just perf-load`、`perf-saturation`、`perf-trajectory`、`perf-soak` 与教程，覆盖受控负载栈、k6 场景和报告。这是一项可展示的工程能力；要表达吞吐或成本优势，还需要固定资源、清楚负载和可复核结果。[local-just][local-load]

知识库继续作为当前 Reference Application；目标是评估可复用的 SaaS Core。后续参考应用可各自提供负载适配与数据集，不要求所有业务共享一个 RPS。

### 建议先回答两个不同问题

| 想知道什么 | 合适的方法 | 可以得出的结论 |
| --- | --- | --- |
| 使用各模板原生配置，能交付多少业务能力、处理多少负载 | 在相同资源下运行各模板相近的原生业务，明确认证/权限/缓存/审计等功能差异 | 这些具体模板与配置的容量、资源及功能取舍 |
| Rust/Axum 与 SaaS Core 的实现究竟带来哪些资源收益 | 在少数关键路径建立等价请求、响应和必要副作用；另测基础 Axum 与增加 Core 能力后的变化 | 这些实现的资源差异，以及 Core 各类工作增加的开销 |

例如 Full Stack 的 Item 创建没有本仓库写入中的审计和幂等工作，JWT 读取用户也不等于数据库 Session 更新。若一边做得更多，直接相除 RPS 后称为“Rust 对 Python 的速度倍数”会归因错误。[f-items][f-auth]

**无需先重建三套完整 SaaS。** 建议先补齐本模板容量报告，再按需要实现少数可对照路径：

1. 最小 Axum JSON 响应，作为基础 HTTP 开销参考。
2. 相同响应内容，接入模板的适用公共中间件，记录新增工作。
3. 真实 Session 鉴权与授权读取，固定数据库数据规模和返回载荷。
4. 带审计、幂等及相同事务语义的业务写入。
5. 在知识库及未来其他参考应用中分别运行混合用户旅程。

前两项主要帮助解释成本来源；后三项是模板使用者更关心的业务证据。并发登录与密码校验单列，日常读取场景预先准备会话，避免启动时的登录拥堵污染稳态结论。

### 一份可公开的报告需要补齐的内容

- **输入和资源**：代码 commit、锁文件、release/production 命令、worker/runtime 线程数、各进程与总连接池、数据库/Redis 版本、CPU/内存限额、压测器位置、数据规模/分布、请求混合、载荷、缓存状态。
- **正确性和执行**：先确认相同请求产生预期结果和副作用；预热后多轮测量，轮换对照顺序，保留原始结果；阶梯展示饱和现象。固定到达率测试还应报告目标与实际到达率、未发出的迭代及错误，以免系统变慢时压测器也同步降速而隐藏排队代价。
- **有条件的吞吐**：事先约定 P95/P99 与非预期错误率后，再报告满足条件的最大成功业务吞吐；预期限流与错误分别列出，不把快速返回 429 当成功工作。
- **资源和成本**：记录 API 全部进程、Worker 与所计数据库/缓存等组件的资源；有同供应商/地域/计费日期的价格，才计算每百万成功请求成本。没有价格时称资源效率，不能声称已证实费用节省。

以上是研究建议，尚未实现；具体机器、延迟阈值与对照范围仍待确定。Performance Contract 的确定性预算继续与 Load Report 分开；这不改变普通 PR 的门禁。[local-context][local-strategy]

## 4. README 建议写法

参考两个模板，首屏先表达**交付什么、适合谁、怎样启动、怎样替换示例**，用可运行能力支持优势。性能作为独立小段，给报告入口。

当前可以使用的表达方向：

> 基于 Rust、Axum 与 Tokio 的 SaaS 模板，提供可复用的 SaaS Core、可替换参考应用，以及可复现的性能预算与负载报告。报告记录业务场景、数据规模、吞吐、延迟、错误与资源占用。

这表述已有技术栈和测量设施；当前不能增加“比 Full Stack/Fastro 快 N 倍”或“降低 N% 成本”。也不把 Benav 文档中的 Pydantic 倍数当作模板宣传的范例照搬。

等取得同口径证据后，可以换成如下**结构示例；方括号必须由实测填写**：

> 在 [CPU/内存/所计组件] 下，执行 [具体业务与数据规模]，在 P95 ≤ [阈值]、P99 ≤ [阈值]、非预期失败率 ≤ [阈值] 时，本实现达到 [X] 次成功请求/秒。结果来自 [轮数与统计方式]；脚本、完整配置与原始数据见报告。

如增加对照，紧接一张“模板/实现及版本、功能差异、有效吞吐、P95/P99、CPU、全部进程/组件内存”表。报告支持哪项收益就写哪项；不需要先承诺所有指标都领先。

## 5. 框架资料仅作方法补充

这两类材料可以借鉴做法，但不能替代同类模板的测试证据：

- FastAPI 官方 Benchmarks 文档明确要求把校验、序列化等能力纳入等价比较；其 README 的 TechEmpower 背书属于框架实现，不是 Full Stack 或 Fastro 的部署容量。[framework-fastapi]
- Fastify 根 README 在同页给硬件、版本、`autocannon` 参数、预热轮次，并声明 synthetic hello-world 只测框架开销。这种“结论附近写条件和边界”的表达值得借鉴。[framework-fastify]
- Hono 当前 `app.fetch()` 微基准每轮使用新进程、轮换版本顺序、保留各轮值并汇总中位数，适合参考其可复核方式；它本身没有数据库或 SaaS 业务。[framework-hono]

## 6. 查证边界

“未找到”仅限固定快照及本次检索范围，不声称项目没有任何未公开或历史测试。未复跑上游测试、未执行负载、未测供应商费用，也没有修改本项目 README、代码、术语或 ADR。生产文档的 worker 经验值、依赖性能文案和功能测试通过，都不能直接换算为业务容量。

[f-readme]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/README.md
[f-tree]: https://github.com/fastapi/full-stack-fastapi-template/tree/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7
[f-ci]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/.github/workflows/test-backend.yml
[f-test-script]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/scripts/test.sh
[f-tests]: https://github.com/fastapi/full-stack-fastapi-template/tree/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/tests
[f-compose-ci]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/.github/workflows/test-docker-compose.yml
[f-e2e]: https://github.com/fastapi/full-stack-fastapi-template/tree/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/frontend/tests
[f-docker]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/Dockerfile
[f-items]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/app/api/routes/items.py
[f-auth]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/app/api/deps.py
[b-readme]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/README.md
[b-tree]: https://github.com/benavlabs/fastapi-boilerplate/tree/7f4d22f22d12f406f09b50f44e2589a058971083
[b-index]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/docs/index.md
[b-ci]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/.github/workflows/tests.yml
[b-pyproject]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/pyproject.toml
[b-fixtures]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/tests/conftest.py
[b-filter-test]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/tests/unit/infrastructure/logging/test_correlation_id.py
[b-markers]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/tests/integration/conftest.py
[b-production]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/docs/user-guide/production.md
[b-testing]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/docs/user-guide/testing.md
[b-tests]: https://github.com/benavlabs/fastapi-boilerplate/tree/7f4d22f22d12f406f09b50f44e2589a058971083/backend/tests
[b-docker]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/Dockerfile
[b-deploy]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/cli/src/cli/features/_builtins/deploy/feature.py
[b-compose]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/cli/src/cli/features/_builtins/deploy/templates/prod/docker-compose.yml.j2
[b-settings]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/src/infrastructure/config/settings.py
[b-db]: https://github.com/benavlabs/fastapi-boilerplate/blob/7f4d22f22d12f406f09b50f44e2589a058971083/backend/src/infrastructure/database/session.py
[local-just]: ../../justfile
[local-load]: ../tutorials/25-load-reports.md
[local-context]: ../../CONTEXT.md
[local-strategy]: ../testing/strategy.md
[framework-fastapi]: https://github.com/fastapi/fastapi/blob/192b12197eb04c2b4a691cce7d87261b21716714/docs/en/docs/benchmarks.md
[framework-fastify]: https://github.com/fastify/fastify/blob/bc25b7499acedb803ef3cef644d0d56cf4e7c725/README.md
[framework-hono]: https://github.com/honojs/hono/blob/52f6c7ec865b31001a14eed9b323a0235f0a3156/benchmarks/fetch/README.md
