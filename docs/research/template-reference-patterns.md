# 模板示例与在线教程：两个参考仓库的做法

查证日期：2026-09-25。目的：为“简单、可运行、覆盖核心能力、易替换的教学 example”寻找一手依据。只借鉴组织与教学方式，不引入 Python 技术栈。

本次固定读取两个仓库快照，以下文件引用均指向对应 commit：

- `fastapi/full-stack-fastapi-template`：`cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7`。
- `benavlabs/fastapi-boilerplate`：`765efecb466e343d5254cff66da4f9f84d4c8fd0`。

## 1. 已核实的来源事实

| 方面 | Full Stack FastAPI Template | Benav Labs FastAPI Boilerplate |
| --- | --- | --- |
| 示例业务规模 | `Item` 只有标题、可选描述、所有者、ID 和创建时间；提供列表、详情、新增、修改、删除。普通用户操作自己的 Item，超级用户可以操作全部 Item。[模型][f-models]、[路由][f-items] | 当前模块主要是用户、Tier、限流规则、API Key；开发教程用 `widgets` 演示新增业务模块，并未要求完整复杂行业应用。[目录说明][b-structure]、[开发教程][b-development] |
| 注册 | 提供无需先登录的 `/users/signup`，独立于管理员创建用户接口。[用户路由][f-users] | First Run 明确提供无需认证的创建用户请求，再演示登录、当前用户和注销。[首次运行][b-first] |
| 前后端学习路径 | README 指向后端、前端、开发和部署文档。后端文档说明模型、API、CRUD 与迁移的修改位置；前端文档说明生成 API Client、代码目录与 E2E 测试。[README][f-readme]、[后端指南][f-backend]、[前端指南][f-frontend] | 文档从安装、配置、首次运行进入项目结构、数据库、API、认证、缓存、后台任务和测试；“Adding a New Module”依次讲模型、Schema、CRUD、Service、路由、注册和迁移。[导航配置][b-nav]、[开发教程][b-development] |
| 测试示例 | 有后端 Item 路由测试，也有 Playwright 新增、编辑、删除、校验和空状态用例。[后端测试][f-tests]、[浏览器测试][f-e2e] | 仓库包含单元和集成测试目录；但同一快照的开发教程仍写着“doesn't ship example tests yet”，文档存在落后于代码的迹象，不能照抄该描述。[开发教程][b-development]、[测试目录][b-tests] |
| 在线文档 | 根 README 主要链接仓库内 Markdown，以及运行服务后的交互 API 文档；本次检查的入口没有展示单独的完整在线教程站。[README][f-readme]、[后端指南][f-backend] | README 有独立[在线文档站][b-site]；站点源文件在 `docs/`，配置为 `zensical.toml`；GitHub Actions 构建并发布 GitHub Pages。[README][b-readme]、[导航配置][b-nav]、[发布工作流][b-docs-ci] |

### 删除与替换，实际找到了什么

Full Stack 模板明确写了两种操作：

1. 后端指南允许在**尚无既有迁移历史的新项目起点**删除或修改默认模型，移除默认 revision 文件后重新生成首次迁移。这不是已有生产数据库的删表或升级教程。[后端指南][f-backend]
2. 前端指南逐项说明怎样移除整个前端，包括目录、服务挂载、Docker 构建阶段和 CI 步骤。这不是仅移除 Item 示例业务的脚本。[前端指南][f-frontend]

其 Item 模型与 User 模型位于同一文件，User 删除接口也直接引用 Item，所以仅删除 `items.py` 并不能完整移除示例。[模型][f-models]、[用户路由][f-users]

Benav 的目录指南强调每个功能模块集中自己的模型、Schema、CRUD、Service 和路由，并通过统一入口注册；开发指南还介绍用配置关闭缓存、管理后台等基础设施。前者是组织原则，后者是禁用子系统；都不能当作已交付的“删除所有示例业务”工具。[目录说明][b-structure]、[开发教程][b-development]

在本次读取的 README、目录树、开发指南及相关文档中，**未找到两个仓库提供完整删示例脚本的说明**。不据此声称所有历史版本或未检查文件中都不存在。

## 2. 对本模板的建议

以下是结合用户目标的设计建议，不是参考仓库已有能力，也不是本仓库已经完成的实现。

