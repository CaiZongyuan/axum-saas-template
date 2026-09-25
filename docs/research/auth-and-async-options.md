# 邮箱认证与后台任务：选型学习笔记

查证日期：2026-09-25。范围：React 前端、Rust/Axum API、单机部署的起步方案。讨论期间用户已选择企业知识库作为参考应用，并选择邮箱 + 密码认证；其余建议不等于已经确认的架构决策。事实引用官方文档或官方文档仓库，不作性能排名。

## 1. Better Auth 到底负责哪一层

登录页面、认证服务、业务 API 是三个不同职责：页面收集输入；认证服务核验凭据并管理会话；业务 API 根据当前身份判断能否读取或修改业务数据。这是本项目讨论选型时采用的职责划分。

Better Auth 官方将自己定义为 **TypeScript 认证与授权框架**。安装流程要求创建服务端 `auth.ts`，初始化 `betterAuth`，配置存储，并在服务器挂载 `/api/auth/*` 处理器。它同时提供客户端库，React 的 `createAuthClient` 来自 `better-auth/react`，作用是与认证服务器交互。[官方介绍][auth-intro]、[安装流程][auth-install]。

因此，Better Auth 并不是只装到 React 页面里就能完成认证的 UI 组件。采用它时，仍需要运行其服务端代码。官方安装示例包括 Node.js/Express、Hono、Cloudflare Workers 等；Workers 示例还要求相应的 AsyncLocalStorage 兼容配置。这里的 “framework-agnostic” 不能理解为存在任意编程语言的原生服务端实现。[安装流程][auth-install]。

**对本项目的推论：** React 可以直接调用 Axum 提供的认证接口。若采用 Better Auth，同时保留 Rust 业务 API，就需要安排承载 Better Auth 的 JavaScript 服务端运行环境，并设计它与 Axum 之间的身份验证和会话边界。React SDK 本身不会替代这部分集成工作。

在本次查阅的官方安装与介绍页面中，未发现 Axum 的第一方集成说明。这是查证范围内的结果，不代表不能经 HTTP 或其他方式集成，也不是对所有社区方案的穷尽调查。

**当前建议：** 简单邮箱认证先放在 Axum Identity 模块，React 负责表单与会话状态展示；暂不为了 React 客户端 SDK 增加 Better Auth 服务。后续若确认需要它提供的一组认证功能，再比较总实现成本。这个建议不等于自行发明密码算法或安全协议；具体 Rust 库和会话方案还没有选定。

## 2. “邮箱登录”仍有不同的用户体验

| 方式 | 用户如何完成登录 | 对本项目意味着什么 |
| --- | --- | --- |
| 邮箱 + 密码 | 输入邮箱和自己设置的密码。Better Auth 内置支持该方式，并提供邮箱验证、密码重置相关接口。[来源][auth-password] | 需要维护密码、验证邮箱与忘记密码流程；用户完成这些流程后，普通密码登录不用每次等待登录邮件。这是依据流程作出的设计推论。 |
| 邮箱验证码（OTP） | 请求发送验证码，再提交邮箱中收到的验证码。Better Auth 的插件要求实现发送邮件的 `sendVerificationOTP` 方法。[来源][auth-otp] | 纯 OTP 登录可以不提供密码与找回密码页面，但每次新的登录流程依赖邮件送达；验证码过期、尝试次数和发送频率仍需要设计。这是依据流程作出的设计推论。 |

这些是身份验证方式，不是前端框架选择。用户现已选择邮箱 + 密码；上表保留 OTP 的比较，便于理解为什么“邮箱登录”原本仍需要明确流程。Magic Link 未继续调研，不作为当前候选展开。

## 3. 后台任务和独立消息服务不是同一项决定

以企业知识库中可能出现的“导出一份文档”为例：请求先记录待办任务，Worker 稍后生成文件，页面显示执行状态。这说明需要后台执行能力，但还没有说明必须部署 RabbitMQ 或 NATS。文档导出、邮件发送仅用于解释异步任务；参考应用的具体功能，尤其 AI 检索及导入方式，仍需另行确认。

### PostgreSQL 可以怎样帮助领取任务

PostgreSQL 官方文档明确：`FOR UPDATE SKIP LOCKED` 会跳过不能立即获得行锁的记录；这种读取会产生不一致的数据视图，不适合一般查询，但可用于多个消费者访问队列表时减少锁竞争。它只改变行锁等待行为，所需表锁仍按正常方式获取。[PostgreSQL SELECT][pg-select]。

