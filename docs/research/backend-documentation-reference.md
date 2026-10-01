# 从 FastAPI Boilerplate 借鉴 SaaS 后端文档

查证日期：2026-10-01。问题：文档怎样教读者使用 Dougong 开发自己的 SaaS 后端，而不是操作内置知识库产品？来源为用户指定的官方在线文档及其导航中的相邻页面；只研究文档组织和教学方法，未运行参考项目。

## 已核实的教学方式

| 页面                                 | 实际内容                                                                                                                               | 可迁移的方法                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Project Structure][structure]       | 从仓库根目录进入后端目录，解释配置文件、功能模块、迁移和测试；再给出新增功能步骤与 HTTP → route → service → CRUD → database 的数据流。 | 项目结构页回答“代码放哪里、依赖往哪里走、加功能要改哪里”，不能只列目录。使用 Dougong 的真实路径和调用关系重写。 |
| [Development][development]           | 运行 API 和 Worker、开发检查、新增模块、配置扩展、调试、常见错误和关键文件；链接 Models、Schemas、Endpoints 的具体代码。               | 为日常开发提供任务入口，把一个完整新增业务流程与按主题查阅的指南相互链接。                                      |
| [Models][models]、[Schemas][schemas] | 新模型从建文件、迁移生成、人工检查到应用迁移；请求、内部写入和响应分别建模，解释敏感字段为何不公开。                                   | 从业务数据与迁移起步，说明输入校验、持久化结构和公共 API 响应的边界，每一步给出修改文件与验证方式。             |
| [CRUD Operations][crud]              | 展示增查改删、存在性检查、筛选、分页、软删除、关联查询、字段选择与更新前业务校验。                                                     | 将数据访问放进读者的业务流程，解释约束、事务、查询形状和授权，而不是把数据库 API 当教程主线。                   |
| [Endpoints][endpoints]               | `widgets` 的模型、Schema、CRUD、Service、Route、权限、路由挂载、迁移及 `curl` 验证；明确请求入口与业务错误到 HTTP 错误的转换。         | 新业务模块教程需要从源码位置走到可调用的接口；完成标准是请求与响应可验证。                                      |
| [Authentication][authentication]     | 按登录必需、可选身份、权限、API Key 等使用场景解释接口保护；当前默认采用服务端 Session、HttpOnly Cookie 和 CSRF。                      | 先教读者如何复用身份与授权上下文，再解释机制；业务接口应展示匿名、越权和成功请求。                              |
| [Background Tasks][tasks]            | 解释适用场景，接着讲任务所在模块、任务发现、入队、Worker、重试、监控及排错。                                                           | 贯穿“提交请求 → 查询任务状态 → Worker 执行 → 失败恢复”，并明确任务与 HTTP 请求的不同生命周期。                  |
| [Testing][testing]                   | 区分单元与真实数据库 HTTP 测试，给出 fixture、注册/登录/当前用户流程、Cookie/CSRF、缓存与任务测试、命令和排错。                        | 测试章围绕公开行为与必要的真实依赖展开；身份、数据隔离和异步任务不能只给配置清单。                              |
| [Production][production]             | 给出部署配置、镜像、迁移顺序、独立 Worker、代理、日志、健康检查、扩容及具体故障入口。                                                  | 将本地完成的业务带到部署与运行，以仓库真实脚本和运行合同收尾。                                                  |
| [First Run][first-run]               | 先检查服务和健康，再用请求验证登录、当前用户、注销与首个功能模块，最后链接后续指南。                                                   | 快速开始以可观察的后端请求结果结束，直接进入“开始开发自己的业务”。                                              |

参考站导航把 Getting Started 与 User Guide 分开；User Guide 按项目结构、配置、数据库、API、认证、缓存、后台任务、限流、开发、生产、测试组织。页面左侧提供章节导航，右侧提供本页目录，正文底部有前后页入口。[Project Structure][structure]

## 借鉴边界

