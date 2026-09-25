# Core 与参考业务的边界

当前 T01 只有通用服务状态这一条完整请求。它属于 Core，不属于知识库示例。

- **platform** 拥有配置、连接池、迁移运行与日志初始化，不依赖应用或知识库类型。
- **app** 拥有公开 HTTP 合同、Core 模块和必要的用例。
- **API 入口** 组装 Router；未来在这里挂载可替换的知识库模块。
- **contracts / sdk** 来自 OpenAPI 生成；SDK 的类型使用 contracts。
- **core** 放平台无关的客户端 helper。
- **ui / views** 分别提供通用 React DOM 组件与可共享页面。
- **Web 入口** 拥有浏览器和 Router 接线，shared View 不自行访问 window。

[示例所有权清单](../../examples/knowledge-base/manifest.json)目前明确标记知识库尚未实现，ownedPaths 为空，列出未来组装位置。不能为了准备目录而宣称已经有注册或文档业务。

```bash
pnpm boundaries:check
```

当前检查验证包依赖方向、平台无关代码的导入以及组装清单。它不声称已经验证不存在的业务表隔离或完整删例能力；实际移除工具属于对应实施票。

引入自己的业务时，使用公开身份、文件和任务能力；不要让 Core 通过私有表或反向 import 依赖示例。进一步决策见[可移除教程 ADR](../adr/0002-executable-removable-reference.md)。
