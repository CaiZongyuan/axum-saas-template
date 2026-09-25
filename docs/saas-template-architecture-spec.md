# SaaS Template 架构与实施规范

> 状态：v1 实施基线。用户已确认测试方案与纵向任务拆分，并发布到 [GitHub 总规格 #1](https://github.com/CaiZongyuan/axum-saas-template/issues/1) 及 28 张实施票；[实施计划](./plans/template-v1.md)记录入口。本文描述待实现行为，不代表应用已经实现或已通过测试。
>
> 已确认方向：单机部署、每次部署一家企业、作为可运行教程的企业知识库参考应用、自助邮箱密码注册、在线 Markdown 编辑与预览、RustFS 附件、知识库级权限，文档与附件继承权限。
>
> 默认行为按已发布实施票推进；具体时限、容量与性能预算作为可配置的实施起点，在真实基线上验证。示例保持简单，工程质量要求随功能交付。
>
> 相关文档：[术语表](../CONTEXT.md) · [讨论与决策记录](./saas-template-spec-review.md) · [单企业部署 ADR](./adr/0001-single-organization-deployment.md) · [认证与异步选型研究](./research/auth-and-async-options.md)

## 1. 目标与交付边界

交付一套可复用的 SaaS 工程底座，以及一套用简单业务串联核心功能的可运行教程。企业知识库 example 用来教使用者如何使用 template、仿照同一流程实现自己的业务，并在需要时容易地移除 example。

“简单”约束业务对象和用户操作步骤；“覆盖大部分功能”要求示例真正接入核心能力并配套测试。每项 v1 核心能力都有实际示例入口、对应在线教程和验收场景，不能只在文档列出接口或使用 mock 宣称已覆盖。实现功能与编写在线教程同步交付。

开发者可以保留身份、企业成员、权限基础设施、文件、后台任务、审计等能力，删除 `knowledge` 参考业务后实现自己的产品。默认采用模块化单体，按业务模块组织；简单 CRUD 保持简单，确有并发或状态约束的场景才使用轻量 DDD。

### 1.1 已确认的产品范围

| 主题 | 决定 |
| --- | --- |
| 部署 | 单机 Docker Compose；一次部署只服务一家企业 |
| 企业模型 | 一个 Organization，内部可以有多个 Knowledge Base；没有额外 Workspace 层 |
| 认证 | 提供注册页面，用户自行填写邮箱和密码；OAuth、OIDC、企业 SSO 后置 |
| 参考应用 | 企业知识库，避免发展成完整企业办公平台 |
| 文档 | 用户注册后即可像写博客一样新建、编辑、预览和保存 Markdown 文档 |
| 附件 | 通过应用上传、查看和下载，实际二进制由 RustFS 管理 |
| 教学交付 | 可运行 example、特性覆盖表、循序教程、在线文档站和移除/替换 example 的完整路径 |
| 权限 | 知识库级阅读/编辑权限，文档和附件继承 |
| 文件导入 | PDF/Word 可作为附件；自动解析、转成正文和附件全文检索后置 |
| 多端 | Web 完整可用；Electron 壳复用共享 Views；Mobile 仅 skeleton，独立验收 |

单机描述运行资源，单租户描述服务对象。一台服务器也可以运行多租户软件，但当前选择每家企业独立部署。以后转为共享部署的多租户系统，需要重新评估账号关系、数据归属与权限合同。

### 1.2 简单操作流程与默认行为

| 能力 | 首发方案 |
| --- | --- |
| 加入企业 | 用户通过注册页面加入本部署，成功后建立登录会话；不需要邀请或管理员审批 |
| 首次写作 | 示例自动准备个人知识库及写入权限，直接进入“我的文档”，不要求手动建库 |
| 企业管理员 | Owner/Admin 可管理并访问全部知识库；普通成员按知识库授权访问 |
| 写文档 | 保存后立即对有阅读权限的成员可见；不加入草稿、发布、审批流程 |
| 并发编辑 | 使用版本号阻止静默覆盖；不做多人实时协同编辑 |
| 历史版本 | 首发不提供完整历史版本和回滚界面；版本号只用于并发保护 |
| 搜索 | 首发按标题关键词查找，并过滤无权访问的结果 |
| 删除 | 显式确认后删除，无回收站；附件对象由后台可靠清理 |
| 异步 | PostgreSQL Jobs 处理文档导出、重置邮件和对象清理；不要求独立消息服务器 |
| 教学功能 | 用“导出当前文档”这个小操作串联 Job、Worker、RustFS 产物和通知 |
| 后续扩展 | 正文全文搜索、Outbox 与独立消息系统在实际需要时扩展 |
| 商业化 | 不为示例加入套餐、账单或商业配额；平台运行限制保留 |

Owner/Admin 能读取私有知识库，是这套简单权限模型的明确边界。“私有”是相对于未获授权的普通成员；如要求管理员也看不到内容，需要另作权限设计。

### 1.3 非目标

v1 不要求微服务、Service Mesh、Kubernetes、多机 HA、自动故障转移、零停机升级、Kafka、Event Sourcing、完整 CQRS 双库、复杂 ABAC、通用工作流引擎或独立搜索/向量数据库。

AI 问答、RAG、Agent Runtime、知识图谱、在线协同编辑、PDF/Word 解析、企业目录同步和复杂审批均不因“企业知识库”这个名称而自动进入范围。

不强绑定 RustFS、RabbitMQ、Stripe 或某一家云厂商。也不为了展示某个中间件而给参考应用添加业务功能。

## 2. 技术栈与运行形态

| 层 | 方案 |
| --- | --- |
| Web | React、TypeScript、Vite、TanStack Router / Query |
| UI | shadcn/ui、Base UI；表单默认 React Hook Form + Zod |
| 前端状态 | 服务端资源由 TanStack Query 管理；跨组件 UI 状态按需使用 Zustand |
| Backend | Rust、Axum、Tokio、Tower、SQLx、Serde、tracing |
| 合同 | Rust DTO + utoipa/OpenAPI，生成 TypeScript contracts 与 SDK |
| 业务数据 | PostgreSQL |
| 缓存与短期控制 | Redis，不作为身份、业务或任务的唯一事实存储 |
| 大对象 | 默认使用 RustFS，通过 S3-compatible ObjectStorage 适配器接入 |
| 后台工作 | PostgreSQL Jobs + Rust Worker |
| 入口与部署 | Caddy、Docker Compose |
| 可观测性 | tracing + OpenTelemetry；Collector/Prometheus/Loki/Tempo/Grafana 为可选完整观测 profile |
| 测试与性能 | Rust tests、Vitest、React Testing Library、Playwright、Criterion、k6 |
| 文档 | 仓库 Markdown 投影到 VitePress |

依赖版本在 Phase 0 固定到工具链配置与 lockfile。禁止以不固定的 `latest` 作为生产构建合同；spec 不声称尚未执行的兼容性验证已经完成。

```text
Internet / Enterprise Network
              |
            Caddy
              |
       +------+---------------+
       |                      |
    React Web              Axum API
                              |
                    Application Modules
                    /                 \
             SaaS Core           Reference Domain
        Identity / Organization       Knowledge
        Authorization / Files     Bases / Documents
        Jobs / Audit / Notification
                    \                 /
                      PostgreSQL
                     /          \
              Business Data   Durable Jobs
                                  |
                                Worker
                                  |
                           Export / Mail / Object Cleanup

S3-compatible storage: attachments and optional export artifacts
Redis: cache and rate limit acceleration
API / Worker -> tracing -> optional OTel observability stack
```

API 和 Worker 可以作为两个进程启动，仍属于同一个模块化单体，复用应用模块与数据库；这不要求将它们拆为微服务。

## 3. 仓库结构与依赖方向

```text
apps/
  web/                    # 浏览器入口、路由与平台适配
  desktop/                # Electron shell / preload
  mobile/                 # 独立验收的 React Native / Expo skeleton
  api/                    # HTTP 进程组装
  worker/                 # Worker 进程组装
  docs/                   # VitePress；.generated 不提交
crates/
  app/src/modules/
    identity/
    organization/
    authorization/
    knowledge/            # 可删除的 Reference Domain
    files/
    jobs/
    notification/
    api_key/
    audit/
  platform/src/
    postgres/
    redis/
    storage/
    mail/
    telemetry/
    config/
packages/
  contracts/              # 生成的 DTO / Schema / Enum / Error contract
  sdk/                    # 生成客户端与很薄的跨平台 transport 适配
  core/                   # 平台无关 helper、query keys、错误分类
  ui/                     # React DOM primitives、tokens 与通用组件
  views/                  # Web / Electron 共享业务页面
examples/knowledge-base/   # 示例说明、种子数据说明与旅程入口；不复制实现
migrations/
docs/
  getting-started/
  architecture/
  concepts/
  tutorials/
  modules/
  operations/
  testing/
  performance/
  adr/
  research/
tests/
  contracts/
  e2e/
  performance/
scripts/
infra/
  caddy/
  docker/
  rustfs/
  observability/
CONTEXT.md
AGENTS.md
ARCHITECTURE.md
Cargo.toml
rust-toolchain.toml
pnpm-workspace.yaml
justfile
compose.yaml
compose.production.yaml
compose.observability.yaml
README.md
```

第一版只拆 `app`、`platform` 两个主要 Rust crate，不把每个 module 变为独立 crate。

依赖方向：进程入口组装 `app` 与 `platform`；`app` 的基础设施实现可以使用 `platform` 的连接池与通用客户端；`platform` 不依赖 `app` 或 `knowledge` 的业务类型。模块专属端口及其适配器留在该模块内，避免 crate 循环依赖。

`knowledge` 可以调用 Core 的公开能力，Core 不反向依赖 `knowledge`。文件授权可通过应用组装时注入的资源授权接口实现，不能让 File 模块直接读取知识库私有表。

### 3.1 Example 的所有权清单

示例的教学定位与可移除边界见 [ADR 0002](./adr/0002-executable-removable-reference.md)。

`examples/knowledge-base/manifest.toml` 登记 Reference Domain 拥有的后端模块、前端 Views/routes、数据迁移、Job handler 注册、种子数据、测试、教程页与静态资源，以及少量需要改动的应用组装点。实际字段格式由实现确定，但不得只靠文件名关键词猜测删除范围。

示例代码集中在 `crates/app/src/modules/knowledge` 与 `packages/views/src/knowledge` 等明确子目录。API/Web/Worker 只在公开组装点注册它们；Core、SDK transport、通用 UI 和平台客户端不直接 import Knowledge 的实体或实现。

用户停用、文件授权、任务注册、审计与通知都通过公开协作合同处理。尤其禁止 User 的删除/停用用例直接操作 Document 表，或为自动创建个人库把 Knowledge 依赖写进 Identity。

### 3.2 删除参考业务的合同

交付真实可用的命令：

```text
just example-remove --dry-run
 -> 展示本示例拥有的文件、组装点和需要重新生成的产物
just example-remove
 -> 移除知识库业务，更新模块/路由/任务/文档导航注册
 -> 重新生成 OpenAPI、contracts、SDK 与文档引用
just check-core
just docs-build
```

命令面向全新、可安全编辑的模板工作副本，按 manifest 精确处理；检测到无法匹配的用户改动时给出清单，不强行覆盖。不操作生产数据、对象 bucket、密钥、其他模块源码或已有数据库卷。

示例迁移按所属模块登记。全新项目可以裁剪未使用的示例迁移，并在新空库初始化；已经运行过或发布过迁移的项目必须保留原迁移历史，通过新增迁移处理业务移除。教程分别说明这两条路径，不能把源码移除等同于删除已有业务数据。

移除后，Core 的注册/登录、企业成员、通用文件接口、任务、通知、API Key、审计、生成合同和基础 UI 仍能编译与验收。知识库特有的页面、接口、Job handler 和教程导航不残留。Core 文档站仍能构建，文档检查不会引用已经移除的示例源码。

CI 在临时工作副本与临时数据库实际执行移除命令，再运行 Core 编译/测试、生成漂移检查、迁移和文档构建。只检查不存在某个目录不能证明 example 易移除。

### 3.3 仿照示例实现新业务

在线教程用同一条真实流程说明：定义自己的模型与迁移 → 实现模块公开用例 → 接权限/审计 → 注册 HTTP/OpenAPI → 生成 SDK → 接 Query/View/路由 → 按需要接文件/任务 → 补测试与性能合同 → 更新在线文档。

每一步同时指出“可以保留的 Core 能力”和“应替换的示例代码”。复制的是这条实现方法与接口用法；教程不要求用户先理解整套中间件，也不维护第二份脱离产品的 toy implementation。

## 4. 模块边界与事务

简单模块可以只有 `http / application / infrastructure`；复杂约束按需要增加 `domain / ports`。不要求每个 CRUD 都有 Aggregate、Domain Event 或 Repository。

硬规则：

1. HTTP Handler 处理协议与输入，不保存核心业务规则。
2. Domain 不依赖 Axum、SQLx、Redis、S3、消息客户端或 OTel API。
3. Infrastructure 执行持久化和外部调用，不决定业务是否合法。
4. 模块不读写其他模块的私有表；通过公开 Application API 协作。
5. 简单查询可走 Query Service，不必构造 Aggregate。
6. 不使用 Generic Repository；Repository/Port 用具体业务语言表达。
7. 一个用例的数据库修改、必须的审计记录和持久 Job 在同一个 PostgreSQL 事务提交。
8. 邮件、对象存储等外部调用不放在持锁的业务事务中。
9. 跨模块用例共享由最外层 Application Service 创建的事务上下文；参与模块不私自提交或启动嵌套独立事务。
10. 只有真正需要跨独立服务协调时才讨论 Saga。

SQLx 事务可以出现在 Application/Infrastructure 的协作接口，不能泄漏进纯 Domain 类型。不要为了隐藏一次 SQLx 调用而制造一套通用数据库框架。

跨模块 FK 只能引用公开、稳定的资源标识，并由拥有该关系的模块管理迁移；它不赋予读取其他模块私有字段的权限。删除和业务约束仍通过公开用例协调。

Boundary check 同时覆盖 Rust 模块可见性、依赖/import 方向和已登记的表归属。SQL 检查要明确动态 SQL 等盲区，不能声称一个路径正则已经证明全部模块隔离。

## 5. 领域与数据模型

术语以 [CONTEXT.md](../CONTEXT.md) 为准。

```text
One Deployment
 -> One Organization
    -> Users + Memberships
    -> Knowledge Bases
       -> Knowledge Base Grants
       -> Documents
          -> Attachments -> Files
```

| 模块 | 拥有的数据 | 关键约束 |
| --- | --- | --- |
| Identity | User、Credential、Session、验证/重置 token | 邮箱唯一；凭据与 token 不以明文持久化 |
| Organization | 单个企业设置、Membership | 企业最多一个；初始化后始终至少一名有效 Owner |
| Authorization | 权限定义与计算规则 | 前端权限提示不构成服务端授权 |
| Knowledge | Knowledge Base、库级 Grant、Document、Attachment 关系、Export | Document 必须属于知识库；授权不可绕过 |
| Files | 文件元数据、上传会话、对象位置、清理状态 | 只有完成验证且仍有关联访问权的文件可读 |
| Jobs | Job、执行尝试、租约与失败状态 | 领取、续租和结果提交有明确所有权 |
| Notification | 通知内容/投递状态/已读状态 | 邮件失败不回滚已提交业务 |
| API Key | 创建者、hash、权限上限、有效期 | 有效权限受创建者当前权限约束 |
| Audit | actor、action、resource、correlation、必要 metadata | 必须审计的 mutation 与业务提交一致 |

建议采用 UUID v7、PostgreSQL `timestamptz`、服务端 UTC、API RFC 3339 字符串。客户端负责本地时区展示；ID 不是权限凭据。

重要可修改资源带 `version`，通用时间字段为 `created_at / updated_at`。Document 带 `knowledge_base_id`；不为了模拟多租户而强制全表添加恒定的 `tenant_id`。

企业记录在初始化阶段创建，正常业务 API 不接受企业切换参数。其他企业需要另一套部署，其账号、会话、数据库及存储命名空间均独立配置。

### 5.1 最后 Owner 的并发保护

移除、停用或降级 Owner 时，先锁定同一企业协调行，再读取有效 Owner 集合、验证变更并写入成员和审计记录。所有会改变 Owner 集合的用例遵守同一锁顺序。

必须验证“两位 Owner 同时退出”场景，只允许其中一个成功。不能只在前端判断，也不能依赖事务外的 count 查询。

## 6. 邮箱密码、成员准入与会话

### 6.1 前后端职责

```text
React + shadcn/ui 注册页 / 登录页
 -> SDK
 -> Axum Identity Application
 -> PostgreSQL 凭据与 Session
 -> HttpOnly Cookie
```

Better Auth 包含 TypeScript 服务端认证实现及 React 客户端，不是单纯的前端 UI 库。对当前 Rust/Axum + 邮箱密码范围，建议不增加 Better Auth 服务；使用成熟的 Rust 密码散列、随机数和会话相关库实现 Identity，不自行发明算法。具体依赖在实施前核验维护状态与兼容性。

前端通过会话查询获取当前用户。TanStack Query 管理会话数据；Zustand 不保存另一份用户权限事实或明文凭据。

### 6.2 自助注册

1. 用户打开注册页面，填写邮箱、密码及可选显示名。
2. 服务端校验输入、邮箱唯一性和请求频率，散列密码。
3. 同一事务创建 User、Credential、当前企业的 Membership 和注册 Audit。
4. 注册成功后建立 Session，用户直接进入写作界面；会话签发失败时账号仍可用，用户可以正常登录，不重复注册。
5. Knowledge 模块在用户首次进入写作流程时幂等准备个人知识库与 Editor Grant；用户不需要等管理员建库或授权。

注册入口不要求邀请、域名匹配或管理员审批。默认不把邮箱验证邮件作为注册后写作的阻塞步骤；可提供非阻塞的邮箱验证，密码找回仍需证明邮箱控制权。邮箱值本身不授予其他知识库权限或管理员身份；首账号 Owner 仅由下述一次性初始化规则决定，其余自注册账号均为 Member。

Core 的注册用例只处理身份、成员和审计，不依赖 Knowledge。个人知识库的准备属于 Reference Domain，移除 example 后 Core 的注册和登录照常工作。个人库初始化只建立首次默认权限，不得在已有库被撤权或删除后，通过重新登录/重新初始化偷偷恢复原权限。

邮箱比较采用明确定义的规范化规则并建立唯一约束：去除首尾空白、大小写不敏感比较，保留显示值；不自行折叠邮箱服务商的 `+tag` 或点号规则。同一邮箱并发注册只能创建一个账号；重复注册不能改写密码、恢复已停用账号或更改角色。

默认首个成功注册的账号成为企业 Owner，随后账号均为 Member；企业与首次 Owner 的建立由同一初始化锁/唯一约束串行保护，注册失败必须回滚首次领取。部署人员完成首个账号注册后再将实例交给普通使用者，不引入额外的邀请或初始化命令作为日常用户流程。请求体不能指定 Owner/Admin 角色。

### 6.3 密码与找回

采用 Argon2id 等成熟密码散列方案，参数在目标机器上验证并记录。密码不进入日志、审计 metadata 或错误详情。

忘记密码接口对存在和不存在的邮箱给出相同外部响应。重置 token 保存 hash、单次使用，建议有效期 30 分钟；成功重置后撤销已有 Session。邮箱验证与重置链接的外部 URL 来自受信配置，不能直接采用用户提交的 Host。

验证记录中的 token 只存 hash；异步邮件所需的原始链接材料另以成熟库提供的认证加密方式短期保存，使用独立配置的邮件投递加密密钥与 key version，不能以明文放进普通 Job payload。Worker 执行时解密，投递成功、链接到期或取消后清除敏感材料；重试前再次检查邮箱验证/重置记录仍有效。密钥随受保护的恢复配置管理，首发不要求独立 KMS。

### 6.4 Session、Cookie 与 CSRF

Session 使用高熵不透明 secret，数据库存 hash、User、有效期、撤销状态等元数据。建议绝对有效期 7 天、空闲有效期 24 小时，可配置；验证时以服务端时间和数据库状态为准。

生产 Cookie 使用 `Secure / HttpOnly / SameSite=Lax / Path=/`，默认同源部署，不设置通配父域。开发环境仅在 localhost 明确允许非 TLS Cookie。

Cookie 认证的 mutation 验证受信 Origin 与服务端会话关联的 CSRF token；登录等建会话入口也要校验来源。明确配置 CORS，不允许任意 Origin 携带凭据。API Key/Bearer 不使用浏览器 Cookie，不复用 Cookie 的 CSRF 流程。

注销撤销当前会话；停用成员和密码重置撤销相应会话。v1 不缓存授权结论到长寿命 JWT；Redis 故障不会让已撤销 Session 重新有效。

## 7. 企业角色与知识库权限

已确认：权限控制到知识库一级，文档与附件继承。以下为建议的最小具体矩阵。

| 企业角色 | 企业设置与成员 | 知识库管理 | 内容访问 |
| --- | --- | --- | --- |
| Owner | 完整管理，包括 Owner 任命/转移；不能移除最后一位 Owner | 全部管理 | 全部知识库读写 |
| Admin | 管理普通成员；不能任命、降级或移除 Owner | 全部管理与授权 | 全部知识库读写 |
| Member | 查看必要的自身与企业信息 | 拥有默认个人写作空间，无全局管理权 | 个人库默认 Editor；其他库根据 Grant |

| 知识库 Grant | 阅读/搜索/下载附件 | 新建、编辑、删除文档与管理附件 | 变更知识库成员 |
| --- | --- | --- | --- |
| Reader | 允许 | 不允许 | 不允许 |
| Editor | 允许 | 允许 | 不允许 |
| 未授权 | 不允许 | 不允许 | 不允许 |

每个注册用户默认可以在自己的个人知识库编写文档、上传附件。Owner/Admin 可以创建共享知识库并分配 Reader/Editor；注册不会自动开放其他用户的个人库或共享库。个人库是普通 Knowledge Base 的默认使用方式，不引入新租户或另一套权限系统。

不再引入库管理员、部门组、逐文档 ACL 或规则引擎。删除整个知识库及修改库授权属于企业管理员操作；普通用户可以在自己的可写库中管理文档和附件。

有效权限是当前有效企业成员身份、企业角色、知识库 Grant，以及凭据权限上限的共同结果。普通成员不能仅凭文档 ID、附件 ID、对象 key、搜索接口或历史 URL 绕过库级权限。

授权在服务端执行；客户端隐藏按钮仅改善体验。前端不得自行定义与服务端不同的权限映射，权限目录由服务端定义生成。

撤销成员或 Grant 后，后续 API 请求立即按最新权限判断；列表、标题搜索、附件链接签发同样适用。对不可见资源统一返回 404，避免泄露其存在；对已可见资源上的越权 mutation 返回 403。

建议本阶段不缓存资源授权结果。未来若需要缓存，必须先定义失效与撤销时效，而非仅增加一个 TTL。

## 8. 企业知识库的最小用户旅程

### 8.1 用户主流程与学习路径

```text
Open Registration Page
 -> Register with Email and Password
 -> Enter My Documents
 -> Create / Edit / Preview Markdown
 -> Save Document
 -> Upload Attachment to RustFS
 -> Read Document / Download Attachment
```

首个注册账号自动完成企业 Owner 初始化，后续用户自行注册。个人库由示例在首次写作时幂等准备，页面不要求先配置组织或申请权限。这里的“像写博客”指编写、保存和阅读体验，不意味着匿名公开所有内容；访问仍受已确认的库级权限控制。

同一个 example 的进阶教程沿着自然的小操作学习其他能力：

```text
Grant Reader / Editor on a Knowledge Base
 -> Access Documents Through an API Key
 -> Export One Document as Markdown + Attachments ZIP
 -> Observe Job Progress and Completion Notification
 -> Inspect Audit / Trace
 -> Delete an Attachment and Observe Reliable Cleanup
```

这些操作复用同一份文档与附件，不增加项目管理、审批、套餐或另一套示例业务。Reference Domain 拥有知识库、文档、库权限、附件关系与文档导出；身份、存储、任务、通知、API Key、审计由 Core 提供。

Markdown 正文、标题和文档关系保存在 PostgreSQL；RustFS 保存附件二进制与导出产物。前端通过应用取得受限上传/下载能力，不直接持有 RustFS 管理凭据。

### 8.2 Markdown 文档

文档包含 `id / knowledge_base_id / title / markdown / version / created_by / updated_by / timestamps`。标题不能为空；建议标题上限 200 字符、正文 UTF-8 编码后上限 1 MiB，作为可配置平台保护值。

使用 Markdown 编辑加预览。建议首发显式点击保存；成功保存后，有阅读权限的人即可看到最新内容。没有草稿发布、审核流、历史版本浏览或多人实时协同。

预览禁用或安全清洗原始 HTML，过滤危险 URL 协议。附件图片按受保护资源引用渲染，不把对象存储密钥或永久公开对象地址写入 Markdown。外链不会触发服务端任意 URL 抓取。

保存携带当前 `version`。服务端同时验证资源归属、权限与版本；冲突返回 409，前端保留未保存文本，提示读取最新版本后人工处理，不自动覆盖。

```sql
UPDATE document
SET title = $1,
    markdown = $2,
    version = version + 1,
    updated_at = now()
WHERE knowledge_base_id = $3
  AND id = $4
  AND version = $5;
```

此 SQL 只是并发更新形状，不替代前置授权。授权与写入的并发边界应保证撤权和写操作有明确提交顺序。

### 8.3 列表与搜索

建议 v1 只按标题关键词查找，结果受当前知识库权限过滤。列表返回摘要字段，不返回每篇全文或全部附件。

关键词作为字面搜索文本处理，转义 SQL LIKE 通配符并使用参数绑定；不能让用户提交 SQL。搜索不泄露不可见标题、结果数量或补全词。

PostgreSQL 足以承担首发标题搜索。正文全文检索、中文分词、语义检索和独立搜索服务后置；`pg_trgm` 等索引优化依据实际 query plan 选择。

### 8.4 删除

建议删除文档或知识库时要求用户显式确认；服务端立即取消其可见性，记录审计，并在同一事务登记附件清理 Job。没有七天回收站或恢复页面。

对象清理可以异步完成。用户不可继续通过应用获取已删除资源；重试删除和清理必须幂等。内部清理状态不等于面向用户的“可恢复删除”。

首发不支持跨库移动文档，避免在附件、链接和权限尚未需要迁移时增加复杂度。

### 8.5 文档导出：小功能展示后台任务

“导出当前文档”只生成一个 ZIP，包含 Markdown 正文与其附件。它不扩张为批量报表、审批或全站备份，却能够展示异步请求、事务、Worker、RustFS、通知和可观测性的配合。

1. 用户申请导出时校验读取权限和幂等键，在同一数据库事务保存 Export、文档版本/正文/附件清单的快照、Job 与 Audit；Job payload 只引用 export_id。
2. 返回任务标识，页面展示 queued/running/succeeded/failed；重复点击不会创建相同请求的重复任务。
3. Worker 重新检查发起者与凭据的有效权限，用快照中的正文和不可变 ready 附件生成 ZIP，以有界内存流式处理，受文件数、总大小和运行时间限制。
4. Worker 通过 File/ObjectStorage 能力把产物写入 RustFS，再以有效租约提交 Export 结果、完成通知与 Audit；对象写入与 DB 失败之间的孤立产物由同一清理机制回收。
5. 用户查看通知并取得受限下载链接。导出记录与结果仅请求者/管理员可访问，并且必须仍有源文档读取权；源文档删除或撤权后不能借产物继续下载。

导出使用请求时快照，后续编辑不混入该 ZIP。若快照引用的附件在执行前已删除，则任务明确失败，不静默导出缺文件的“成功结果”；v1 不为此增加跨文档引用计数与长期版本保留系统。

ZIP 内部路径由服务端生成并清洗，文件名碰撞使用稳定标识区分，正文中的附件引用指向 ZIP 内相对路径，禁止路径穿越。完成通知按 export_id 去重；崩溃重试不能发布多份逻辑结果。

产物和导出快照是短期资源，建议保留 24 小时后清理；到期显示 expired，不返回悬空链接。导出结果不会让私人内容自动公开。

### 8.6 特性覆盖矩阵：实现、教程、验收一一对应

v1 默认核心能力必须在同一个 example 中有真实调用；矩阵中每行交付“运行入口 + 源码导读 + 在线教程 + 对应测试”，不能只填一个模块目录。尚未选用的 broker/AI 等单独标为扩展，不虚报覆盖。

| 模板能力 | 示例中的小场景 | 要学会的复用方式 / 验收 |
| --- | --- | --- |
| 注册、Session、配置 | 注册页面 → 我的文档；找回密码独立操作 | 调用 Identity、Cookie/CSRF、失败处理；不依赖邀请 |
| Organization、RBAC、资源授权 | 个人库可写；为另一用户授予 Reader/Editor | 如何把 Core 主体接到自己业务的资源权限；越权/撤权测试 |
| CRUD、SQLx、迁移 | 新建、列出、更新、删除 Markdown 文档 | 新模块与事务组织；不强制复杂 Aggregate |
| 业务约束、并发 | 两人修改同一文档；最后 Owner 保护 | version 冲突、跨用例一致性与真实并发测试 |
| OpenAPI、SDK、多端 Views | 编辑器通过生成 SDK 读写；Electron 复用页面 | 从 Rust DTO 到前端请求/Query/View 的完整改动链 |
| RustFS / S3 / 文件权限 | 上传附件、Markdown 引用、授权下载和删除 | 接通用 Files 能力、状态机、完成校验、孤立对象恢复 |
| Job、Worker、幂等 | 导出当前文档 ZIP、重启 Worker、重复点击 | 同事务登记工作、租约、重试、进度与结果 |
| Notification / Mail | 导出完成站内通知、独立密码重置邮件 | 业务模块与通知 provider 解耦，真实任务投递与去重 |
| Audit / Tracing | 保存、导出、授权、删除后查看记录 | 请求到任务和 RustFS 的因果链；与业务提交一致 |
| Redis / Rate Limit | 已授权文档详情缓存，注册/请求频率控制 | 回源、失效与降级；缓存命中仍先鉴权 |
| API Key | 用脚本读取有权访问的文档 | 凭据权限上限、继承当前权限、撤销后拒绝 |
| 测试 / 性能 | 重放注册→写作→附件→导出轨迹 | 单元/集成/HTTP/View/E2E；query、响应、bundle 预算 |
| 部署 / 恢复 | Compose 启动同一示例，备份后恢复文档与附件 | 配置、持久卷、health、日志与真实恢复 |
| 文档 / 可替换业务 | 跟教程实现一个用例，再移除知识库 example | 在线教程跟源码同步；移除后 Core 与文档站仍可运行 |

运行可选不等于免交付：v1 已承诺的 Electron shell 和完整观测 profile 仍须能启动并验证，基础写作路径可以不启动它们。Mobile 只展示共享合同与原生 skeleton；不把未实现的完整移动业务界面列为已覆盖。Outbox/独立消息系统的扩展章需在真正交付适配器时配套代码，之前明确标记为设计说明。

## 9. API Key、审计与通知

### 9.1 API Key

建议 API Key 归属于创建者 User，不引入独立机器账号或服务账号体系。记录 `id / user_id / name / prefix / secret_hash / scopes / expires_at / revoked_at / last_used_at`。

完整 secret 只展示一次，保存 hash；建议设置到期时间。有效权限是 key scopes 与创建者当前角色、库权限的交集。创建者停用、授权撤销或 key 撤销后不可继续访问。

API Key 不允许绕过知识库授权，也不允许用来创建新的管理员。机器访问作为 Core API 示例，不要求给知识库增加专属业务页面。

### 9.2 Audit

必须审计：注册、企业设置、成员变更、角色与库授权、API Key 创建/撤销、知识库与文档 mutation、附件完成/删除，以及必要的运维重试操作。

记录 `actor_type / actor_id / action / resource_type / resource_id / request_id / trace_id / correlation_id / metadata / created_at`。机器请求同时可记录 `api_key_id`，不记录 secret。

必须审计的成功 mutation 与审计行同事务提交；审计失败则该次数据库 mutation 不提交。后台操作有独立 job/actor 因果标识。登录失败等安全事件进入受控结构化日志，不强制依赖一个尚不存在的业务资源。

审计不存密码、token、文档全文或附件内容；原始 IP、user agent 的收集与保留按部署配置。首发只提供管理员查看，不构造复杂合规留存引擎。

### 9.3 Notification

提供邮件通道，以及简单的站内通知读取/已读能力。业务模块调用通知用例，不直接调用具体邮件供应商。

邮件用于密码重置和可选邮箱验证；事务提交后由 Job 投递。普通注册与写作不等待邮件送达。站内通知以文档导出完成/失败作为示例入口，展示通知读取和已读操作。投递失败可重试、最终失败可查看，不能回滚已经提交的业务数据。

站内通知以 recipient 与来源业务键去重。邮件提供方若支持幂等键就使用；不支持时需接受极端重试窗口中可能重复发信，不能宣称恰好一次。

## 10. 文件与对象存储

默认开发和单机部署使用 RustFS 管理附件和导出产物。Application 使用具体能力所需的 ObjectStorage Port，适配器通过 S3 协议对接 RustFS；保留接入其他 S3 服务的能力，不使用 RustFS 专有 API。二进制不进入 PostgreSQL，Markdown 正文默认不作为 RustFS 对象保存。

文件元数据保存对象位置、原始显示文件名、声明/实际 MIME 和大小、校验信息、创建者与状态。对象 key 由服务端生成，不采用用户路径或信任客户端传来的 bucket/key。

### 10.1 状态机与直传

```text
pending_upload -> ready -> deleting -> deleted
       |
       +-> expired / rejected -> cleanup
```

1. Editor 为指定文档请求上传；服务端校验权限和文件上限，建立上传记录。
2. 返回受限的预签名上传 URL、上传标识与到期时间。
3. 客户端直接上传到私有 bucket。
4. 客户端调用完成接口；服务端重新验证文档权限和上传状态。
5. 完成过程将暂存对象复制到服务端独占写入的最终对象 key，校验最终对象存在、大小和必要的类型/校验信息后，原子关联附件并标为 ready。

客户端报告“上传成功”不等于文件可用。重复完成返回相同附件结果；文档已删除、已撤权、对象不匹配或会话已过期时不得变为 ready。

预签名 PUT 只允许写暂存 key，永远不允许写已发布的最终 key。每次完成尝试先登记唯一候选 key，再在数据库事务外复制/校验；最后重新验证当前文档、权限和上传状态，用条件更新选定唯一 ready 结果，未采用的候选对象可被清理。校验以实际发布的最终对象为准，不只检查复制前的 HEAD；最终 key 发布后不可覆盖。这样即使客户端重用未过期的上传 URL，也只能改变暂存对象。

建议单文件上限 20 MiB、上传 URL 15 分钟；实际限制由配置生成文档。预签名直传不保证所有后端都能在上传前阻止超大对象，因此完成阶段仍检查并清理不合格对象。

上传资源与短期 URL 分开：幂等重试保持 upload_id 不变，对仍有效的 pending_upload 可以重新签发 URL，且不能超过上传会话有效期。会话过期后返回明确的 upload_expired，用户重新发起上传；不把过期 URL 作为 24 小时幂等结果反复返回。

### 10.2 下载与权限

只有 ready 且仍关联可见文档的附件可签发下载 URL。使用短期预签名 URL，建议 60 秒；文件默认以 attachment 下载，禁止把用户上传 HTML 作为可信应用页面执行。

撤权会阻止新的链接签发，但已签发 URL 在到期前仍可能有效。这是直传/直下载模式的具体权限时效；需要每次字节读取都立即鉴权时应改用代理下载，不在简单首发同时实现两套策略。

### 10.3 一致性与清理

上传成功但完成请求丢失、DB 提交失败、文档被删除等情况会产生未关联对象。后台任务清理过期 pending_upload、rejected 与 deleting 对象，保留重试记录和错误摘要。

数据库与 S3 不能假装处于同一个事务。删除用“先改变数据库可见性并登记清理任务，再删除对象”的流程；对象已不存在也视为清理成功。完成清理前不丢失定位对象所需的元数据。

对外文件授权通过资源授权接口完成；File 模块不能自行决定某人是否拥有知识库编辑权。

## 11. PostgreSQL Jobs 与失败恢复

建议 v1 只实现 PostgreSQL Jobs，服务文档导出、密码重置邮件与对象清理。文档导出是必须有真实实现的教学场景，用一个小操作展示任务生命周期；独立 MQ 与文件解析不属于首发依赖。

### 11.1 任务记录与入队

Job 包含 `id / type / schema_version / payload / status / scheduled_at / attempts / max_attempts / lease_token / locked_by / lease_expires_at / last_error / correlation_id / causation_id / timestamps`。

payload 使用有版本的类型化结构，只放小型参数或资源 ID，不把文件或文档全文塞进任务。Claim Check 指向受管理对象；Worker 不从用户提交的任意 URL 拉取内容。

业务修改和 Job 行可以同事务提交。只有提交后的任务才可被 Worker 领取；事务回滚不能留下孤立待执行任务。

### 11.2 状态与租约

```text
queued -> running -> succeeded
             |
             +-> retry_wait -> running
             |
             +-> failed
```

Worker 在短事务中通过 `FOR UPDATE SKIP LOCKED` 选中可执行任务，写入新的 lease_token、到期时间与 attempts，提交后再执行外部工作。不能在整个网络调用期间持有领取事务的行锁。

每次领取都消耗一次尝试，包括领取后直接崩溃的情况。过期租约回收时检查预算，达到 max_attempts 则转 failed，不能因 handler 没来得及返回错误而无限重领。

续租、失败重排与成功提交都必须匹配当前 lease_token。旧 Worker 在租约失效后回来，不能覆盖新执行者的结果。过期租约允许重新领取，意味着任务处理必须准备好重复执行。

建议租约 60 秒、每 20 秒续租；具体 handler timeout 与租约配合配置。只有持有有效租约的执行者可以更新任务状态。

### 11.3 Retry、幂等与最终失败

仅重试明确的 transient failure；权限撤销、输入非法、目标已永久删除等不盲目重试。默认最多 5 次，指数退避与 full jitter，上限 15 分钟，允许按任务类型覆盖。

幂等以业务结果定义：删除同一个对象两次可以成功；重复创建通知由业务唯一键去重。外部邮件副作用不能只靠 Job 状态或 Inbox 就证明恰好执行一次。

最终失败在 PostgreSQL 保留可查询记录，作为本地失败队列。管理员通过显式运维入口重试，记录审计；重试沿用业务幂等标识。v1 不要求单独的 MQ DLQ 服务。

管理员重试仅针对 failed 任务，开启新的执行批次并重置该批次的有限尝试预算，保留此前批次与尝试历史。Job ID 和业务幂等标识不变；成功任务不能被这个入口当作失败任务再次执行。last_error 经过脱敏，不保存邮件链接或完整 provider 响应。

### 11.4 停机与健康

Worker 收到停止信号后停止领取新任务，给正在执行的任务有限的完成时间；超时后退出，由租约到期恢复。不能先把仍在执行的任务释放给其他 Worker，再继续产生外部副作用。

监控待执行数量、最老任务等待时间、重试/最终失败、运行时长与租约过期。Worker readiness 验证数据库及 worker loop 已启动；队列积压属于运行状态，不直接等同进程死亡。

## 12. Outbox 与独立消息系统的扩展边界

需要区分三件事：Job 是要执行的工作；Event 是已经发生的事实；Event Stream 是可保存与重放的事件序列。

| 需求 | 首发或后续方案 |
| --- | --- |
| 本应用导出文档、发信、清理对象 | PostgreSQL Job，业务与任务同事务提交 |
| 多个独立服务订阅业务事件 | 先定义事件合同，再评估 broker + Transactional Outbox |
| 保存事件并按消费位置重放 | 评估持久 event stream；不能把普通内存 pub/sub 当可靠队列 |
| 大负载消息 | Object Storage + Claim Check，不把文件放消息体 |

RabbitMQ 和 NATS JetStream 都是候选，不是默认必装依赖。多 Worker、重试和 backlog 本身并不意味着 PostgreSQL Jobs 已不适合；选型要有实际路由、订阅、重放或负载证据。

RabbitMQ 发布确认与消费确认覆盖不同边界；Core NATS 与 JetStream 的持久化语义也不同。具体事实见研究笔记，不使用未经测量的性能排名。

若启用外部消息：

1. 在业务事务中写 Outbox，包含 event_id、type、schema_version、aggregate_id、必要的关联 ID 和小型 payload。
2. Dispatcher 有租约与重试；broker 确认后标记发布完成，允许失败窗口中的重复发布。
3. Consumer 使用至少一次投递假设；Inbox 唯一键至少区分 consumer 与 event_id。
4. Inbox 成功记录与该 consumer 的数据库副作用同事务提交；提交后 ACK。
5. 外部副作用继续需要自己的幂等/重试设计。
6. 不假设全局有序；确需顺序时明确聚合版本和乱序处理规则。
7. 增加对应 adapter、恢复和兼容性测试后，才提供可选部署 profile。

这些是未来扩展合同；v1 不为没有消费者的事件创建强制 Outbox/Inbox 框架。

## 13. Redis、配置与依赖失效

Redis 可用于缓存、限流加速、短期协调。禁止把业务事实、正式 Job 最终状态、审计或可撤销身份的唯一事实放在 Redis。

缓存默认 cache-aside：读 miss 回源 PostgreSQL，写事务提交后失效缓存。缓存 key 包含所有影响结果的参数；不得把一个成员可见的私有知识结果复用给另一个成员。

示例必须实现一个实际缓存场景：先从 PostgreSQL 验证文档可见性并取得当前版本，再使用 document_id + version 查 Redis 正文缓存；miss 回源，写入成功后失效旧版本缓存，新读只使用新版本 key。miss 回源必须读取匹配该 version 的正文；版本已变化时重新鉴权并获取新版本，不得把新正文写到旧版本 key。缓存不保存独立的授权结论，旧版本缓存不能在撤权、删除或更新后被当成最新资源返回。Redis 不可用时读接口回源，教程和集成测试实际演示这一降级。

限流在 Redis 不可用时回退到单机本地的保守限制；不能因缓存故障取消认证/上传限制。

| 依赖故障 | 预期行为 |
| --- | --- |
| PostgreSQL | API/Worker readiness 失败，业务返回受控不可用错误 |
| Redis | 缓存回源；限流按单机降级策略运行，不失去权限检查 |
| 对象存储 | 文档正文仍可用；上传/下载报可重试失败，清理任务保留 |
| 邮件 provider | 普通注册与写作继续可用；重置/验证邮件任务重试，投递状态可查 |
| OTel Collector | 业务继续；遥测队列有界，避免阻塞请求或无限占用内存 |

统一 Settings 包含 App、Database、Redis、Storage、Email、Auth、Jobs、Telemetry。`.env.example` 覆盖实际配置，Config Reference 从定义生成。

启动时验证必需变量、URL、secret、生产安全设置及互相矛盾的选项。限制数据库池、Worker 并发、外部调用 semaphore 和响应体大小，避免“单机”变成无限并发。

所有外部调用有 timeout。Retry 只在适合的边界发生，避免 HTTP、应用、SDK、Job 各重试一遍导致乘法放大。Circuit Breaker/Bulkhead 以具体失败场景引入，不强制每个模块包一层框架。

## 14. HTTP / OpenAPI 合同

### 14.1 单一来源与接口范围

Rust 请求/响应类型及稳定错误定义生成 OpenAPI，再生成 TypeScript contracts/SDK。禁止手写第二份 TS DTO；Zod 表单校验用于交互，服务端仍是业务验证权威。

默认前缀 `/api/v1`。接口按用例设计，下面列出必须覆盖的资源与行为，不把通用 ORM CRUD 自动暴露成 API。

| 范围 | 主要接口行为 |
| --- | --- |
| Auth | 自助注册、登录、当前会话、注销、忘记密码/重置、可选邮箱验证 |
| Organization | 单个企业设置、成员列表、角色变更与停用 |
| Knowledge Bases | 可见列表、创建/修改/删除、成员授权 |
| Documents | 个人写作空间的幂等准备、库内列表/标题搜索、新建、详情、带版本更新、删除、申请导出/查看结果 |
| Attachments | 请求上传、完成上传、列举、下载链接、删除 |
| API Keys | 创建、列举元数据、撤销 |
| Notifications | 当前用户的通知列表与标记已读 |
| Audit | 管理员按资源/动作查询审计 |
| Jobs | 自己有权看到的业务任务状态；运维重试单独鉴权 |

文档路径携带知识库 ID 与文档 ID 时必须验证两者关系。不得仅以全局文档 ID 更新另一个库的记录。

### 14.2 错误

```json
{
  "error": {
    "code": "document.version_conflict",
    "message": "Document has changed",
    "request_id": "req_...",
    "details": {}
  }
}
```

| HTTP | 用法 |
| --- | --- |
| 400 | 输入格式/校验失败、游标无效 |
| 401 | 未登录或凭据失效 |
| 403 | 对已可见资源缺少执行该动作的权限 |
| 404 | 不存在或当前主体不可见的资源 |
| 409 | 版本冲突、唯一性冲突或幂等键冲突 |
| 413 | 请求/文档/文件超过平台上限 |
| 422 | 已通过输入校验，但违反业务约束，如最后 Owner |
| 429 | 超过限流，提供合理的 Retry-After |
| 503 | 必要依赖暂时不可用 |
| 500 | 未预期内部错误，不暴露内部堆栈或 SQL |

错误 code 稳定、可枚举；message 不是客户端分支逻辑的依据。响应携带 request_id，服务端日志可以定位对应错误。

### 14.3 分页与查询

公开列表使用 cursor pagination：`data / next_cursor / has_more`；建议默认 50、最大 100 条。按稳定字段与 ID 排序，cursor 绑定当前筛选与排序，并验证格式。

Cursor 不是授权凭据；换一个用户、库或筛选条件后不能沿用它读取原结果。变更中的列表允许自然变化，但不承诺跨多次请求的数据库快照一致性。

### 14.4 幂等与并发

适用的业务创建操作、申请上传和后台工作使用 `Idempotency-Key`。建议作用域包含主体、HTTP method、route 与业务资源，保存请求 fingerprint 与可重放结果，默认保留 24 小时。

同 key 同请求返回此前结果，同 key 不同请求返回 409；并发重复只能产生一个业务结果。权限与凭据在每次请求时重新验证，不因命中幂等记录而向已撤权用户返回敏感结果。

幂等记录、业务变更和事务内 Job/Audit 一致提交。文档更新使用 version，幂等键不替代并发控制。

生成上传 URL 等短期能力时，幂等记录保存稳定资源标识，响应中的短期凭据在重新授权后按资源状态重签。认证/密码接口不进入通用响应重放缓存；一次性展示 secret 的 API Key 创建也不缓存明文返回值。API Key 创建响应丢失时，用户根据列表中的元数据撤销该 key 后重新创建，SDK 不自动重试这个 POST。

## 15. 多端共享与前端行为

| 目录 | 职责 | 不允许 |
| --- | --- | --- |
| contracts | 生成的协议类型 | 手改生成文件 |
| sdk | 请求、凭据适配、错误归一化 | 存储业务真相或平台 UI |
| core | 平台无关 helper、query keys、格式化、错误分类 | React DOM、Electron、React Native 或浏览器专用 API |
| ui | React DOM primitives、tokens、表单与反馈组件 | 假设 Mobile 能直接复用 |
| views | KnowledgeBase、DocumentEditor、Members、ApiKeys、Audit 等页面 | 分别复制 Web/Electron 的业务规则 |
| apps/web | TanStack Router、QueryClient、浏览器适配 | 重写共享 Views |
| apps/desktop | Electron shell、preload、有限 IPC、窗口生命周期 | renderer 开启 Node 或暴露任意文件/命令能力 |
| apps/mobile | contracts/sdk/core 接线与原生 skeleton | 进入默认 check 或要求 UI parity |

服务端资源只存 TanStack Query；UI 临时状态可放组件或 Zustand。Query keys 包含资源范围与筛选；注销清除用户缓存，权限变化使相关资源失效，不能展示前一身份的数据。

文档编辑器保留本地未保存文本，显式处理保存中、失败与版本冲突。切换页面时对未保存编辑给出提示；权限撤销后禁止保存并显示受控状态。

共享 Views 覆盖 loading、empty、error、success、permission denied、conflict。操作可通过键盘完成；表单有 label，焦点、对比度和错误提示可被辅助技术理解。

### 15.1 Electron

建议 v1 壳加载同源部署的 Web 入口，该入口使用共享 Views；不提供离线编辑或另一套原生登录协议。独立 session partition 保存 Cookie，renderer 不接触 session secret。

启用 contextIsolation、关闭 nodeIntegration、限制导航和 IPC；外链通过受控系统浏览器打开。下载、deep link 和窗口生命周期有壳层验证，不重复全套业务矩阵。

若以后需要本地打包页面、离线数据或系统浏览器 OAuth，另行设计凭据与源隔离，不能把浏览器 Cookie 生硬复制进 IPC。

### 15.2 Mobile

Mobile 共享 contracts/sdk/core，使用自己的原生 UI 与导航。保留 Expo Router、SecureStore、AppState、NetInfo 等接入位置；首发不承诺完整登录和业务页面。

`just check-mobile` 独立执行。默认 `just check` 不安装/启动 Mobile 工具链。

## 16. 测试、验收与质量责任

测试用户可观察行为和真实边界，不把“文件存在”当功能完成。每个公共行为有明确测试责任，不在所有层重复相同矩阵。

具体测试入口、前后端分工、MSW 的边界、夹具隔离、CI 与逐票 TDD 流程见 [前后端测试方案](./testing/strategy.md)。后端主要从真实 Axum HTTP 接口观察行为，前端从可操作的 DOM 观察交互，Playwright 连接真实服务验证集成；只为必要的纯业务约束和基础设施恢复增加较低层的公开入口测试。

| 层 | 责任 |
| --- | --- |
| Domain Unit | 纯业务约束、状态变迁、权限组合 |
| Application | 用例编排、事务边界、审计/任务产生、失败语义 |
| Adapter Integration | 真实 PostgreSQL、Redis、S3/RustFS 的行为，选用外部 broker 后才加相应测试 |
| HTTP Contract | 真实 Axum Router + 测试数据库，验证鉴权、schema、状态码、分页、幂等和 request_id |
| core / ui / views | Vitest、React Testing Library；交互、键盘、页面状态与冲突 |
| Web / Desktop shells | 路由、Cookie、QueryClient、IPC、窗口等平台接线 |
| E2E | 真实 Web/API/DB/Worker/对象存储下的关键旅程 |

集成测试优先 Testcontainers 或等价隔离真实依赖，不将 SQLite 当 PostgreSQL 替身。邮件 provider 可用本地捕获服务器；不能 fake 掉被验收的入队、Worker 和业务持久化。

### 16.1 必须有的失败与并发场景

- 两位 Owner 同时退出，企业仍保留 Owner。
- Reader 不能编辑；未授权成员不能按 ID、搜索、附件链接或 API Key 绕过权限。
- 撤销成员/库 Grant 后，后续 API 立即拒绝；已签发附件链接按既定 TTL 到期。
- 重复邮箱和并发注册只能建立一个账号；并发首次注册只能产生一个初始化 Owner，失败注册不占用初始化机会。
- 注册不能恢复停用成员、覆盖既有角色或重设已有密码；普通注册不能注入管理员角色。
- 新注册成员无需管理员授权即可写个人文档，但不能读取他人未授权内容；个人库准备失败可重试且不会重复建库或绕过后续撤权。
- 重置/验证邮件在 Worker 重启后仍能投递并清除加密材料；邮件服务故障不阻塞自助注册与写作。
- 文档两个编辑者同时保存，后到者收到 409 且原内容未被覆盖。
- 上传完成重复调用、对象不匹配、上传后权限撤销、完成前文档删除。
- ready 后重复 PUT 暂存 URL 不改变已发布附件；幂等重试不会持续返回过期上传 URL。
- 数据库回滚时，业务、必须的 Audit 与 Job 同时回滚。
- Worker 领取后崩溃、租约过期、旧 Worker 晚到、重复副作用。
- 连续领取后崩溃仍受最大尝试次数约束；手动重试保留历史和原业务幂等标识。
- 孤立文件与对象删除失败可恢复，不让应用继续签发已删除内容的下载链接。
- 幂等键并发、请求不匹配和撤权后的重放。
- 迁移从干净库和上一发布版本升级；生产 API 不隐式迁移。

### 16.2 E2E 旅程

```text
First User Registers (Owner)
 -> Second User Registers (Member)
 -> Member Opens My Documents without Administrator Intervention
 -> Write / Preview / Save Markdown
 -> Upload / Download Attachment through RustFS
 -> Verify Another Unauthorised Member Cannot Read
 -> Grant Reader on a Knowledge Base
 -> Reader Reads but Cannot Edit
 -> Export a Document through Worker
 -> Read Completion Notification / Download ZIP
 -> Revoke Grant and Verify Denial
 -> Delete Attachment and Verify Worker Cleanup
 -> View Audit / Trace
```

API Key 另有短路径验收：创建、允许范围内读取、越权拒绝、撤销。密码找回另有邮件捕获与旧会话撤销验收，不放在每次注册的必经路径中。独立消息系统只在相应扩展实现后增加 E2E。

文档导出的验收必须覆盖重复请求、Worker 重启、执行中撤权、下载前撤权、快照一致性和清理失败，不以“任务表有一行”代替 ZIP 内容可用。

## 17. 性能合同

保留七类验证：Micro Benchmark、Performance Contract、DB Query Plan、Load、Saturation、Trajectory、Soak。跨机器 P95/P99 默认是趋势，不是普通 PR 硬门槛。

### 17.1 建议的首发确定性预算

| 场景 | 可自动检查的预算 |
| --- | --- |
| 可见文档列表，返回 100 条 | 含会话/授权的数据库 round trips ≤ 4；无逐行查询；不返回正文 |
| 列表响应 | 100 条摘要的未压缩 JSON ≤ 256 KiB |
| 已有写作空间中成功创建文档 | 1 个 Document、1 条必须 Audit；不创建无消费者的 Event/Job |
| 成功注册 | 1 个 User、1 个 Credential、1 个 Membership、1 条注册 Audit；会话单独按合同建立，不强制发信 |
| 首次写作空间准备 | 每个用户至多一个默认个人库与初始 Editor Grant；并发重试不复制资源 |
| 成功申请文档导出 | 1 个 Export、1 个 Job、1 条必须 Audit；幂等重试不增加副本 |
| 权限过滤 | 结果行在返回前已过滤，不靠前端隐藏 |
| 前端 bundle | 初始 JS gzip ≤ 400 KiB，单个异步 JS chunk gzip ≤ 500 KiB；Markdown 编辑器按路由延迟加载 |

这些是待实现验证的初始目标，不是已测得结果。Phase 1/2 建立可复现基线；确需调整时在 PR 记录证据，不能自动把失败阈值抬高。

### 17.2 数据库与负载

准备 10、1k、100k 规模数据，1m 作为按需/nightly 场景。关键查询保存可复现参数与 EXPLAIN/EXPLAIN ANALYZE 输出，观察索引、估算偏差、round trips 与 N+1；不能把所有 Seq Scan 一律判错。

k6 报告 RPS、P50/P95/P99、错误率、连接池、队列等待和内存。饱和测试逐级增加并发，轨迹测试覆盖登录、列表、编辑、附件等真实操作。

Criterion 只用于值得度量的纯计算；不为没有性能问题的 trivial helper 凑 benchmark。

### 17.3 前端与 Desktop 长测

Bundle/chunk 是稳定 gate；Lighthouse、LCP、CLS、INP 主要看趋势。不得在有噪声的共享 runner 上承诺所有 Web Vitals 都是强 gate。

Desktop soak 循环切换知识库/文档、打开关闭 modal、刷新数据与查看附件，记录 renderer RSS、heap、DOM nodes、listeners，识别持续增长。进入 nightly/release，不进入普通 PR。

## 18. 可观测性、健康与安全基线

业务代码使用 tracing；Domain 不直接依赖 OTel API。至少关联 `request_id / trace_id / actor_id`，后台加入 `job_id / correlation_id / causation_id`；外部事件启用后增加 event_id。

知识库 ID、文档 ID可出现在受控日志/trace 字段，不作为高基数 metrics label。请求正文、Markdown、密码、session、API Key、邮件 token、预签名 URL query、连接串与存储密钥不得进入日志。

`GET /health/live` 仅证明进程与主循环存活；`GET /health/ready` 验证数据库等必要依赖。S3、邮件或 Collector 暂时失败按失效矩阵处理，不能让所有无关功能都不可用。

SIGTERM：停止接新请求/领取任务，有限时间 drain，保留可恢复的租约状态，关闭连接池，有限时间 flush telemetry。关停超时与容器 stop grace period 相互匹配。

安全基线包括参数化 SQL、密码散列、Cookie/CSRF/CORS、权限检查、限流、CSP/security headers、Markdown 清洗、文件上限与下载策略、敏感数据脱敏及依赖更新检查。

不增加假想行业合规承诺。日志/审计的保留时间、备份保存位置和生产 secrets 由部署配置与操作文档明确，不写一个尚无业务依据的通用合规引擎。

## 19. 部署、迁移与备份

### 19.1 Compose 能力矩阵

| 模式 | 组成 | 能力 |
| --- | --- | --- |
| Minimal smoke | Web、API、PostgreSQL | HTTP/DB/contract 最小连通验证；不承诺完整示例 |
| Default development | Web、API、Worker、PostgreSQL、Redis、RustFS、本地邮件服务 | 完整知识库旅程、HMR、附件与发信 |
| Single-host production | Caddy、Web、API、Worker、PostgreSQL、Redis、RustFS，邮件依赖另行配置 | HTTPS、持久卷、受控网络、单企业运行 |
| Observability overlay | OTel Collector、Prometheus、Loki、Tempo、Grafana | 完整指标/日志/trace 可视化 |
| External broker overlay | 选型后才创建 | 相应扩展的消息语义与测试 |

`docker compose up` 默认应启动可完成示例的开发组合；Minimal 是显式 smoke 模式。`just dev` 可以采用宿主机热重载 + 容器依赖，但业务能力与默认开发组合一致。

Caddy 负责 TLS、反向代理、压缩与安全 headers。数据库、Redis 和管理端口不直接暴露到公网。持久卷、资源限制、健康检查、进程重启策略、secret 注入与日志轮转写入生产配置。

### 19.2 数据库迁移

SQLx migrations 由显式 `just migrate` 或独立迁移任务执行；生产 API/Worker 不在每次启动时自动迁移。发布步骤先检查兼容性、备份、停止需要停止的进程，再迁移和启动。

当前允许维护窗口，不引入零停机升级要求。已发布迁移不可修改；回滚应用不等于回滚数据结构。破坏性迁移必须说明恢复步骤及备份要求。

### 19.3 基本备份与恢复

提供明确的数据库和对象存储备份/恢复命令，不只备份 PostgreSQL 而遗漏附件。备份记录应用/迁移版本、对象位置及必要配置说明；secret 另行安全保存，不混进公开示例。

建议单机使用短维护窗口：停止新的 mutation/上传授权，等待在途 API（包括文件完成）结束，停止并 drain Worker，再备份数据库与该快照引用的 ready 最终对象。最终对象不可覆盖，维护期间也不执行清理；此前签发的 PUT 只能写暂存区，不影响这组已发布对象。

未完成上传不属于已提交附件备份的保证范围，暂存区不作为业务附件恢复。恢复时将 pending_upload 标记过期并要求重新上传；清理任务对缺失对象仍按幂等成功处理。若改成备份整个可变 bucket，必须先阻断对象写入或等待全部上传凭据及在途写入结束，不能仅停 API 就宣称存储已静止。

至少在独立空环境恢复一次，验证账号、知识库、文档、附件和 Job 状态。恢复命令默认不覆盖正在运行的生产数据。

不设置未经讨论的 RPO/RTO 数字承诺，也不做 HA 演练。删除后的内容可能仍存在于此前备份中；备份轮换和恢复后清理在运维指南明确，不承诺删除请求即时抹除所有历史备份。

## 20. 文档、教程与 Agent 导航

### 20.1 Canonical Source

仓库 Markdown 是唯一可编辑文档来源：

```text
docs/ + selected root docs
 -> projection script
 -> apps/docs/.generated
 -> VitePress
```

`.generated` 不提交、不手改。生成结果与来源有可追踪关系；不存在手工维护第二套教程网站内容。

### 20.2 Generated References

API 从 OpenAPI、Config 从 Settings、Permission 从权限定义、Event/Job Catalog 从实际 registry、CLI 从命令 registry 生成。不为尚未实现的 Event 或 broker 生成仿真的完成清单。

Contracts/SDK 采用版本固定、输出稳定的生成流程，提交需要被消费者直接使用的产物；docs 的投影构建输出不提交。两种生成资产规则分别写明，不能混用。

`just docs-check` 校验投影、生成引用、内部链接、导航、可执行 snippets、公开页面 manifest 和源/产物漂移。失效的教程代码应让检查失败。

### 20.3 根文档

- `README.md`：启动路径、自助注册与首账号初始化、常用命令、在线教程入口、移除 example 的入口。
- `CONTEXT.md`：只记录领域术语，不放实现细节。
- `ARCHITECTURE.md`：稳定的依赖、数据与事务硬规则。
- `AGENTS.md`：短小的阅读顺序、模块边界、检查命令与文档更新条件。
- `docs/adr/`：仅记录有真实取舍且难以逆转的重要决策。

### 20.4 在线站点的四条学习路径

VitePress 站点必须提供以下入口，不能仅把 OpenAPI 页面当作完整教程：

| 路径 | 使用者最终做到什么 |
| --- | --- |
| 快速开始 | 从 clone、配置与启动，到自行注册、写第一篇 Markdown、上传 RustFS 附件 |
| 跟做 example | 按章节理解并复现文档模型、API、SDK、页面、权限、文件、任务、缓存和测试的接线 |
| 实现自己的业务 | 沿相同步骤新增/替换领域模块，知道哪些 Core 能力直接复用 |
| 移除 example / 参考手册 | 真正移除示例后运行 Core；查配置、API、权限、Jobs、部署与故障恢复 |

每一章包含学习目标、起始状态、改动文件清单、真实源码定位、可运行命令、预期业务结果、至少一个相关失败场景、对应测试，以及“换成自己的业务时改哪里”。涉及功能的 PR 同时更新该章，章节中的代码片段从实际源码引用或执行校验，不另存一份会漂移的完整实现。

跟做过程中默认对着当前版本的 example 源码，不要求在本地覆盖已经实现的同名模块。如果教程要求从某个阶段开始编码，需提供对应 tag/commit 或受控练习起点，并在 CI 验证起点到目标步骤可执行。

### 20.5 教程顺序

```text
01 Run, Register and Write Your First Document
02 Understand Core and the Replaceable Example
03 Define a Document Model and Migration
04 Build the Application Use Case and HTTP / OpenAPI Contract
05 Generate the SDK and Connect a Shared View
06 Add Markdown Editing, Validation and Concurrent-save Handling
07 Add Knowledge-base Authorization and Audit
08 Upload / Download Attachments through RustFS
09 Export One Document with a Durable Job and Worker
10 Add Completion Notification and Retry a Failed Task
11 Add a Real Redis Cache and Rate Limit
12 Call the Same API with an API Key
13 Trace the Request, Job and Object Storage Operation
14 Test the Module and User Journey
15 Add a Performance Contract
16 Keep Generated References and the Online Guide in Sync
17 Deploy and Restore a Single-host Instance
18 Enable Observability / Run the Electron Shell
19 Replace the Example with Your Own Business
20 Remove the Example and Verify Core Still Works
21 Optional Extension: External Events, Outbox and a Broker
```

前 20 章围绕同一参考实现与 v1 已交付能力，不要求用户为理解基础写作流程先阅读全部章节。最后的扩展章在相应实现尚未交付时只能作为明确标注的设计说明。

### 20.6 在线发布与验收

`just docs` 本地预览，`just docs-build` 产出静态站点。CI 为每个 PR 构建并检查站点；默认采用 GitHub Pages 发布受保护主分支/发布版本的通过检查的产物，也保留静态站点由 Caddy 托管的方式。

README 提供实际可访问的在线教程 URL，并注明教程对应的 release/tag/commit；稳定版页面链接到同版本源码，避免网站讲的是另一份代码。版本对应可先用清楚的版本标识与固定源码链接实现，不强制复杂的多版本站点系统。

文档中代码、截图、测试数据不得包含生产 secrets 或真实企业内容。站点应提供清楚的导航、可复制代码、移动端可读布局和站内查找，能从教程跳转 API/配置参考并返回。

Phase 0 即交付文档站骨架、构建与发布配置；功能逐步实现时持续补齐在线内容。v1 发布验收必须确认在线入口可访问、核心跟做流程可复现、参考链接有效和删除 example 后 Core 文档仍能构建。仅生成 Markdown 文件或仅有一个未发布的构建包，不算完成在线文档交付。

研究依据见 [两个参考模板的事实与启发](./research/template-reference-patterns.md)。借鉴其简单业务与学习路径，不假定它们已经具备本项目要求的完整删例工具。

## 21. 统一命令与 CI

| 命令 | 合同 |
| --- | --- |
| `just dev` | 启动完整开发能力与 HMR，包含邮件捕获、Worker 和对象存储 |
| `just check` | 本地/CI 主门禁，覆盖默认 Web/Rust/Core/文档/contract/perf-ci；排除 Mobile 与长测 |
| `just test` | 默认测试矩阵；真实依赖由受控测试环境提供 |
| `just test-backend` | 后端公开接口、必要 Domain 与真实适配器/HTTP 测试 |
| `just test-frontend` | Vitest / React Testing Library / user-event；MSW 只替代 HTTP 边界 |
| `just e2e` | 完整知识库旅程，真实服务，邮件捕获 |
| `just docs` / `just docs-check` | 文档预览与完整文档检查 |
| `just docs-build` | 构建可发布的静态在线文档站 |
| `just example-remove --dry-run` / `just example-remove` | 检查并移除全新工作副本中的示例，不删除已有业务数据 |
| `just check-core` | 运行独立 Core 的编译、测试和合同检查，支持实际移除示例后的验收 |
| `just migrate` | 显式运行迁移 |
| `just backup` / `just restore` | 按单机操作文档执行备份与向独立环境恢复 |
| `just perf` | 输出性能命令索引与选定基线，避免隐式启动长压测 |
| `just perf-ci` | 短、确定的 query/响应/bundle 等预算验证 |
| `just perf-load` | 常规负载与趋势报告 |
| `just perf-saturation` | 逐级并发并记录饱和点 |
| `just perf-trajectory` | 完整知识库使用轨迹 |
| `just perf-soak` | release/nightly 长测 |
| `just perf-desktop-soak` | Electron 资源增长检查 |
| `just check-mobile` | 独立 Mobile 工具链与 skeleton 检查 |

命令必须明确前置工具、会启动哪些服务、数据目录与清理规则。不应在用户已有数据库上直接跑破坏性测试。端口冲突、缺 Docker、缺配置等应给可行动的错误。

GitHub Actions 包含 fmt/lint/typecheck、unit、integration、frontend、OpenAPI/SDK drift、boundary check、docs-check、perf-ci、build、E2E；可以并行独立步骤，不要求串成最长流水线。

Rust 至少执行 fmt、clippy 与测试；前端执行 lint/typecheck/test/build。缓存不掩盖生成产物漂移。Secrets 不提供给不受信任的 PR；测试默认使用临时依赖和测试配置。

默认 check 中 Desktop 至少覆盖 TypeScript、共享 Views 接线、preload/IPC 合同与构建；需要 GUI 的壳 smoke 放入明确的 CI job。长时间 desktop soak 和 Mobile 均不进入普通 PR 主循环。

### 21.1 GitHub 与 ask-matt 开发流程

本项目使用 GitHub Issues 管理工作，遵循 `grill-with-docs → to-spec → to-tickets → implement（逐票 TDD）→ code-review`。当前工作是多会话构建，实施票按可演示的纵向行为拆分，每张同时交付所需的持久化、API、页面、测试与在线教程。

发布前审阅粒度、测试入口与真实 blocking edges；发布后使用 GitHub 原生依赖关系，只有 blockers 均完成的票才能领取。每票从自足 Issue 开始新上下文，不要求实施者依赖本次设计聊天。规格 Issue 是来源，不当作一张大实现任务。

`ready-for-agent` 表示验收已经充分，不表示可以忽略未完成的依赖。由 `to-tickets` 产生的票直接进入实施流程，不重复走面向外部需求的 triage。

流程配置见 [开发流程](./agents/development-flow.md) 与 [GitHub tracker](./agents/issue-tracker.md)；当前拆分见 [Template v1 实施票计划](./plans/template-v1.md)。

## 22. 实施阶段与完成标准

质量、安全、文档与可观测性随行为一起加入，不能留到最后一个阶段补齐。

阶段用于汇总能力，实际实现以经审阅的纵向 GitHub 票及其直接 blocking edges 为准。测试和在线教程属于每张功能票；可独立开始的分支不因阶段编号而人为等待。

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| 0 工程骨架 | Cargo/pnpm workspace、固定工具链、just、CI、VitePress/投影与发布骨架、Compose、Settings、tracing | 最小 `just check` 真正执行；本地 docs 预览与静态构建可用；发布环境就绪后提供在线入门页 |
| 1 全栈合同 | Axum + PostgreSQL、OpenAPI/SDK、Web Router/Query、shared packages、Electron shell、Mobile skeleton | Web/Desktop 使用同一合同；生成漂移能被发现；空库迁移验证 |
| 2 Core 首条旅程 | 自助注册/登录、首账号初始化、Session、成员、最小 Audit | 注册→自动登录；并发注册和停用保护；普通注册不依赖发信，对应在线教程同步交付 |
| 3 知识库示例 | 个人写作空间、库级权限、Markdown/预览、标题搜索、版本冲突、RustFS 附件与清理 | 注册用户直接写作；Reader/Editor/未授权矩阵；对应教程、源码导读和 E2E 同步交付 |
| 4 特性贯通 | PG Jobs/Worker、文档导出、异步密码找回、API Key、实际 Redis 缓存/限流、站内通知、审计/trace、任务运维 | 每项默认核心能力都有实际示例、在线教程及测试；文档导出失败可恢复；移除示例验收 |
| 5 工程门禁完善 | 完整测试矩阵、generated references、boundary、性能预算、k6、Desktop smoke/soak、移除脚本演练 | `just check` 可信；覆盖矩阵逐行验收；跟做教程可复现；删例后 Core/文档仍通过；保存性能基线 |
| 6 单机生产交付 | Caddy、生产 Compose、备份/恢复、依赖降级、关停、可选 OTel stack | 独立环境恢复成功；API/Worker 重启恢复；请求到任务因果链可追踪 |
| 7 按需扩展 | 正文全文搜索、外部消息、Outbox/Inbox、商业模块、AI/Agent 等 | 有真实需求和独立验收后才增加依赖 |

自助注册不依赖邮件送达。密码找回的异步发信、附件清理和文档导出在各自验收前具备真实 Jobs/Worker；每个阶段同时更新可运行示例、教程正文、生成引用和在线站点，不把教程集中留到最后补写。

### 22.1 模块 Definition of Done

每个模块明确用户行为、授权、业务约束、输入/错误、持久化、审计、并发、适用的幂等、可观测性、迁移、测试、文档和性能影响。关键旅程包含 E2E。涉及 example 的功能同时交付可跟做教程、源码链接、所覆盖 Core 能力和移除归属，并在 docs-build/docs-check 中通过；仅页面存在、返回 200 或只有设计说明不能算完成。

### 22.2 Template v1 验收

- 新开发者按文档 `clone → just dev → 打开注册页面` 即可注册并编写自己的 Markdown 文档。
- 自助邮箱密码注册/登录、首账号初始化、成员与最后 Owner 约束可用，无邀请前置。
- 库级授权、Markdown/预览、标题查找、RustFS 附件、文档导出、API Key、审计和通知具有真实示例与验收。
- PostgreSQL 是业务事实来源；Redis 可降级；文件通过 S3 协议；Worker 可从失败中恢复。
- 默认路径不需要 RabbitMQ、NATS、AI、Kubernetes 或完整观测集群；文档导出使用已有 PG Jobs 与 RustFS。
- Web 可用；Electron 安全壳复用 Views；Mobile skeleton 与默认工具链分开。
- Domain/Application/Adapter/HTTP/frontend/E2E/contract/boundary/docs/perf-ci 均有实际检查。
- 单机生产 Compose、TLS、持久卷、health、graceful shutdown、备份与一次恢复验证完成。
- 提供可访问的在线教程站，README 链接到对应版本；教程和生成 API/config/permission/job 等引用指向真实实现。
- `just example-remove` 能在全新工作副本移除示例；移除后合同、Core 检查、迁移与文档站构建通过，并有仿照示例实现自己业务的教程。

## 23. 后续扩展的原则

Billing、Entitlement、Usage Metering、Webhook、Feature Flag、Search、企业 SSO、AI/RAG 和 Kubernetes 以具体需求进入，不是 Core 的隐含前置条件。

商业配额先在需要它的业务中定义，例如“一个套餐可建多少知识库”；平台已有的单文件大小、请求频率或 Worker 并发限制不等于一套 Billing 引擎。只有出现可验证的复用需求，才抽取通用商业能力。

AI/Agent 层可以依赖 Identity、Organization、Permission、PostgreSQL、ObjectStorage、Jobs、Audit 和 Observability；这些基础能力不反向依赖 AI。

新增基础设施前说明：现有方案遇到什么具体约束，新能力改变哪些一致性和运维边界，如何测试、迁移与回退。规模演进不能只靠把架构图中的可选框全部启动。

## 24. 已明确的修订与其余默认

用户已经明确自助注册、像写博客一样编写 Markdown、上传附件并使用 RustFS；示例是覆盖大多数核心功能的可运行教程，必须容易移除，功能与在线教程同步实现。此前邀请注册建议已撤回，不再作为待确认方案。

普通用户主流程固定为“注册 → 写 Markdown / 预览 → 保存 → 上传附件”。个人知识库的自动准备使注册用户立即可写，同时保留知识库级权限与 Core 可独立运行的边界。

当前实施默认包括：

1. 首账号为 Owner，之后为 Member；Owner/Admin 能管理并访问全部知识库，普通成员按 Grant 访问其他库。
2. 保存即生效、首发标题搜索，无审批、历史版本 UI 或回收站。
3. 用真实文档导出、缓存、API Key、权限和通知串联特性；PostgreSQL Jobs 起步，独立 broker 后置。
4. Axum 管邮箱认证与 Session，React 提供注册/登录和业务界面，不增加 Better Auth 服务。
5. TTL、重试、容量和性能预算是可配置实施起点，仍需实现与验证。

这些默认服务于简单且完整的学习路径；注册方式、RustFS 和教学交付要求已经由用户确定。

后续根据反馈只调整相关合同与教程，不把“覆盖大多数特性”理解为增加大量业务流程，也不把“业务简单”理解为只留下一个无法展示模板能力的 CRUD。
