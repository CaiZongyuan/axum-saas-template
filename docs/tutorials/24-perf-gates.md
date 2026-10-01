# 为业务接口建立确定性性能预算

把性能合同写成可自动检查的行数、数据库往返次数和载荷字节数。这样业务演进时，额外副作用、N+1 与列表携带大正文会成为明确的失败；跨机器的 P95/P99 另写[负载报告](25-load-reports.md)。

本指南需要已通过 HTTP 行为测试的业务、真实 PostgreSQL，以及已安装依赖的工作副本。命令在仓库根目录执行，测试使用隔离数据库。

## 从真实 HTTP 操作定义预算

现有两份实现可直接运行：

```bash
node scripts/test-backend.mjs --test perf_registration --test perf_documents
```

| 公开操作   | 当前断言                                                                                     | 代码位置                                                          |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 注册成功   | 1 User、1 Credential、1 有效 Membership、1 注册 Audit；Session 单独计数；无 Job/Notification | [perf_registration.rs](../../apps/api/tests/perf_registration.rs) |
| 重复注册   | 409，用户与审计没有重复写入                                                                  | 同上                                                              |
| 文档列表   | 数据规模增加时最多 4 次数据库往返；载荷最多 256 KiB，不含正文                                | [perf_documents.rs](../../apps/api/tests/perf_documents.rs)       |
| 创建或导出 | 业务行、Audit、Job、通知意图按操作精确计数；重放不新增副作用                                 | 同上                                                              |

给自己的模块新增 `apps/api/tests/perf_<业务>.rs`，沿用真实 Router 和 `#[sqlx::test(migrations = "../../migrations")]`。先完成一次 HTTP 操作，再比较该操作前后的行数；拒绝和幂等重放也要检查零额外写入。为列表播种小、大两档数据，比较数据库往返和响应字节，避免只在空库里检查。

这里的表计数属于专门的性能观察入口，普通业务测试仍从公开 HTTP 结果验收。跨模块 Audit/Job 的计数是副作用合同，不能让业务实现直接读写它们的私有表。

## 计量查询次数

文档预算使用 sqlx 的 `sqlx::query` tracing 事件计量真实执行语句，完整订阅器在 [perf_documents.rs](../../apps/api/tests/perf_documents.rs)。订阅器处理 callsite interest 缓存并按测试线程计数；复用它的做法时保留隔离条件，不能把并发测试的全部查询累加到同一请求。

如果新业务把查询移到额外的异步任务，先确认计量范围确实包含该执行路径。通过几次计数不代表动态 SQL 或不同运行配置已经覆盖。

## 客户端包体预算

后端项目只有新增 Web 客户端时才需要这一项：

```bash
node scripts/perf-bundle.mjs
```

工具真实构建 Web 并按 [baselines.json](../../scripts/perf/baselines.json) 检查 gzip 字节。当前初始集上限 400 KiB、异步 chunk 上限 500 KiB；Markdown、设计系统、图标目录必须懒加载。初始集同时包含入口 script 和 modulepreload，静态依赖不能借异步预算绕过检查。报告写到 `.scratch/perf/bundle-report.json`。

## 查询计划是诊断材料

```bash
node scripts/perf-query-plans.mjs
```

工具在一次性数据库的 10 / 1,000 / 100,000 行档位执行参考业务的 `EXPLAIN ANALYZE`，输出 `.scratch/perf/query-plans.json`。为自己的热查询增加等价的播种与查询，保持 SQL 与实现同步。报告记录计划和时长，不把 Seq Scan 或某个毫秒数直接判失败；内联字面量的计划也可能不同于 sqlx 预编译语句路径。

## 接入日常检查与调整基线

```bash
just perf
just perf-ci
```

`just perf` 运行现有预算测试、包体门禁和查询计划报告；新测试名应同步加入其定向配方。后端完整套件会自动执行新增集成测试。`just check` 通过 `just test` 和 `perf-ci` 覆盖确定性预算，不隐式执行负载或桌面长测。

失败时先检查新增写入、N+1、列表投影和同步导入。合理的预算变更应在同一 PR 提供变更前后完整测量、理由和旧/新阈值，并更新基线；不要在引入回归的提交中静默抬高上限。

注册预算、包体计量与报告工具属于 Core。文档预算随知识库示例移除；查询计划工具在缺少示例时说明并退出。为自己的业务登记测试所有权和自己的预算，参考应用的通过结果不能替代它。

下一步：[为自己的热路径编写受控负载场景](25-load-reports.md)。
