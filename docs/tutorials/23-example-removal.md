# 移除内置业务并保留 SaaS Core

从自己的模板工作副本移除知识库业务，让账号、成员、Session、Files、Jobs、通知、审计、邮件、API Key、限流和遥测继续服务自己的 SaaS。Example Removal 改变源码与派生产物，不删除现有生产数据库、对象或密钥。

前提是干净 Git 工作副本和已安装工具链。命令在仓库根目录运行；先保存自己的改动，或在独立临时副本演练，不在未提交的工作上强行执行。

## 先检查所有权与预览

```bash
just example-remove --dry-run
```

默认示例 id 为 `knowledge-base`。[工具](../../scripts/example-remove.mjs)读取 `examples/<id>/manifest.json`，列出路径、注册区块、教程导航、独占依赖和再生命令，不写文件。

| 清单字段                                       | 作用                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `ownedPaths`                                   | 独占源码、测试、迁移和双语教学页                           |
| `registrationMarkers`                          | 共享组装文件里的成对 `example:<prefix>:<marker>:start/end` |
| `compositionPoints`                            | 需要改写而非删除的 API、Worker、Web、文档入口              |
| `ownedDependencies` / `ownedCargoDependencies` | 只属于该业务的依赖                                         |
| `retainedMigrations`                           | 移除代码后保留的历史迁移                                   |

所有权冲突、缺失/重复 marker、未知 id 或未提交改动会阻止实际执行。遇到拒绝，按报告修复归属或保存改动；不要通过关闭保护绕过自己的定制。

## 选择迁移历史策略

已应用或发布过迁移的项目使用默认路径：

```bash
just example-remove
```

业务源码和注册移除，历史迁移保留并登记 `retainedMigrations`。现有表和数据仍在，应用迁移集合/checksum 也保持一致。需要清理生产数据时另写新增迁移、对象清理与审计方案，不能删除已经执行过的迁移文件。

从未创建数据库的全新项目可选择：

```bash
just example-remove --trim-migrations
```

这会裁剪示例迁移，供新空库直接从 Core 初始化。工具不会连接数据库确认是否曾经执行，使用者必须保证这个前提；已有数据库不能采用裁剪路径。

## 验证缩减后的应用

```bash
just check-core
just docs-build
```

移除工具会重新生成 lockfile、合同/SDK 与文档参考。检查编译、真实 Core HTTP/任务行为、依赖边界、前端与文档构建；再运行自己的业务测试。

通用首页、身份入口和设置保留。已移除业务的历史通知仍可读/标记已读，但目标不可用；旧业务链接给出可恢复的不可用反馈，不能把历史记录当作存在的 API。默认业务入口被移除后回到通用首页，直接访问 `/` 始终是通用首页。

备份/恢复工具继续运行。参考业务专有的生产 smoke、恢复演练与负载场景会在缺少示例时说明并退出；应替换为自己的业务断言，不能把跳过解释为验收通过。

## 增减另一个参考业务

仓库附带只验证 UI 组合合同的便签，默认未注册，没有便签后端。装回和移除都要求干净副本；每次操作后先验证并提交自己的改动，再进行下一次：

```bash
node scripts/example-add.mjs --example notes
```

```bash
node scripts/example-remove.mjs --example notes --dry-run
node scripts/example-remove.mjs --example notes
```

未注册的便签缺少必要 marker，不能直接整体移除；先装回再移除，或按清单手工处理。该组合仍属于同一 Organization，见[源码组合 ADR](../adr/0003-static-example-composition.md)。

## 开始自己的模块

按[新增业务模块](../guides/develop-module.md)接入 Router/OpenAPI，再添加自有 schema、迁移和 `module.json`；身份、成员、Files、Audit 和 Jobs 使用公共接口。新注册区块应在被移除业务的 marker 外。

[新业务练习脚本](../../scripts/example-new-business.mjs)在已移除知识库的副本中创建真实后端便签模块、迁移和 HTTP 测试，验证注册 → 创建 → 读取；这是开发练习，与附带的纯 UI 便签不同。它会修改指定副本并需要 Docker/PostgreSQL，不能在生产工作副本重复执行：

```bash
node scripts/example-new-business.mjs --root /tmp/my-clean-core-copy
```

把 `/tmp/my-clean-core-copy` 替换为已完成删例的演练副本。

```bash
node --test tests/tooling/example-remove.test.mjs
pnpm boundaries:check
```

工具测试验证精确删除、dry-run、历史迁移、依赖/导航裁剪与拒绝行为。下一步：后端继续[新增模块](../guides/develop-module.md)，需要 Web 页面时再读[应用壳贡献](27-add-example.md)。
