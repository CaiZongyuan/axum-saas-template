# T16 Redis 缓存：客户端、运行配置与降级边界

查证日期：2026-09-26。范围为 Rust 1.96 / Tokio、单机 PostgreSQL 事实源、已授权 Document 正文缓存；T17 的限流仅保留兼容边界。下文区分固定版本源码结论与实施建议。**本次只查阅源码、发布信息和镜像 manifest；未添加依赖、拉取镜像、编译片段或运行兼容性测试。**

查证时仓库尚未接入 Redis；Document 详情在一次 PostgreSQL 查询中读取授权条件、正文与版本，更新在事务提交后返回。拆分缓存读取时必须保留这些行为，不能把规范里的目标当成已有实现。[现有读取/更新](../../crates/app/src/modules/knowledge/application.rs)、[Compose](../../compose.yaml)、[规范 §13](../saas-template-architecture-spec.md#13-redis配置与依赖失效)

## 1. 可固定的客户端和服务端

| 选择 | 查证结论 |
| --- | --- |
| `redis = { version = "=1.7.1", default-features = false, features = ["tokio-comp"] }` | crates.io 最新稳定版，未撤回，2026-09-25 发布；MSRV 1.88，满足本项目 1.96。官方仓库有对应 release；1.7.1 CI 矩阵包含 Redis **8.10.2**。[registry][registry] [release][client-release] [Cargo][client-cargo] [CI][client-ci] |
| `tokio-comp` | 已包含 `aio`、Tokio net/rt/time；GET、SET、DEL 无需默认的 ACL/streams/geospatial/script/num-bigint 特性。自动重连另加 `connection-manager`；TLS 另选 `tokio-rustls-comp`。`cache-aio` 是客户端本地缓存能力，T16 的 Redis cache-aside 不需要它。[Cargo][client-cargo] [README][client-readme] |
| `redis:8.10.2-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0` | Redis 官方 8.10.2 release 为 2026-09-17；Docker Official Images 的 tag 指向构建提交 `8104e63b5910fda751bf7c038fa297b6fb19ff43`。这里固定的是 registry 返回的 **多架构 OCI index digest**，包含 amd64、arm64 等；不是单个 amd64 manifest 的 digest。[server release][server-release] [镜像清单][official-images] [registry manifest][image-manifest] |

“CI 包含”不是本项目兼容性验证，也不代表支持期限承诺；T16 仍需真实 Redis + PostgreSQL 测试。仓库锁定 Tokio 1.53.1，redis 1.7.1 的普通平台依赖接受 Tokio 1.x。[项目 lock](../../Cargo.lock)、[Cargo][client-cargo]

## 2. 超时、取消与连接复用的实际语义

**固定版本源码结论：**

- `Client::open` 只解析连接信息，不建立网络连接。`get_multiplexed_async_connection_with_config` 才连接；`connection_timeout` 包住连接创建，包括异步连接和连接初始化。1.7.1 默认 connect timeout **1 秒**、response timeout **500 ms**，并非默认无限等待。[client 源码][client-source]
- `AsyncConnectionConfig::set_connection_timeout(Some(duration))` 和 `set_response_timeout(Some(duration))` 显式设置预算；`None` 关闭相应超时。response timeout 包住发送到内部 channel 和等待响应，**不包括之前等待客户端 concurrency semaphore 的时间**。[config][client-source] [发送源码][multiplexed-send]
- `set_pipeline_buffer_size(n)` 控制待发送 channel，默认 50；`set_concurrency_limit(n)` 默认未设限制。官方文档说明 pipeline 可暂时超出并发数；这两个参数都不能替代应用层的立即拒绝/回源策略。[config][client-source]
- `MultiplexedConnection` 可廉价 clone、并发复用同一 socket；无需为普通异步命令引入连接池。但它不负责自动重连。避免把阻塞命令、订阅或无限 pipeline 放在缓存连接上。[README][client-readme]
- 它的 cancellation-safe 保证允许丢弃请求 future，**不保证已发送命令停止执行**。1.7.1 的并发 permit 属于请求 future，超时/取消时就释放；发送后的响应仍由 driver 处理。因此，重复取消后继续用同一连接，不能仅靠 permit 数量证明未答复命令始终有界。[取消合同][multiplexed] [permit 源码][multiplexed-send]
- 经 `Client` 正规构造的连接持有 driver task handle；最后一个连接 clone 被丢弃时会 abort driver。关闭客户端 socket 仍不撤销 Redis 已执行的 SET/DEL。[构造][client-source] [取消合同][multiplexed] [task handle][driver-handle]

`ConnectionManager` 可减少自管重连代码，但代价需要显式接受：触发断线的命令返回错误，后台重连；随后命令先等共享重连 future，**不会自动重发那个失败的普通命令**。重连等待发生在 response timeout 之外。默认有 6 次连接重试，最小延迟 100 ms、指数退避加 jitter；应显式设 `set_number_of_retries`、connect timeout 和最大延迟。其错误分类不会把普通响应超时当成必须换连接，因此不能依赖 manager 自动清理一个持续无响应的连接。[manager 源码][manager] [错误分类][client-errors]

**实施建议：**不论采用哪种连接形式，都用外层 `tokio::time::timeout_at` 覆盖“取得/创建连接 → 发命令 → 读结果”的整个可选缓存操作。Tokio 超时依靠 future 让出执行权；不是对阻塞 CPU/同步工作的硬抢占，也不是服务器端回滚。[Tokio timeout][tokio-timeout]

## 3. T16 的小型有界 adapter

建议先用**每次缓存操作独占的短连接**：通过 `Client` 正规创建普通 `MultiplexedConnection`，操作完成就释放；不启用 manager、连接池或通用命令执行接口。Platform 只提供字节缓存，Knowledge 决定 key、正文格式、版本、授权和计数含义；与本仓库 Core/Reference Application 的边界一致。[ADR 0002](../adr/0002-executable-removable-reference.md)、[Platform](../../crates/platform/src/lib.rs)

```rust
// 建议接口形状，不是现存 API；deadline 由一次 HTTP 请求共享。
async fn get(&self, key: &str, deadline: Instant)
    -> Result<Option<Vec<u8>>, CacheUnavailable>;
async fn put(&self, key: &str, value: &[u8], ttl: Duration, deadline: Instant)
    -> Result<(), CacheUnavailable>;
async fn remove(&self, key: &str, deadline: Instant)
    -> Result<(), CacheUnavailable>;
```

**建议的最小策略，不是上游要求：**

1. 每个进程用固定容量 semaphore，例如 16，`try_acquire_owned` 失败就 `Unavailable::Busy`，直接回源，不等待 permit、不排队。permit 覆盖连接创建至命令结束；每次操作最多一个连接、一个命令，不把连接 clone 暴露出去。
2. 连接由操作 future 局部持有，成功、错误、外层超时或 HTTP future 取消时都释放唯一所有者，利用上游 driver Drop 行为终止本地 driver。这样不会在长期存活连接上积累已放弃命令；已发送的远端写入仍可能发生。[driver 生命周期][driver-handle] 代价是每次多一次握手，本地缓存的收益需要测量；若后续优化为复用，必须同时实现超时后退休旧连接代际的机制。
3. 总缓存 deadline 起始可设 50 ms，connect/response timeout 各 40 ms，buffer/concurrency limit 各 1；GET 和可选填充复用同一 deadline，过期就跳过填充。数值需真实测试调整，不能把独立 connect + command + retry 预算逐项叠加成请求长尾。
4. 每次 GET/SET/DEL 最多尝试一次，不重发结果未知的命令；后续独立请求自然重新连接。若故障期间连接量仍过高，可增加 1 秒冷却期及单个恢复探测，但不需要首版就引入后台重试任务、无限 channel 或逐请求 `spawn`。运行时连接失败不能让 API 无法启动；配置格式错误则在加载 Settings 时报告。
5. SET 值来自 PostgreSQL，使用配置的正整数 TTL，例如 60 秒；限制自有写入大小并校验取回值的 UTF-8/大小/格式。校验发生在 redis-rs 接收值之后，**不声称它限制了解析任意恶意 Redis 响应时的瞬时分配**。连接地址和原始错误不得进入对外响应或日志凭据字段。

若选择共享并发 manager，最少还需应用层 `try_acquire` 准入、外层 deadline、明确的重连预算，以及超时后停止向旧连接代际提交新操作的方案；只加 semaphore + response timeout 不足以覆盖前述取消语义。T17 应复用连接配置原则，另定义限流操作和保守本地降级，不能把缓存的“跳过”直接当成限流放行。[规范 §13](../saas-template-architecture-spec.md#13-redis配置与依赖失效)

## 4. Redis 运行配置和命令合同

以下为**开发环境建议**，未应用到现有 Compose：

```yaml
redis:
  image: redis:8.10.2-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0
  command: ['redis-server', '--save', '', '--appendonly', 'no', '--maxmemory', '128mb', '--maxmemory-policy', 'noeviction']
  ports:
    - '127.0.0.1:${REDIS_PORT:-6379}:6379'
  healthcheck:
    test: ['CMD', 'redis-cli', '-e', 'PING']
    interval: 2s
    timeout: 3s
    retries: 20
```

镜像包含 `redis-server`/`redis-cli`，默认工作目录 `/data`、默认命令 `redis-server`。`save ""` 关闭 RDB 快照，`appendonly no` 关闭 AOF；缓存允许重建，不需要持久卷。官方镜像构建时关闭 protected mode，所以本地发布端口显式绑定 loopback；生产使用内部网络及实际 ACL/凭据配置。[Dockerfile][dockerfile] [redis.conf][redis-conf]

`PING` 正常返回 PONG，不能服务数据（例如 loading）时可返回错误；`redis-cli -e` 让命令错误产生失败退出码，避免只看进程成功退出。健康检查不证明应用 GET/SET 权限或可写容量；若加入 AUTH，检查也必须使用相应身份。[PING][ping] [CLI 源码][redis-cli]

`maxmemory-policy noeviction` 在容量不足时使需要更多内存的写入报错，GET 仍可继续；应用应把这些错误降级处理。纯缓存可以考虑 `allkeys-lru`，但它会淘汰任意 key。考虑 T17 共用 Redis，建议先用 noeviction，避免未到期的限流计数被缓存压力淘汰；独立逻辑 DB 并不能表达独立的全实例淘汰策略。此选择及 128 MiB 数值是实施建议。[redis.conf][redis-conf]

| 命令 | 官方合同及 T16 用法 |
| --- | --- |
| `GET key` | 不存在返回 nil，非 string 返回错误；分别映射真正 miss 与 fallback，不能都计为 miss。读取的是完整 string。[GET][get] |
| `SET key value EX seconds` | 一个命令同时设置值及 TTL，EX 必须为正整数；普通 SET 会覆盖原值并替换原 TTL。不要拆成 SET + EXPIRE；只写版本已匹配的正文，超时后远端结果未知且不重试。[SET][set] [客户端取消合同][multiplexed] |
| `DEL key` | 忽略不存在的 key，返回删除数量；0 也是成功。写事务提交后删除**旧版本 key**，失败不撤销 PostgreSQL 已提交结果。迟到的旧版本填充仍可能重新生成旧 key；TTL 控制残留，下一次授权版本查询才保证不会把它当成最新正文。[DEL][del] [规范 §13](../saas-template-architecture-spec.md#13-redis配置与依赖失效) |

## 5. 版本、授权与真实测试的落点

以下是按既有规范整理的**实施合同**，不是 Redis 自带的一致性保证。[规范 §13](../saas-template-architecture-spec.md#13-redis配置与依赖失效)、[测试策略](../testing/strategy.md)

- key 建议 `deployment-prefix:knowledge:document-body:v1:{document_id}:{version}`；测试使用独立 prefix。缓存仅存正文，不存 Session、Membership、Grant、`can_edit` 或成员相关的完整详情响应。
- 每次 GET 先在 PostgreSQL 验证当前身份、资源可见性/未删除并取得版本与需要的元数据，再查精确 key。命中也不能跳过该步骤；授权失败不触碰缓存正文。
- miss 查询必须同时匹配 document ID 和刚读出的 version，并继续满足授权/未删除条件。若版本变化则重新鉴权取版本；不要把新正文放入旧 key。为避免热文档无限重试，可限制一次重查，然后以一次完整的已授权 PostgreSQL 查询直接响应，并跳过缓存填充。
- update 的 PostgreSQL 事务提交后尝试 DEL 旧版本；失败只是可观察的缓存失败。删除文档/知识库和撤权后，新的 HTTP 请求即使旧 key 仍在，也必须被 PostgreSQL 判定为不可见。并发中的授权快照语义应沿用既有 HTTP 合同，不宣称 TTL 或 DEL 提供跨 PostgreSQL/Redis 事务。
- 在实际决定读取结果的位置统计 `cache_lookup_total{result="hit|miss|fallback"}`：nil 是 miss；超时、断线、busy、坏值是 fallback；有效正文才是 hit。一次查找只记一个结果，SET/DEL 失败单独计数；不以 document/user/key 作为高基数标签。可提供进程内只读计数快照供公开测试接口断言。

T16 验证至少覆盖：真实 Redis 首次 miss 后命中及 TTL；HTTP 更新后读新版本并失效旧 key；有缓存时撤权/删除仍拒绝；受控版本竞态不污染旧 key；Redis 停止、连接拒绝及连接存活但不响应时，HTTP 在有界时间内回源；恢复后可重新命中；对应计数可观察。故障注入可用测试拥有的 TCP 转发暂停连接或专用 Redis 实例暂停，不能暂停共享开发实例。只测拒绝连接无法验证等待响应的超时；按测试策略使用 barrier/受控暂停，不以随机 sleep 制造版本竞争。

[registry]: https://crates.io/api/v1/crates/redis/1.7.1
[client-release]: https://github.com/redis-rs/redis-rs/releases/tag/redis-1.7.1
[client-cargo]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/Cargo.toml
[client-ci]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/.github/workflows/rust.yml
[client-readme]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/README.md
[client-source]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/client.rs
[multiplexed]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/aio/multiplexed_connection.rs#L535-L557
[multiplexed-send]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/aio/multiplexed_connection.rs#L773-L817
[driver-handle]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/aio/runtime.rs#L44-L72
[manager]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/aio/connection_manager.rs
[client-errors]: https://github.com/redis-rs/redis-rs/blob/redis-1.7.1/redis/src/errors/redis_error.rs#L360-L463
[tokio-timeout]: https://github.com/tokio-rs/tokio/blob/tokio-1.53.1/tokio/src/time/timeout.rs
[server-release]: https://github.com/redis/redis/releases/tag/8.10.2
[official-images]: https://github.com/docker-library/official-images/blob/master/library/redis
[image-manifest]: https://registry-1.docker.io/v2/library/redis/manifests/sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0
[dockerfile]: https://github.com/redis/docker-library-redis/blob/8104e63b5910fda751bf7c038fa297b6fb19ff43/alpine/Dockerfile
[redis-conf]: https://github.com/redis/redis/blob/8.10.2/redis.conf
[redis-cli]: https://github.com/redis/redis/blob/8.10.2/src/redis-cli.c#L2372-L2377
[ping]: https://redis.io/docs/latest/commands/ping/
[get]: https://redis.io/docs/latest/commands/get/
[set]: https://redis.io/docs/latest/commands/set/
[del]: https://redis.io/docs/latest/commands/del/