### 用一条短旅程覆盖技术能力

建议主体旅程保持为：**注册 → 登录 → 写 Markdown → 保存并预览 → 上传/下载附件 → 查询与修改自己的内容 → 删除内容**。知识库组织、发布或分享等能力若保留，应能够解释具体教学价值；不需要为了展示权限而引入邀请、审批或复杂企业组织流程。

通过同一旅程分别解释：

- 身份与 Session：注册、登录、退出和找回密码。
- 业务模块：文档的数据模型、迁移、输入校验、API、前端页面与测试。
- 授权：服务端检查内容所有权或选定的共享规则；前端按钮不是权限边界。
- 文件：附件记录保存在数据库，文件内容保存在 RustFS，通过对象存储接口衔接业务。
- 后台任务：发信、附件清理直接使用 Jobs；教程演示一次失败、重试和恢复，不必增加复杂业务。
- API Key、缓存、审计、限流与可观测性：围绕同一份文档给出脚本、日志与操作练习，无需为每项能力增加产品页面。

建立“能力 → 示例入口 → 教程章节 → 验证方式”表，清楚标注默认交付和后续扩展，避免用业务复杂度衡量模板完整度。

### 让易移除成为验收条件

Core 提供身份、文件、任务等通用能力，example 持有文档等业务规则；依赖方向必须是 example 使用 Core。把示例的后端、前端页面、迁移、数据、任务处理器、测试及挂载位置列成一份清单。

实施时同时提供移除教程与可执行演练：从模板副本去掉示例后，Core 仍能启动、登录，基础测试仍通过，并且能接入读者自己的业务模块。关闭菜单或 feature flag 只能验证停用，不能单独证明可以删代码。

删除教程区分“新项目尚无数据”和“已有部署数据”两种情况。前者可创建干净初始迁移；后者保留已执行迁移历史，用后续迁移与清理步骤处理，不把改写历史当成常规操作。

### 在线教程与代码同时交付

建议在线站点提供四类内容：

1. **快速开始**：复制模板、配置环境、启动、完成第一篇文档与附件操作。
2. **跟做教程**：按真实提交步骤构建这个 example，每章包含目标、修改文件、可运行命令、预期结果和失败检查。
3. **实现自己的业务**：沿着模型 → 迁移 → 授权 → API → Client → 页面 → 文件/Jobs → 测试的同一条路径修改或新增模块。
4. **移除示例与参考手册**：完整移除演练；配置、API、任务、存储、部署和排错细节作为查阅入口。

在线教程与交互 API 文档承担不同职责，二者都要有入口。每个功能 PR 同步更新相关教程；CI 构建站点、检查链接，执行关键教程命令及移除示例演练。版本或提交信息应能让读者知道教程适用于哪份代码。本项目 spec 已选用 VitePress；本次研究没有实现或发布站点。

## 3. 查证边界

本次只读取官方仓库与其官方文档入口，没有运行这两个项目、测量性能或审计全部模块间依赖。在线站点会随主分支更新；固定 commit 引用用于复核本笔记的事实，不代表推荐锁定这些参考项目的版本。

[f-readme]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/README.md
[f-models]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/app/models.py
[f-items]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/app/api/routes/items.py
[f-users]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/app/api/routes/users.py
[f-backend]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/README.md
[f-frontend]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/frontend/README.md
[f-tests]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/backend/tests/api/routes/test_items.py
[f-e2e]: https://github.com/fastapi/full-stack-fastapi-template/blob/cb740b656d7a0a6c5e12c7bf8e50343ec94ee9c7/frontend/tests/items.spec.ts
[b-readme]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/README.md
[b-structure]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/docs/user-guide/project-structure.md
[b-development]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/docs/user-guide/development.md
[b-first]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/docs/getting-started/first-run.md
[b-tests]: https://github.com/benavlabs/fastapi-boilerplate/tree/765efecb466e343d5254cff66da4f9f84d4c8fd0/backend/tests
[b-nav]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/zensical.toml
[b-docs-ci]: https://github.com/benavlabs/fastapi-boilerplate/blob/765efecb466e343d5254cff66da4f9f84d4c8fd0/.github/workflows/docs.yml
[b-site]: https://benavlabs.github.io/FastAPI-boilerplate/
