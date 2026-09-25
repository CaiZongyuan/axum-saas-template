# Core 与参考业务的边界

Core 提供身份、会话、成员、审计、幂等和通用 HTTP 能力。Reference Domain 通过应用入口接入自己的业务；Core 不反向依赖它。

- **platform** 拥有配置、连接池、迁移运行与日志初始化，不依赖应用或知识库类型。
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
