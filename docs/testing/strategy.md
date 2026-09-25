# 前后端测试与开发反馈循环

这是 [架构规范](../saas-template-architecture-spec.md) 的测试实施方案。当前仓库尚无应用实现；本文定义要建设的验证入口与责任，不代表测试已存在或通过。

## 1. 测试从哪里观察行为

默认用尽量高的公开接口验证：后端从 Axum HTTP 接口，前端从可操作的页面/组件，完整旅程从真实浏览器。只有无法在这些入口可靠定位的事务适配、任务恢复或纯业务约束，才增加对应的公开 Application/Adapter 或 Domain 测试。

| 测试入口 | 工具与真实依赖 | 负责的风险 |
| --- | --- | --- |
| 后端 HTTP | Rust tests、真实 Axum Router、隔离 PostgreSQL | 注册/会话、权限、CRUD、版本冲突、幂等、错误与数据持久性 |
| 公开任务/存储能力 | Rust integration tests、真实 PostgreSQL/Redis/RustFS、受控 Worker | 领取/租约/重试/恢复、对象完成/删除、缓存降级、事务一致性 |
| 纯 Domain 行为 | Rust unit tests，无基础设施 | 最后 Owner、角色与资源授权组合、状态变迁等值得独立验证的规则 |
| React Views/UI | Vitest、React Testing Library、user-event；HTTP 边界使用 MSW | 表单、Markdown 编辑、页面反馈、只读状态、冲突时保留输入、键盘行为 |
| 完整浏览器旅程 | Playwright + Web/API/Worker/PostgreSQL/Redis/RustFS | Cookie/CSRF、SDK 接线、真实权限、附件、导出与通知 |
| 生成与工程合同 | OpenAPI/SDK 生成器、边界检查、文档构建、确定性性能计量 | 协议漂移、Core 依赖、示例移除、教程有效性、query/bundle 预算 |

用户已随 v1 GitHub 拆分确认这组测试入口。实施票写明本票使用哪些入口，它们作为预先约定的测试位置，无需为相同范围重复请求确认。真正需要新增测试入口时先说明原因，不为了覆盖率测试私有函数、React hooks 内部状态或 Repository 调用次数。

## 2. 后端如何写

普通业务以真实 Axum Router 驱动 HTTP 请求，验证响应与随后可查询的业务结果。例如创建文档后再调用详情接口读取；Reader 修改后调用详情确认正文未变。Application 内部模块可以重构，测试仍验证相同合同。

- 使用独立 PostgreSQL 数据库或 schema，并执行实际迁移；不以 SQLite 替代 PostgreSQL。
- PostgreSQL 是真实事务边界；涉及多连接/并发的测试不能藏在单连接回滚夹具里。
- 通过公开 Job、Audit 或相关业务查询验证可观察结果。数据库约束或性能测试有单独责任，可以在对应适配器/计量入口观察约束与 SQL 数量，不把这些观测复制到每个业务测试中。
- 外部邮件供应商由捕获服务器替代；不 fake 掉要验证的 Worker、队列表、Redis 或 S3 协议。
- 纯 Domain 测试只针对真正存在的复杂规则，不为每个 DTO getter 创建一组镜像测试。

重点不是每个成功请求都覆盖十遍，而是锁住几个会出事故的行为：并发注册只产生一个账号和首位 Owner，两个编辑者不会静默互相覆盖，撤权后 API/搜索/附件拒绝访问，失败事务不留下独立 Job/Audit，旧 Worker 不能覆盖新租约结果。

## 3. 前端如何写

Views 测试挂载真实 Router/QueryClient 所需的最小环境，用键盘、点击和输入驱动 UI。每个测试新建 QueryClient，避免缓存串到下一个用户或用例。

MSW 只替代 HTTP 边界，返回与生成 contract 一致的样例；不 mock 自己的业务 hooks、状态管理或内部组件。API 返回错误和延迟时，测试用户看到的 loading/empty/error/success/forbidden/conflict 状态。

| 页面 | 最小有价值的验证 |
| --- | --- |
| 注册/登录 | 输入校验、提交状态、失败提示、成功进入写作；不显示邀请要求 |
| 我的文档 | 首次空状态、新建入口、列表/搜索；切换身份后不保留上一用户的资源 |
| Markdown 编辑 | 输入、预览、保存、未保存提示、危险 HTML/URL 的处理 |
| 保存冲突 | 服务端 409 时保留用户输入，允许读取最新版本，不自动覆盖 |
| 附件 | 上传中/失败/重试、完成后的附件、无权下载、链接到期反馈 |
| 库级权限 | Reader 只读、Editor 可编辑、授权变更后的刷新；权限最终由后端判断 |
| 导出/通知 | queued/running/succeeded/failed/expired 的可见状态，点击通知到结果 |

