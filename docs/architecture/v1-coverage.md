# v1 能力覆盖与验收

本页是 v1 的总账：规范 [§8.6 特性覆盖矩阵](../saas-template-architecture-spec.md)的每一行在这里落成真实链接——运行入口、源码导读、在线教程与验证一一对应，链接目标由文档构建的存在性检查守护（源文件不存在构建即失败），教程与源码不会悄悄失配。矩阵只收**已交付**的能力；设计说明（如规范 §15.2 的 Mobile、Outbox 扩展章）不进矩阵、不标覆盖，文档不留填空。Core 能力的证据直接写在矩阵里，并保证在《移除示例》之后仍然成立。

## 四条阅读路径

1. **快速开始**：[快速开始](../getting-started/quickstart.md)——工具链、`just dev`、注册首个账号、服务状态与失败场景。
2. **跟做教程**：从[第一条全栈请求](../tutorials/01-full-stack-request.md)起步逐章跟做，每章对应真实命令与测试。
3. **实现自己的业务**：[组合与移除参考业务](../tutorials/23-example-removal.md)——按所有权清单删掉知识库示例，Core 照常运行。
4. **验证与参考手册**：[运行测试与检查](../testing/t01-feedback-loop.md)、[Core 与示例边界](./module-boundaries.md)与生成参考（[API 合同](site:reference/api.md)、[API 配置](site:reference/config.md)）。

## Core 能力矩阵

