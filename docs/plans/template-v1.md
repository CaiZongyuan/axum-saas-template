# Template v1 GitHub 实施计划

目标仓库：[CaiZongyuan/axum-saas-template](https://github.com/CaiZongyuan/axum-saas-template)。已发布并核验 [总规格 Issue](https://github.com/CaiZongyuan/axum-saas-template/issues/1)、28 张实施票与 44 条原生阻塞关系。GitHub 是正式 tracker，实时状态以 GitHub 为准；本地文件保留为发布依据。

范围依据：[架构规范](../saas-template-architecture-spec.md)、[测试方案](../testing/strategy.md)和已记录 ADR。每票是可演示/验证的纵向行为，包含必要的 schema/API/UI/测试/在线教程；部署、文档和工程工具票以可运行的操作结果作为完整路径，不人为添加业务表。

流程：确认测试入口与拆分 → 发布总 spec 与 28 张实施票 → 建立 GitHub 原生 blocked-by 关系 → 只领取 blockers 已完成的票 → 每票 implement/TDD/review/提交。规格 Issue 只作为来源，不作为一个可一口气领取的实施任务。

## 编号拆分

1. **T01 — 启动首条全栈请求并提供可运行的入门文档**
   - **Blocked by**：无，可立即开始。
   - **交付**：开发者从空仓库启动 Web、Axum 与 PostgreSQL，在页面看到由真实 API 返回的服务状态，并能打开文档预览和运行最小 CI。
   - [GitHub #2](https://github.com/CaiZongyuan/axum-saas-template/issues/2)。

2. **T02 — 用户通过注册页创建账号并获得会话**
   - **Blocked by**：T01。
   - **交付**：用户自行填写邮箱和密码注册，成功后进入已登录首页；首个成功注册的账号初始化企业 Owner，后续账号为 Member。
   - [GitHub #3](https://github.com/CaiZongyuan/axum-saas-template/issues/3)。

3. **T03 — 用户登录、退出并正确处理会话过期**
   - **Blocked by**：T02。
   - **交付**：已有用户可以登录、刷新页面保持会话、退出以及在会话过期后重新登录，页面与后端对当前身份一致。
   - [GitHub #4](https://github.com/CaiZongyuan/axum-saas-template/issues/4)。

4. **T04 — 注册用户直接创建并重新读取自己的文档**
   - **Blocked by**：T02。
   - **交付**：普通用户进入“我的文档”即可写第一篇 Markdown，不等待管理员建库；刷新后仍能读到自己的文档。
   - [GitHub #5](https://github.com/CaiZongyuan/axum-saas-template/issues/5)。

5. **T05 — 浏览、查找并安全预览 Markdown 文档**
   - **Blocked by**：T04。
   - **交付**：用户可以从文档列表按标题关键词找到自己的内容，并在编辑与阅读界面预览 Markdown。
   - [GitHub #6](https://github.com/CaiZongyuan/axum-saas-template/issues/6)。

6. **T06 — 编辑文档并保护未保存内容与并发冲突**
   - **Blocked by**：T04。
   - **交付**：用户显式保存修改；两个页面同时编辑时，较晚的冲突保存保留本地文本并提示读取最新版本。
   - [GitHub #7](https://github.com/CaiZongyuan/axum-saas-template/issues/7)。

7. **T07 — 按知识库授予 Reader/Editor 并撤销访问**
   - **Blocked by**：T03、T05、T06。
   - **交付**：管理员可以给现有用户授予共享知识库的 Reader 或 Editor；用户只看到自己有权访问的知识，撤权后访问被拒绝。
   - [GitHub #8](https://github.com/CaiZongyuan/axum-saas-template/issues/8)。

8. **T08 — 管理企业成员并保护最后一位 Owner**
   - **Blocked by**：T03。
   - **交付**：企业管理员查看成员、调整允许的角色或停用成员；任何并发操作都不会让企业失去最后一位有效 Owner。
   - [GitHub #9](https://github.com/CaiZongyuan/axum-saas-template/issues/9)。

9. **T09 — 通过 RustFS 上传并授权下载文档附件**
   - **Blocked by**：T07。
   - **交付**：有编辑权限的用户从文档页面上传附件，完成后可引用和下载；无权访问文档的人无法取得附件链接。
   - [GitHub #10](https://github.com/CaiZongyuan/axum-saas-template/issues/10)。

10. **T10 — 将当前文档与附件作为后台任务导出 ZIP**
   - **Blocked by**：T09。
   - **交付**：用户点击导出后立即看到任务进度，真实 Worker 将请求时的 Markdown 与附件生成 ZIP 存入 RustFS，并允许授权下载。
   - [GitHub #11](https://github.com/CaiZongyuan/axum-saas-template/issues/11)。

11. **T11 — Worker 崩溃后恢复导出并限制失败重试**
   - **Blocked by**：T10。
   - **交付**：运行中的导出遇到 Worker 重启或临时失败后能够恢复；达到预算后停止重试，管理员可以查看失败并显式重试。
   - [GitHub #12](https://github.com/CaiZongyuan/axum-saas-template/issues/12)。

12. **T12 — 删除知识库、文档与附件并可靠清理对象**
   - **Blocked by**：T11。
   - **交付**：用户确认删除后资源立即从应用中不可见，后台可靠清理附件和过期导出，失败后可恢复且没有回收站流程。
   - [GitHub #13](https://github.com/CaiZongyuan/axum-saas-template/issues/13)。

13. **T13 — 用导出完成通知学习站内消息与已读状态**
   - **Blocked by**：T11。
   - **交付**：用户在通知入口看到自己导出的完成或失败结果，打开后跳到有权限的导出详情，并能标记已读。
   - [GitHub #14](https://github.com/CaiZongyuan/axum-saas-template/issues/14)。

14. **T14 — 管理员从审计页面追溯真实业务操作**
   - **Blocked by**：T07、T08。
   - **交付**：管理员可以按资源和动作查看注册、文档、权限或成员变更的审计记录，并用关联 ID 定位请求。
   - [GitHub #15](https://github.com/CaiZongyuan/axum-saas-template/issues/15)。

15. **T15 — 用 API Key 访问受限文档并即时撤销**
   - **Blocked by**：T07、T08。
   - **交付**：用户创建只展示一次 secret 的 API Key，用脚本读取其有权访问的文档，撤销 key 或账号权限后调用失败。
   - [GitHub #16](https://github.com/CaiZongyuan/axum-saas-template/issues/16)。

16. **T16 — 在授权文档读取中演示 Redis 缓存与回源**
   - **Blocked by**：T12。
   - **交付**：用户读取文档时可以命中真实缓存，编辑、撤权、删除或 Redis 故障都不会返回越权或错误版本的内容。
   - [GitHub #17](https://github.com/CaiZongyuan/axum-saas-template/issues/17)。

17. **T17 — 限制注册和请求频率并在 Redis 故障时降级**
   - **Blocked by**：T03。
   - **交付**：请求过于频繁时，用户得到一致的 429 与重试提示；Redis 暂时不可用时仍保留单机保守限流。
   - [GitHub #18](https://github.com/CaiZongyuan/axum-saas-template/issues/18)。

18. **T18 — 通过异步邮件找回密码并撤销旧会话**
   - **Blocked by**：T11、T17。
   - **交付**：用户从找回密码页面申请邮件，使用一次性链接设置新密码，旧会话随之失效；邮件故障不影响普通注册写作。
   - [GitHub #19](https://github.com/CaiZongyuan/axum-saas-template/issues/19)。

19. **T19 — 从一次导出追踪 API、Worker 与对象存储**
   - **Blocked by**：T11。
   - **交付**：开发者运行观测 profile 后，能从导出请求关联到 Job、RustFS 操作、日志和指标，并据此定位失败。
   - [GitHub #20](https://github.com/CaiZongyuan/axum-saas-template/issues/20)。

20. **T20 — Electron 安全壳复用已有知识库页面**
   - **Blocked by**：T03、T05。
   - **交付**：桌面用户在 Electron 中完成登录、文档浏览与 Markdown 预览，使用与 Web 相同的业务 Views 和 API 合同。
   - [GitHub #21](https://github.com/CaiZongyuan/axum-saas-template/issues/21)。

21. **T21 — Mobile skeleton 复用合同并独立检查**
   - **Blocked by**：T01。
   - **交付**：开发者可以单独启动原生 skeleton 调用同一 SDK 的状态接口，学习共享合同与平台适配而不增加默认开发工具链负担。
   - [GitHub #22](https://github.com/CaiZongyuan/axum-saas-template/issues/22)。

22. **T22 — 将知识库部署到单机并验证启停与降级**
   - **Blocked by**：T12、T18。
   - **交付**：运维人员按在线教程启动单机生产组合，经 Caddy 访问注册、文档与附件，进程重启和非核心依赖故障按明确规则恢复。
   - [GitHub #23](https://github.com/CaiZongyuan/axum-saas-template/issues/23)。

23. **T23 — 备份后在独立环境恢复文档、附件和任务**
   - **Blocked by**：T22。
   - **交付**：运维人员按维护窗口备份数据库和其引用的 ready 对象，在独立空环境恢复并验证用户内容和任务状态。
   - [GitHub #24](https://github.com/CaiZongyuan/axum-saas-template/issues/24)。

24. **T24 — 实际移除 example 后继续使用 Core**
   - **Blocked by**：T13、T15、T16。
   - **交付**：模板使用者预览并执行示例移除，在新工作副本和空数据库中继续注册/登录并使用 Core，同时能构建正确的合同与文档。
   - [GitHub #25](https://github.com/CaiZongyuan/axum-saas-template/issues/25)。

25. **T25 — 建立确定性的 API、数据库与前端性能门禁**
   - **Blocked by**：T16。
   - **交付**：开发者在 PR 中得到可复现的查询、响应与 bundle 预算结果，性能退化可以被指出且不会依赖共享 runner 的偶然延迟。
   - [GitHub #26](https://github.com/CaiZongyuan/axum-saas-template/issues/26)。

26. **T26 — 重放知识库轨迹并报告负载、饱和与长测**
   - **Blocked by**：T17、T19、T25。
   - **交付**：开发者用统一命令重放注册、文档、附件与导出轨迹，看到吞吐、延迟、错误、连接池、队列和内存随负载变化的报告。
   - [GitHub #27](https://github.com/CaiZongyuan/axum-saas-template/issues/27)。

27. **T27 — 用 Desktop soak 发现持续资源增长**
   - **Blocked by**：T20、T25。
   - **交付**：开发者循环浏览文档、刷新和开关弹窗，得到 Electron renderer 的内存与资源趋势，发现持续增长。
   - [GitHub #28](https://github.com/CaiZongyuan/axum-saas-template/issues/28)。

28. **T28 — 发布与当前实现一致的完整在线教程和 v1 验收**
   - **Blocked by**：T14、T21、T23、T24、T26、T27。
   - **交付**：读者能打开在线站点，从注册写文档学到模板能力，再仿照流程实现自己的业务并移除 example；每个步骤对应实际发布版本。
   - [GitHub #29](https://github.com/CaiZongyuan/axum-saas-template/issues/29)。

## 共同验收与依赖解释

- 每张票都按公开测试入口验证行为；前后端测试与在线教程随功能交付，不另建一个最后补测试/教程的大票。
- T01 是空仓库的最小可运行全栈路径，并承担必要骨架；T02/T03 从真实注册与会话扩展，而不是分别建“后端所有接口”和“前端所有页面”票。
- 第一条完整后台场景是 T10 文档导出；T11 验证崩溃/重试恢复，后续清理、重置邮件、通知复用它。
- T24 必须实际删除 example 再运行 Core；所有权清单从前面的功能票持续更新。
- T28 验证此前已同步发布的各章能连成学习路径，不能替其他票补欠缺的功能文档。
- 原生 blocking 只表达真实前置条件，不把所有票串成一条线；发布时保留正文 Blocked by 引用便于人读。

## 审阅与发布结果

用户已确认按本拆分、依赖和公开测试入口发布。每张实施票均已回读核验正文、标签和原生 blockers；实施仍按未完成依赖决定可领取前沿。
