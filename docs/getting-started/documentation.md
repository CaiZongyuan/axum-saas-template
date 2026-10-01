# 用 Dougong 开发自己的 SaaS

从 Rust + Axum 后端开始，实现自己的业务模块，接入身份、数据库、审计、文件与后台任务，再交付能够验证和部署的 API。

<div class="docs-paths">
  <a class="docs-path" href="../learn/"><strong>从头开发一个业务</strong><span>开发工单 SaaS 后端，逐步接入数据、权限、文件与后台任务。</span></a>
  <a class="docs-path" href="../architecture/project-structure"><strong>已有后端经验</strong><span>先了解代码归属，再按数据库、接口、用例与测试进入开发指南。</span></a>
  <a class="docs-path" href="../reference/api"><strong>正在使用框架</strong><span>查阅公共 API、配置、模块接入和运行命令。</span></a>
</div>

## 框架提供什么，你负责什么

| 框架能力                           | 自己的业务负责                         |
| ---------------------------------- | -------------------------------------- |
| 身份、Session、成员与企业角色      | 实体、业务规则与资源访问范围           |
| 配置、连接池、迁移入口、统一错误   | 用例、业务事务与 HTTP 合同             |
| 审计、幂等、文件、任务、通知和邮件 | 操作的审计语义、文件归属和任务 Handler |
| OpenAPI、生成 SDK、测试与部署入口  | 业务接口的验证、生产配置和运行维护     |

当前每次部署服务一家 Organization。企业内部可以有多个成员和业务资源；多家客户企业共享一份部署需要重新设计企业上下文与访问合同，见[部署范围决策](../adr/0001-single-organization-deployment.md)。

## 从一条业务请求建立心智模型

```text
HTTP / 请求 DTO
  → 自己的业务用例
  → Core 公共接口与事务
  → PostgreSQL / Platform 适配器
  → 响应 DTO / OpenAPI
```

应用入口组合 Router 与 OpenAPI；模块拥有规则和表；Core 提供可复用 SaaS 能力；Platform 封装基础设施。具体位置见[项目结构](../architecture/project-structure.md)，边界见[Core 与业务模块](../architecture/module-boundaries.md)。

## 先运行，再开发

按[快速开始](quickstart.md)准备工具，再进入[工单 SaaS 课程](../learn/index.md)，在独立副本中逐步实现 `tickets` 模块。四个检查点可以运行完整代码，十课围绕同一业务学习数据库、协议、授权、事务、文件、任务、验证与部署。[新增业务模块](../guides/develop-module.md)提供简明接入指南。

每份指南提供要修改的位置、公开接口、最小代码、可观察结果和失败边界。生成的 [API](site:reference/api.md)与[配置](site:reference/config.md)保持实现为唯一事实来源。

<!-- example:knowledge:documentation:start -->

## 查阅完整参考实现

内置知识库串联了业务 CRUD、资源授权、附件、导出、通知与审计。读它的实现来理解怎样组合 Core，再将领域规则替换为自己的业务。可以从[文档用例](../tutorials/04-personal-documents.md)、[资源权限](../tutorials/07-library-grants.md)和[任务导出](../tutorials/10-document-exports.md)查阅一条完整链路。

<!-- example:knowledge:documentation:end -->

## 客户端与贡献

后端合同完成后，按[客户端共享](../tutorials/20-electron-shell.md)与[业务贡献](../tutorials/27-add-example.md)接入 Web 和 Electron。文档提供中文与英文，同页语言切换保留章节，搜索只覆盖公开文档。

修改文档时阅读[作者规范](../guides/maintain-docs.md)，发布自己的站点见[发布指南](publish-docs.md)。