- `interfaces / infrastructure / modules`、`models.py / schemas.py / crud.py / service.py / routes.py` 是参考项目的 Python 架构，不是 Dougong 的目录规范。Dougong 当前共享基础设施在 `crates/platform`，SaaS Core 在 `crates/app`，API/Worker 入口在 `apps`；文档必须依据源码说明实际边界。[本仓库 Platform][local-platform]、[本仓库 Core 组装][local-core]
- FastCRUD、SQLAlchemy、Pydantic、Alembic、FastAPI `Depends`、Taskiq 的代码不能照抄；应该保留“位置 → 最小改动 → 请求验证 → 失败检查”的教学结构。[Development][development]、[Endpoints][endpoints]
- 参考站当前默认认证已经从 JWT 切换为 Session，JWT Bearer 只作为可选 transport 介绍。此处仅记录文档现状，不据此修改 Dougong 的认证架构。[Authentication][authentication]
- 参考项目的 Tier、订阅分层、管理面板及工作空间代码不能推导为 Dougong 已交付的能力。Dougong 每次部署只服务一个 Organization；新增参考业务仍属于同一企业，不提供多租户切换或计费实现。[单企业部署 ADR][single-org]、[组合 ADR][composition]
- 参考文档自身存在一致性问题：Project Structure 将 `tests/unit`、`tests/integration` 描述为已有布局，而 Testing 仍写着没有随附示例测试；Models 要求显式登记模型，Project Structure 又强调自动发现。只能借鉴教学方法，不能把参考页当成本仓库实现证据。[Project Structure][structure]、[Testing][testing]、[Models][models]

## 建议的后端优先目录

以下是根据这些页面的教学模式提出的文档设计，不是新增功能承诺。工单可以作为读者自己编写的业务练习；内置 Knowledge 与 Notes 仍是可运行、可移除的参考业务，不应声称已有 Tickets 模块。[参考应用 ADR][reference]

1. **开始使用**：创建自己的项目、配置依赖、启动 API/Worker、完成健康与身份请求验证。
2. **项目结构**：Core、Platform、Reference Domain 和应用入口；请求与后台任务的调用路径；新增业务放哪里。
3. **构建自己的业务**：以一个小型工单后端串联业务模型、迁移、API 输入输出、数据访问、路由组装、错误和公开接口测试。
4. **复用 SaaS Core**：Session、Organization/Membership、资源授权与 API Key；围绕同一业务接口演示成功和拒绝请求。
5. **接入后端能力**：按业务需要加入附件、Jobs、通知、审计、缓存、限流与可观测性；只写源码已实现的接入方式。
6. **测试与交付**：使用现有公开测试接口验证业务、移除或替换内置示例、部署迁移、备份恢复与排错。
7. **参考与可选扩展**：配置、HTTP/OpenAPI、任务、CLI 等查阅入口；Web、Desktop 和通用应用壳作为后端之后的扩展路径。

每节以一个开发目标开始，给出实际路径、最小代码或命令、预期响应、一个关键失败检查，以及下一步。完整跟做教程与按能力查阅的指南共用同一组可执行证据，避免把内置产品的使用说明当成框架开发教程。[First Run][first-run]、[Development][development]、[Endpoints][endpoints]

## 查证边界

所有表中页面均已读到正文。Database 总览与 Testing 在直接文本读取时偶有空输出，改用独立浏览器会话读取渲染 DOM 后成功；没有最终无法访问的页面。在线站点可持续更新，本文记录查证日的页面内容；没有验证参考代码是否与文档完全一致，也没有验证其示例命令。

[structure]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/project-structure/
[development]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/development/
[models]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/database/models/
[schemas]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/database/schemas/
[crud]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/database/crud/
[endpoints]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/api/endpoints/
[authentication]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/authentication/
[tasks]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/background-tasks/
[testing]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/testing/
[production]: https://benavlabs.github.io/FastAPI-boilerplate/user-guide/production/
[first-run]: https://benavlabs.github.io/FastAPI-boilerplate/getting-started/first-run/
[local-platform]: ../../crates/platform/src/lib.rs
[local-core]: ../../crates/app/src/lib.rs
[single-org]: ../adr/0001-single-organization-deployment.md
[reference]: ../adr/0002-executable-removable-reference.md
[composition]: ../adr/0003-static-example-composition.md