因此，“多个 Worker”本身不是必须引入独立 broker 的理由。**设计推论：** 可以将任务作为 PostgreSQL 表中的记录，由多个 Worker 领取。不过 `SKIP LOCKED` 只是数据库原语；领取后如何记录执行状态、崩溃后如何重新领取、重试几次、何时结束，都还需要任务实现负责。不能把一条 SQL 等同于完整的可靠任务系统。

PostgreSQL 事务可以将多步数据库操作合成“全部成功或全部不生效”的操作，未完成的中间修改不会暴露给其他事务。[PostgreSQL 事务教程][pg-transactions]。**设计推论：** 如果业务记录与 job 记录在同一个数据库中，可以放在同一个事务里提交；无需为了可靠入队而强制先写 Outbox，再由 Dispatcher 搬到同库 jobs 表。若以后需要向独立 broker 发布，数据库提交与外部发布之间才出现新的可靠性边界，可在那时评估 Transactional Outbox。任务实际执行时的重复与恢复问题仍需单独解决。

### 三种方案分别值得什么时候讨论

| 方案 | 本次查证的事实 | 对当前单机模板的评估建议 |
| --- | --- | --- |
| PostgreSQL Jobs | PostgreSQL 提供适用于多个消费者访问队列表的锁定机制。[来源][pg-select] | 已经依赖 PostgreSQL、主要处理本应用导出或发信等后台工作时，可先用任务表和 Worker。仍要实现或采用可靠的任务状态、重试和恢复机制。 |
| RabbitMQ | 提供发布确认与消费确认；二者覆盖不同通信边界。手动确认模式下，连接或 channel 关闭时，未确认的消息会重新入队。负面确认还可选择重新入队，或在配置后进入 dead-letter 路径。[来源][rabbit-confirms] | 当实际需求需要独立消息分发设施、明确的确认与失败处理机制，或要接入已有 RabbitMQ 系统时值得评估。是否引入应依据示例和运维能力，不因“有异步任务”就默认必装。 |
| NATS JetStream | JetStream 在 Core NATS 上增加持久层；stream 保存消息，consumer 跟踪读取进度，未按时确认会重投，并支持从开始、最新位置、指定序号或时间消费。[来源][nats-js] | 当实际需求涉及保存事件、消费者独立进度、后续重放时值得评估。需要明确存储及保留配置；不能只在依赖表写“NATS”就认为已具备持久任务语义。 |

这些是讨论侧重点，不是互斥能力分类。RabbitMQ 也存在 stream 概念，官方确认文档亦有涉及；不能据此表断言“需要重放就只能选 NATS”。[RabbitMQ 确认机制][rabbit-confirms]。

**Core NATS 与 JetStream 必须区分：** 官方文档描述 Core NATS 为最多一次投递，只向发布当时已连接的订阅者发送，不提供重放；JetStream 才增加持久层、至少一次投递与重放。[NATS JetStream][nats-js]。

“消息到达服务”也不等于“业务动作已经完成”。RabbitMQ 明确发布确认与消费确认相互独立，并提醒消费者准备处理重投、实现幂等；JetStream 也会对未确认的消息重投。[RabbitMQ 确认机制][rabbit-confirms]、[NATS JetStream][nats-js]。本项目应讨论同一任务重复执行时如何避免产生重复业务结果，而不是假设选了某个 broker 就自然获得业务上的恰好执行一次。

**当前建议：** 先明确参考应用的后台工作，用 PostgreSQL Jobs 作为起步候选。暂不承诺第二种队列 adapter；出现具体的跨服务消息、订阅或重放需求后，再对照场景比较 RabbitMQ 与 NATS JetStream。单机并不禁止使用 broker，也不构成需要 broker 的理由。

## 4. 尚未核实或决定的事项

- 未做项目负载测试，不能给出 PostgreSQL Jobs 的吞吐上限，也不能声称 RabbitMQ 或 NATS 在本项目中必然更快。
- 未比较 Rust 认证库、RabbitMQ/NATS 客户端或现成 PostgreSQL 任务框架，不指定 crate。
- 邮箱 + 密码已确认；邮箱验证、密码重置及会话的具体行为仍需写入实施规范。
- 尚未确定独立认证服务、独立 broker 或第二种 adapter 的交付要求。
- 官方 `current` 页面与 GitHub `main` 会变化；本文是查证日的学习材料，落地时还应按选定版本复核。

[auth-intro]: https://www.better-auth.com/docs/introduction
[auth-install]: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx
[auth-password]: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx
[auth-otp]: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/email-otp.mdx
[pg-select]: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
[pg-transactions]: https://www.postgresql.org/docs/current/tutorial-transactions.html
[rabbit-confirms]: https://github.com/rabbitmq/rabbitmq-website/blob/main/docs/confirms.md
[nats-js]: https://docs.nats.io/nats-concepts/jetstream
