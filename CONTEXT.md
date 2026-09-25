# SaaS Template

这套模板以企业知识库作为可替换的参考应用，展示可复用的 SaaS 基础能力。每个客户企业有自己的成员和知识，企业内部用多个知识库组织内容。

## Language

**SaaS Core（SaaS 核心）**：
不同参考业务可以共同使用的身份、成员关系、权限等 SaaS 基础能力。它不包含某个参考业务专有的业务规则。
_Avoid_: Reference Domain、Example

**Reference Application（参考应用）**：
模板的可运行教程，用少量业务对象串联大多数核心能力，供使用者仿照完整流程实现自己的业务。它也是测试与验收的共同对象，示例业务可以移除。
_Avoid_: 独立 toy demo

**Reference Domain（参考业务）**：
参考应用中可以替换的具体业务模型和规则，本项目选择知识的编写、组织、查阅及导出。替换参考业务不等于删除 SaaS Core。
_Avoid_: SaaS Core、整套模板

**Knowledge Base（知识库）**：
企业内部用于组织相关知识的集合，包含可供成员维护和查阅的文档。它属于参考业务，不等同于客户企业本身。
_Avoid_: Workspace、Tenant

**Document（文档）**：
知识库中具有独立标题和正文、由成员在线编写的知识条目。文档可以附带文件，但不等同于这些文件。
_Avoid_: File、附件

**Personal Knowledge Base（个人知识库）**：
用户默认用于编写自己文档的知识库，属于当前企业并沿用知识库权限规则。它不代表另一个租户或组织。
_Avoid_: 个人租户、独立企业

**Organization（企业）**：
使用本应用的一家企业，也是成员和知识库共同归属的客户组织。企业内部的多个知识库不构成多个 Organization。
_Avoid_: Workspace、Knowledge Base

**User（用户）**：
通过注册页面创建、可用邮箱与密码登录本企业应用的个人身份。
_Avoid_: Organization、Account（含义不明确）

**Membership（企业成员身份）**：
用户属于本企业的关系，包含其在企业内承担的角色。具体知识库的访问资格与企业成员身份需要区分。
_Avoid_: User、知识库权限

**Knowledge Base Grant（知识库授权）**：
授予企业成员在某个知识库中阅读或编辑内容的资格。库内文档与附件继承这一访问范围。
_Avoid_: Membership、逐篇文档授权

**Attachment（附件）**：
附属于文档、供成员查看或下载的文件。附件不是另一篇在线编写的知识文档。
_Avoid_: Document

**Document Export（文档导出）**：
某次请求时点的文档与附件的可下载副本，用于带走或离线保存这份内容。它不是整个知识库的备份。
_Avoid_: 全站备份、数据库备份
