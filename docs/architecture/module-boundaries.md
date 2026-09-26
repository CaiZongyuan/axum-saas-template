# Core 与参考业务的边界

Core 提供身份、会话、成员、审计、幂等、文件、任务、通知、邮件、API Key 和通用 HTTP 能力。Reference Domain 通过应用入口接入自己的业务；Core 不反向依赖它。

- **platform** 拥有配置、连接池、迁移运行、可选 Redis 文本缓存与日志初始化，不依赖应用或知识库类型。
- **app** 的各个模块拥有自己的用例和表；纯 `domain.rs` 不依赖 HTTP 或数据库。
- **API 入口** 在 `apps/api/src/lib.rs` 组装 Router/OpenAPI，通用构建器接收额外路由与合同。
- **contracts / sdk** 来自 OpenAPI 生成；SDK 的类型使用 contracts。
- **core** 放平台无关的客户端 helper。
- **ui / views** 分别提供通用 React DOM 组件与可共享页面。
- **Web 入口** 拥有浏览器和 Router 接线，shared View 通过回调导航。

[示例所有权清单](../../examples/knowledge-base/manifest.json)记录业务目录、迁移、测试、教程和明确的组装区块。新增功能时同步登记；后续移除工具按登记内容操作，Core 的能力不会随参考业务一起删除。

```bash
pnpm boundaries:check
```

当前检查验证包导入方向、Core 对参考类型的直接引用、纯 Domain 的基础设施导入、模块声明的 SQL 表归属，以及组装清单。每个 Rust 模块的 `module.json` 是表归属入口；跨模块通过公开接口协作，例如让 Audit 在调用者事务中追加记录。

SQL 检查基于源码中的字符串和已登记表名，不能证明动态 SQL、引号标识符或符号别名的全部行为；这些仍需 review。Rust 可见性与真实 HTTP/数据库测试共同补充验证。实际删例验收由移除工具对应任务执行。

引入自己的业务时，使用公开身份、文件和任务能力；不要让 Core 通过私有表或反向 import 依赖示例。进一步决策见[可移除教程 ADR](../adr/0002-executable-removable-reference.md)。

Notifications 拥有任务通知意图和收件箱；业务用公开接口在请求事务中登记意图，Jobs 在终态事务中发布通知。导航目标由应用壳解析，Core View 通过回调打开；目标 API 始终重新授权。未知目标不影响读取与标记已读。

API Keys 管理通用凭据及其 scopes。应用入口注册各模块实际提供的 scope，业务处理器通过公开认证能力取得当前用户，再执行自己的资源授权。Core 的 profile:read 与 Key 管理在示例移除后保留；一次性 secret 不进入重放、查询或 Mutation 缓存。

CoreOptions 在应用组装点传递 scope 注册和共享 Cache。Cache 只处理有预算的 Redis I/O 与进程计量，Knowledge 自己负责数据库授权、正文版本和 key；Core 不保存或复用业务权限结论。

RateLimit 在 Core 中分类请求、维护有界本地回退和固定策略计量；Platform WindowCounter 执行有限 Redis 原子操作。缓存与计数共享私有 transport 实现，各自持有容量和超时预算；业务模块不直接发送任意 Redis 命令。

Identity 拥有重置有效性、hash、短期密文表与邮件 Handler；Mail 提供有界加密/解密与投递能力，Platform 封装 SMTP。Jobs 只保存 reset ID，并负责租约和重试。Core 的密码重置页面、教程与浏览器测试独立于知识库所有权，删例后保留。

Platform Telemetry 封装可选 OTel exporter、W3C 传播、有限计量与有损 JSON 日志出口。Application 使用 tracing 与公开 scope；HTTP 的认证成功点记录 actor，Jobs 在同一事务保存观测 metadata，Worker 从持久 parent 建立新 attempt span，Audit 记录当前有效 trace ID。Domain 不依赖 OTel，业务 payload 不携带运行时 Context。

`just dev-observability` 将通用 Collector/Prometheus/Loki/Tempo/Grafana profile 与正常开发入口一起启动；`just observability-down` 只停止观测服务并保留卷。Core 的配置参考、HTTP/Job/存储计量、审计关联、看板和协议/故障测试在删例后仍保留。trace ID 不用于授权，采样和观测出口失败不改变业务状态。原始请求内容、凭据、签名 URL 与第三方 transport debug 输出不进入观测管线。
