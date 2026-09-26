# 跟做：先检查权限和版本，再读取 Redis 正文缓存

运行 `just dev`。开发入口现在启动 PostgreSQL、RustFS 和 Redis；`.env.example` 包含 `REDIS_URL`，无需另外启动缓存进程。以 Owner/Admin 登录，准备一篇文档并打开详情。

在浏览器开发者工具控制台执行：

```js
await fetch('/api/v1/system/cache').then((response) => response.json());
```

这里使用同源 Session，返回进程内的缓存计数，不含连接地址、文档 ID 或凭据。第一次读取正文使 `misses` 和 `writes` 增加，刷新文档使 `hits` 增加。计数是整个 API 进程的累计值，重启会归零；比较操作前后的差值，不假设共享开发进程从零开始。

编辑、保存后重新打开文档，看到新正文和新版本。停止缓存以观察降级：

```bash
docker compose stop redis
```

再次刷新文档，内容仍从 PostgreSQL 返回，`fallbacks` 增加。恢复后新的请求重新尝试缓存：

```bash
docker compose up -d --wait redis
```

Redis 故障不会让数据库 readiness 失败，也不会使认证、库权限或删除检查失效。普通成员无权读取全局计数，但照常读取自己的文档。

## 1. 缓存只保存正文，不保存访问结论

[文档读取](../../crates/app/src/modules/knowledge/application.rs)每次先在 PostgreSQL 重新检查当前有效成员身份、文档/知识库是否删除及库授权，同时取得当前标题、版本和编辑能力。这一步不读取正文。

然后访问 `deployment-prefix:knowledge:body:v1:<document_id>:<version>`。缓存只保存该版本的 Markdown 文本，不包含 Session、Membership、Grant、`can_edit`、标题或整个成员响应。已授权的成员可以共享相同正文；每个人的访问资格和编辑能力都由本次数据库查询决定。无权访问的请求在触碰正文缓存前就被拒绝。

命中时用数据库取得的元数据和匹配版本的缓存正文组成响应。并发写入可以发生在一个已开始读取的请求之后；返回的正文必须与这次读取确认的版本一致，不能混成“新版本号、旧正文”。

## 2. miss 必须匹配之前检查的版本

如果 key 不存在，第二次 PostgreSQL 查询再次验证权限、未删除状态，并要求版本仍与第一次相同。匹配成功才把正文写入这个 key。

如果两次查询之间文档发生变化，代码重新读取授权和版本，再尝试新的 key；最多重复两轮，持续变化时直接做完整的已授权数据库读取并跳过填充。不会把版本 2 的正文填入版本 1 的 key，也不会因为热点文档持续编辑而无限重试。

Redis 超时、断连、错误类型、非 UTF-8 或超出大小限制都走数据库回源。禁用缓存时同样走完整读取，返回的 HTTP/前端合同保持一致。

## 3. 写后失效与迟到写入

[更新处理器](../../crates/app/src/modules/knowledge/mod.rs)先完成文档和 Audit 事务，再尝试删除旧版本 key。失效失败只计入 `invalidation_failures`，不会把已提交保存变成业务失败。所有缓存值还带有默认 60 秒 TTL。

旧读取可能在失效之后才把旧正文填回 Redis。版本化 key 使它只回到旧版本的位置，后续读取先确认新版本，因此不会当作最新内容使用。删除文档、删除知识库或撤销权限也会被每次读取的数据库检查挡住，旧 key 的存在不构成访问能力。

## 4. Redis 操作的资源预算

[Platform Cache](../../crates/platform/src/cache.rs)提供可选文本缓存。每个操作使用独立短连接，不自动重发命令、不维护无限等待队列。每个 API 进程最多同时运行 16 个缓存操作，容量已满时立即回源。

一次文档读取的 GET 和可选填充共享默认 100 ms 总缓存时限；该时限包含连接、发送、等待响应及填充前已用掉的时间。连接、命令也有显式超时。操作结束、取消或超时时，唯一连接所有者被释放，客户端 driver 随之终止；这不代表 Redis 已收到的写入被撤销。

GET/SET 只接受最多 1 MiB 的 UTF-8 文本，和当前 Markdown 上限一致。响应大小检查发生在客户端解析之后，不声称可以限制恶意 Redis 服务发送巨大回复时的瞬时分配。原始 Redis 错误和含凭据连接 URL 不进入日志或 API 错误。

开发 Redis 不保留 RDB/AOF 数据，使用 128 MiB `noeviction` 上限。容量不足导致 SET 失败时回源，不把 Redis 作为事实源；选择 noeviction 也为后续限流计数避免被普通缓存压力提前淘汰。固定版本及取消语义的来源见[实施前研究](../research/redis-cache-runtime.md)。

可配置项见[生成配置参考](site:reference/config.md)：

- `REDIS_URL`：当前支持 `redis://`；不设置则禁用缓存。单机开发仅发布 loopback 端口。
- `CACHE_PREFIX`：隔离部署的 namespace；测试每次生成独立 prefix。
- `CACHE_TTL_SECS`：1–3600 秒，默认 60。
- `CACHE_BUDGET_MS`：1–1000 ms，默认 100。

配置格式错误在监听前失败；服务运行时 Redis 不可达则回源。Core 运行计数提供 hit、miss、fallback、成功写入/失效及对应失败数，不按用户、文档或 key 建立高基数标签。

## 5. 实际验证

```bash
node scripts/test-backend.mjs --test cache --test cached_documents --test config
pnpm exec vitest run apps/web/src/knowledge.test.tsx apps/web/src/api-keys.test.tsx
just check
```

测试脚本启动独立 PostgreSQL、RustFS、Redis，缓存 prefix 按测试隔离，结束后删除自己的测试容器。HTTP 测试证明首次 miss、再次 hit、保存后新版本、共享正文但不共享编辑权限、撤权/删除拒绝以及真实计数变化。

[Redis 转发夹具](../../apps/api/tests/support/redis_gate.rs)把命令发给真正的 Redis，只在一次 GET 上设置受控 barrier：一个测试在 header 查询与 miss 回源之间编辑文档，确认重新授权取新版本且不污染旧 key；另一个保持连接但不回答 GET，确认在预算内回源、后续独立连接可恢复。断开转发服务也会回源。测试没有用随机 sleep 制造竞态。

前端沿用同一个文档 View 与 SDK，无需学习另一套“缓存页面”；本票没有额外重复浏览器套件。

## 6. 用在自己的业务

复用 Platform Cache 与 Core 的受保护计量入口。自己的模块必须定义：哪些数据适合缓存、什么业务版本参与 key、如何在 PostgreSQL 检查当前可见性，以及如何做匹配版本的回源。不要把带成员能力标志的整个响应放进共享缓存。

在应用入口给 Core 与业务 Router 传入同一个 Cache 实例，才能观察实际访问计数。事务提交后尝试失效旧版本，保留独立 TTL；任何 Redis 失败都使用已授权的数据库路径。知识库特有的 key、读取规则、测试和本章在[示例清单](../../examples/knowledge-base/manifest.json)中，通用 Cache 和 Redis 运行配置属于模板。
