# 跟做：保存第一篇 Markdown 文档

运行 `just dev`，注册或登录后点击“我的文档”。新账号先看到空状态，点击“新建文档”，输入标题与 Markdown，再点击“保存文档”。刷新详情页，内容仍从 PostgreSQL 读取。

普通 Member 不用等待管理员建库。第一次成功保存会在同一事务准备个人 Knowledge Base、Editor Grant、Document 和对应审计。当前章节展示新建、列表和原文读取；[下一章](05-search-preview.md)加入安全预览和搜索，并发编辑由后续章节交付。

## 1. 把业务放进自己的模块

知识库的[纯内容规则](../../crates/app/src/modules/knowledge/domain.rs)限制标题为 1–200 个字符、Markdown UTF-8 内容为 1 MiB，并拒绝 PostgreSQL 文本不能保存的空字节。规则集中在自己的 Domain 文件，可按自己的产品修改，不需要把知识库概念写进 Core。

[Application 用例](../../crates/app/src/modules/knowledge/application.rs)编排事务和权限；[HTTP 接口](../../crates/app/src/modules/knowledge/mod.rs)处理协议与公开错误。[业务迁移](../../migrations/0003_knowledge.sql)只拥有 `knowledge` schema 的表，Core 的注册不会创建个人库或调用这些用例。

第一次写作以 `personal_owner` 唯一约束协调并发。只有实际创建新库的事务才赋予 Editor；已有库缺少授权时会拒绝写入，重试初始化不会悄悄补回撤销的权限。Owner/Admin 按已确认规则可访问企业所有知识库，其他普通成员必须有该库 Grant。

写入时通过 Organization 的公开接口锁定当前成员身份，并持有库的共享锁检查授权。之后角色停用和库授权变更可以使用对应排他锁，形成明确的提交顺序。

## 2. 一次事务保护一整次保存

创建库、授予默认权限、创建文档及 Audit 共同提交。审计失败会回滚全部变化，不能出现“文档存在，但审计或权限缺失”的半成品。

文档正文保存在 PostgreSQL；当前不向 RustFS 写入 Markdown，RustFS 将负责后续附件和导出二进制。

## 3. 让重试仍是同一次操作

[Core Idempotency](../../crates/app/src/modules/idempotency/mod.rs)提供 `claim` / `complete`，由业务持有事务并在授权后调用。作用域包含账号、操作与目标库，保存规范化请求的 fingerprint 和结果。幂等记录与业务/Audit 同事务提交；并发请求在同一记录上串行协调。

同一个 `Idempotency-Key` 和相同内容返回原结果；同 key 改变内容返回 409。默认重放窗口 24 小时，过期键可重新使用；调用时按有界批次回收过期记录。重放前依然检查会话、当前成员与库权限，不把缓存当授权依据。

新建页面在同一份输入重试时保留 key；输入改变时生成新 key。网络超时后用户可以重试，服务端仍只产生一次文档结果。SDK 不自动重试 POST。

## 4. 从合同接到页面

[API 组装点](../../apps/api/src/lib.rs)合并 Core 与 Knowledge 的 Router/OpenAPI；生成 SDK 根据组合后的合同导出方法。Core 的 Router 构建器不 import 知识库。

```bash
just generate
pnpm contracts:check
```

[Knowledge Views](../../packages/views/src/knowledge/documents-view.tsx)复用 Core 会话、生成 SDK 和通用 UI。列表仅返回摘要，采用默认 50、最多 100 条的 cursor 分页；cursor 绑定当前身份与排序，不能换账号沿用。查询每次仍独立授权，cursor 不是访问凭据。

本章最初通过原文详情接通读取；当前版本已按[下一章](05-search-preview.md)显示安全预览。保存失败会保留输入和请求编号；切换账号后上一身份的保存响应不能更新新身份的界面。

## 5. 验证行为和可移除性

```bash
node scripts/test-backend.mjs --test knowledge
pnpm exec vitest run apps/web/src/knowledge.test.tsx
pnpm boundaries:check
just check
```

后端覆盖创建→读取、隐私隔离、撤权后初始化/重放拒绝、真实锁控制的并发、幂等重试和事务回滚。View 检查空状态、新建导航、失败保留输入与复用请求 key。关键旅程完成时集中运行：

```bash
node scripts/e2e.mjs tests/e2e/knowledge.spec.ts
```

真实浏览器以新 Member 注册，直接保存第一篇正文，再刷新和从列表重新打开。

[所有权清单](../../examples/knowledge-base/manifest.json)登记业务目录、迁移、测试、教程及少量组装点。带 `example:knowledge` 标记的区块是明确的接入位置；后续移除工具将按清单在新副本中操作，不靠文件名猜测，更不自动删除已有生产数据。Core 的身份、审计、幂等和通用 HTTP 能力会保留。