| 模板能力                 | 运行入口                                                                | 源码导读                                                                                                                                                                           | 跟做                                                                                                                | 验证                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 注册、Session、配置      | `/register`；`POST /api/v1/auth/register`、`/auth/session`              | [identity](../../crates/app/src/modules/identity/)（含 [password_reset](../../crates/app/src/modules/identity/password_reset/)）、[config.rs](../../crates/platform/src/config.rs) | [02](../tutorials/02-registration.md) · [03](../tutorials/03-sessions.md) · [18](../tutorials/18-password-reset.md) | 注册/会话/密码重置 API 测试、[config](../../apps/api/tests/config.rs)、[e2e](../../tests/e2e/registration.spec.ts) |
| Organization、RBAC       | `/members`；角色调整、停用撤销会话、最后 Owner 保护                     | [organization](../../crates/app/src/modules/organization/)                                                                                                                         | [08](../tutorials/08-members.md)                                                                                    | [members](../../apps/api/tests/members.rs)、[e2e](../../tests/e2e/members.spec.ts)                                 |
| CRUD、SQLx、迁移         | `just migrate`；迁移集合与 checksum 必须匹配源码                        | [migrations/](../../migrations/)                                                                                                                                                   | [01](../tutorials/01-full-stack-request.md)                                                                         | [migration](../../apps/api/tests/migration.rs)、[e2e 迁移版本](../../tests/e2e/status.spec.ts)                     |
| OpenAPI、SDK、多端 Views | `pnpm contracts:check`；Electron 打开同一页面                           | [contracts](../../packages/contracts/)、[sdk](../../packages/sdk/src/)、[views](../../packages/views/src/)、[desktop](../../apps/desktop/src/)                                     | [20](../tutorials/20-electron-shell.md)                                                                             | [壳冒烟](../../tests/desktop/shell.spec.ts)、IPC 合同测试                                                          |
| RustFS / S3 / 文件权限   | `bootstrap-storage` 初始化私有 bucket 与浏览器 CORS                     | [files](../../crates/app/src/modules/files/)、[object_storage.rs](../../crates/platform/src/object_storage.rs)                                                                     | —（门禁与栈启动覆盖）                                                                                               | 每个测试栈启动时的 bucket 初始化检查                                                                               |
| Job、Worker、幂等        | `just dev` 启动 Worker；失败任务可显式重试                              | [jobs](../../crates/app/src/modules/jobs/)、[idempotency](../../crates/app/src/modules/idempotency/)、[worker](../../apps/worker/src/)                                             | —（门禁与测试覆盖）                                                                                                 | [jobs](../../apps/api/tests/jobs.rs)（认领/心跳/重试）                                                             |
| Notification / Mail      | 注册与密码重置邮件到达 [Mailpit](http://127.0.0.1:8025)                 | [notifications](../../crates/app/src/modules/notifications/)、[mail.rs](../../crates/platform/src/mail.rs)                                                                         | [18](../tutorials/18-password-reset.md)                                                                             | [e2e](../../tests/e2e/password-reset.spec.ts)、邮件 key 工具测试                                                   |
| Audit / Tracing          | `/audit`；`GET /api/v1/audit-events`                                    | [audit](../../crates/app/src/modules/audit/)、[telemetry](../../crates/platform/src/telemetry/)                                                                                    | —（门禁与测试覆盖）                                                                                                 | 遥测测试（含中断演练）                                                                                             |
| Redis / Rate Limit       | `/system` 展示缓存与限流状态                                            | [rate_limit](../../crates/app/src/modules/rate_limit/)、[system cache](../../crates/app/src/modules/system/cache.rs)、[platform cache](../../crates/platform/src/cache.rs)         | [17](../tutorials/17-rate-limits.md)                                                                                | [e2e](../../tests/e2e/rate-limits.spec.ts)、限流支持测试                                                           |
| API Key                  | `/api-keys`                                                             | [api_keys](../../crates/app/src/modules/api_keys/)（签发与会话验证）                                                                                                               | —（门禁与测试覆盖）                                                                                                 | [api-keys View 测试](../../apps/web/src/api-keys.test.tsx)                                                         |
| 测试 / 性能              | `just perf-ci`（门禁）；夜跑负载/饱和/轨迹报告                          | [scripts/perf](../../scripts/perf/)（含 [baselines.json](../../scripts/perf/baselines.json)）                                                                                      | —（预算随 `just check` 执行）                                                                                       | `just perf-ci`、预算/报告单元测试、[perf-nightly.yml](../../.github/workflows/perf-nightly.yml)                    |
| 部署 / 恢复              | `just production-up` / `production-backup` / `production-restore-drill` | [compose.production.yaml](../../compose.production.yaml)、[deploy/production](../../deploy/production/)、production-*.mjs                                                          | [21](../tutorials/21-single-machine-production.md) · [22](../tutorials/22-backup-restore.md)                        | [production-compose](../../tests/tooling/production-compose.test.mjs)、备份清单/sigv4 工具测试                     |
| 文档 / 可替换业务        | `just check-core`（删例后门禁）；`just docs`                            | [example-remove.mjs](../../scripts/example-remove.mjs)                                                                                                                             | [23](../tutorials/23-example-removal.md)                                                                            | CI 每 PR 完整删例演练、[example-remove 工具测试](../../tests/tooling/example-remove.test.mjs)                      |

<!-- example:knowledge:coverage:start -->

## 知识库示例演示的能力（随示例移除）

本节由知识库示例演示，随《[移除示例](../tutorials/23-example-removal.md)》一起消失；删除示例后，上面的 Core 矩阵仍然成立，替换业务按同样的公开接口接入。

规范 §8.6 的「业务约束、并发」一行完全由示例演示：

| 模板能力       | 运行入口                            | 源码导读                                                                                                                         | 跟做                                                                                | 验证                                                                                  |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 业务约束、并发 | 编辑页保存触发 409；最后 Owner 保护 | [domain.rs](../../crates/app/src/modules/knowledge/domain.rs)、[deletion.rs](../../crates/app/src/modules/knowledge/deletion.rs) | [06](../tutorials/06-edit-conflicts.md) · [12](../tutorials/12-deletion-cleanup.md) | [deletion](../../apps/api/tests/deletion.rs)、[e2e](../../tests/e2e/deletion.spec.ts) |

其余各行的示例演示：

- **资源授权**：Reader/Editor 授予与撤销 → [07](../tutorials/07-library-grants.md)、[grants.rs](../../crates/app/src/modules/knowledge/grants.rs)、[e2e](../../tests/e2e/knowledge-grants.spec.ts)
- **知识文档 CRUD、搜索、预览与分页** → [04](../tutorials/04-personal-documents.md) · [05](../tutorials/05-search-preview.md)、[knowledge](../../apps/api/tests/knowledge.rs)、[e2e](../../tests/e2e/knowledge.spec.ts)
- **附件上传/下载与 Markdown 引用** → [09](../tutorials/09-attachments.md)、[attachments.rs](../../crates/app/src/modules/knowledge/attachments.rs)、[e2e](../../tests/e2e/attachments.spec.ts)
- **导出 ZIP 与任务恢复** → [10](../tutorials/10-document-exports.md) · [11](../tutorials/11-job-recovery.md)、[exports](../../apps/api/tests/exports.rs)、[e2e](../../tests/e2e/exports.spec.ts)、[恢复 e2e](../../tests/e2e/job-recovery.spec.ts)
- **导出通知与已读状态** → [13](../tutorials/13-export-notifications.md)
- **知识操作的审计追溯** → [14](../tutorials/14-audit-history.md)、[audit_knowledge](../../apps/api/tests/audit_knowledge.rs)、[e2e](../../tests/e2e/audit.spec.ts)
- **API Key 读取有权文档** → [15](../tutorials/15-api-keys.md)、[key_documents](../../apps/api/tests/key_documents.rs)
- **版本化正文缓存** → [16](../tutorials/16-versioned-cache.md)、[cached_documents](../../apps/api/tests/cached_documents.rs)
- **观测示例链路** → [19](../tutorials/19-observability.md)
- **确定性预算、负载/饱和/轨迹与桌面渲染长测的教程** → [24](../tutorials/24-perf-gates.md) · [25](../tutorials/25-load-reports.md) · [26](../tutorials/26-desktop-soak.md)、[perf_documents](../../apps/api/tests/perf_documents.rs)、[桌面 soak](../../tests/desktop/soak.spec.ts)
- **Electron 打开知识示例** → [knowledge-shell](../../tests/desktop/knowledge-shell.spec.ts)
- **示例所有权清单** → [examples/knowledge-base/manifest.json](../../examples/knowledge-base/manifest.json)

示例对应的验收补充：渲染进程资源长测由夜跑 [desktop-soak](../../scripts/perf/desktop-soak.mjs) 产出报告（artifact 保留 30 天）；教程 04–19、24–26 随示例逐票交付。

<!-- example:knowledge:coverage:end -->

## 验收汇总

- **默认全栈**：教程从[第一条全栈请求](../tutorials/01-full-stack-request.md)起步逐票交付；日常门禁 `just check`，真实浏览器旅程 `just e2e`，里程碑 `just check-full`。
- **Electron**：[安全壳教程](../tutorials/20-electron-shell.md) + 桌面冒烟（`just desktop-smoke`，CI 每 PR）。
- **Mobile**：未实现，也不在 v1 计划内（实施票 [#22](https://github.com/CaiZongyuan/axum-saas-template/issues/22) 记录为 not planned）。规范 §15.2 与测试策略中的 Mobile 条目保留为设计说明、不据此实施（实施决定以 #22 为准，该差异有意保留）；无对应检查、无文档填空。
- **性能**：确定性预算随 `just check`（`perf-ci`）逐 PR 验收；负载/饱和/轨迹长测报告只由 [perf-nightly](../../.github/workflows/perf-nightly.yml)（夜跑、手动、发布触发）产出，artifact 保留 30 天，从不充当 PR 门禁。
- **备份恢复**：[备份与独立环境恢复演练](../tutorials/22-backup-restore.md)在独立 Restore Environment 上验证文档、附件与任务；归档不含密钥，演练结束清理凭据与证书。
- **删例**：[移除示例](../tutorials/23-example-removal.md)按所有权清单执行，CI 的 example-removal job 每个 PR 完整演练一遍；删后 `just check-core` 全绿。
- **生成引用**：API 合同从 OpenAPI 生成（`contracts:check` 防漂移），配置参考从 Settings 生成并与 `.env.example` 交叉核对；权限与任务目录以教程叙述承载，暂无生成引用——如实记录，不虚报。

## 发布与复现

站点发布在 <https://caizongyuan.github.io/axum-saas-template/>，随 `main` 持续更新；每个页面页脚的“源码版本”就是该页验收时对应的仓库提交，发布任务会校验文档产物与提交一致后才上线，完整复现步骤见[快速开始](../getting-started/quickstart.md)。v1 里程碑验证命令：`just check-full`。