优先 role/label/text 等面向用户的查询与断言，不用大 DOM snapshot 固定实现结构。CSS 调整、文案排版等低风险修改不强制新增镜像测试；键盘、焦点、错误反馈属于真实交互合同。

## 4. 哪些场景必须真实 E2E

少量关键旅程使用 Playwright 和真实应用组合，不能把全部 API 请求 intercept 成假响应。

1. 两个用户从注册页面注册，普通用户可直接新建、保存并再次打开自己的 Markdown。
2. 用户上传附件到 RustFS，从应用取得授权下载并比对实际内容。
3. 另一个账号不能读私有文档；获得 Reader 后能读不能改，撤权后再被拒绝。
4. 两个浏览器页面编辑同一版本，后保存者看到冲突并保留未保存文本。
5. 申请导出后真实 Worker 生成 ZIP；解压校验正文/附件，通知可读，重复请求不重复产物。
6. 删除附件后应用立即不再提供访问，真实 Worker 最终清理对象。
7. 密码重置从邮件捕获服务取得一次性链接，旧 Session 随后失效；邮件失败不阻塞普通注册。

Worker 崩溃、过期租约、事务回滚的详细组合以集成测试承担；浏览器只保留能说明用户结果的恢复路径，避免把整个故障矩阵塞入慢 E2E。

## 5. 一个行为如何分层，而不重复

以“Reader 无权编辑文档”为例：

- HTTP 测试：Reader 发出更新请求得到 403，通过读取接口确认正文与版本未改变。
- View 测试：Reader 看到只读正文，写入控件不可操作；服务端拒绝时页面有正确反馈。
- E2E：真实管理员赋予 Reader 后，另一个浏览器账号可读不可写，证明鉴权、Cookie、路由与页面组合正确。

三层各自观察不同风险。角色与 Grant 的所有组合在后端测试，前端和浏览器不重做同一张权限矩阵。

## 6. 稳定性与隔离

- 并发场景使用受控 barrier/同步点组织竞态，不依赖任意 sleep 碰运气。
- 时限、租约和重试使用可控时钟或可调整测试配置；真实 E2E 用有截止时间的状态等待。
- 数据库、Redis key、RustFS bucket/prefix、邮件捕获队列和浏览器 storage 按测试隔离。
- 测试只清理自己创建的资源，不复用开发或生产数据目录。
- 失败保存 API/Worker 日志、request/job/trace ID、Playwright trace 与必要截图；不保存密码、token 或完整签名 URL。
- 重试不能把不稳定测试悄悄当成成功；报告首次失败及重试情况，修复根因。

## 7. TDD 与 GitHub 票的关系

每张票是一个可演示的完整行为，按 `/implement → /tdd → /code-review` 执行：

1. 读取 Issue 全文、评论、原生 blockers、领域术语及相关 ADR。
2. 核对这张票的公开测试入口与验收行为。
3. 先写一个失败的行为测试，运行确认失败原因正确。
4. 实现让该测试通过的最小纵向路径，再继续下一条行为；不先批量编写全部想象中的测试。
5. 修改过程中常跑定向测试和类型检查；完成时运行相应整体门禁。
6. 同时更新 example、在线教程、生成合同和能力覆盖矩阵。
7. 按 Standards + Spec 两轴 review，修复问题并提交，再通过 PR 的验证结果完成票。

这次工作先产出测试方案和票，不把没有应用代码的状态描述为已经完成 TDD。后续每票从新上下文读取自足的验收条件，避免依赖本次聊天才能实施。

## 8. CI 分工与门禁

| 时机 | 检查 |
| --- | --- |
| 编辑循环 | 相关 Rust 测试 / Vitest 文件、类型检查、生成 contract 的必要校验 |
| 每张功能 PR | fmt/lint/typecheck、必要单元/真实集成、View 测试、contract drift、docs、边界、perf-ci、build、关键 E2E |
| 默认 `just check` | 与该阶段已实现行为一致的主门禁；缺少未实施能力时说明当前阶段，不运行空脚本冒充通过 |
| GUI CI job | Electron 壳 smoke、preload/IPC 与 shared views 接线 |
| nightly/release | 大数据 query plan、load/saturation/trajectory/soak、Desktop 资源增长 |
| 独立 Mobile 检查 | Mobile skeleton 和共享合同；不污染默认 Web/Rust 循环 |
| 删例验收 | 临时工作副本实际移除 example，重建合同、迁移空库、测试 Core、构建文档 |

测试覆盖率用于发现遗漏，不以随意的 100% 行覆盖替代风险矩阵。query 数量、响应大小与 bundle 大小属于稳定性能门禁；跨机器 P95/P99 进入趋势报告。
