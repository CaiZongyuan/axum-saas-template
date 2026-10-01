# 版本缓存、重新授权与数据库回源

目标：缓存自己的大文本或只读计算结果，同时让 PostgreSQL 决定当前版本与访问资格。前提是业务已有版本和授权。Redis 可选，不是业务、身份或权限事实源。

<!-- example:knowledge:reference-01:start -->

完整参考：[版本](06-edit-conflicts.md)；[授权](07-library-grants.md)。

<!-- example:knowledge:reference-01:end -->

## 公共文本缓存接口

[Platform Cache](../../crates/platform/src/cache.rs)公开 `Cache::from_env / new / disabled`，以及以下方法摘录：

```rust
pub fn deadline(&self) -> tokio::time::Instant;
pub async fn get(&self, key: &str, deadline: tokio::time::Instant) -> Lookup;
pub async fn put(&self, key: &str, value: &str, deadline: tokio::time::Instant)
    -> Result<(), CacheUnavailable>;
pub async fn remove(&self, key: &str, deadline: tokio::time::Instant)
    -> Result<(), CacheUnavailable>;
```

`Lookup` 为 Hit(String)、Miss、Unavailable、Disabled。应用给 CoreOptions 和业务 Router 同一个 Cache 实例，才能从受保护的 `/api/v1/system/cache` 看到实际累计计数，参考[API 组装](../../apps/api/src/lib.rs)。

## 先授权和取版本，再读缓存

Knowledge 读取每次从数据库检查当前 Membership、资源/库删除状态和 Grant，取当前标题/version/can_edit，之后读取：

<!-- example:knowledge:reference-02:start -->

完整参考：[Knowledge 读取](../../crates/app/src/modules/knowledge/application.rs)。

<!-- example:knowledge:reference-02:end -->

```text
<CACHE_PREFIX>:knowledge:body:v1:<document_id>:<version>
```

缓存只有该版本 Markdown，不含 Session、角色、Grant、标题、能力标志或整份响应。不同已授权用户共享正文，访问资格仍逐请求判断。并发编辑可以在已开始读取之后提交，但正文和响应 version 必须来自同一版本。

miss 后数据库再授权并要求之前确认的 version。若变更则重新读授权/版本并试新 key；最多两轮，持续变化直接完整已授权回源并跳过填充。Redis 超时、断连、错误类型、非 UTF-8、超限或禁用都回源，不污染旧版本 key。

## 提交后的失效

更新正文/version/Audit 先提交，再尝试删除旧版本 key。失败只增加 invalidation_failures，不把已成功保存变业务失败；独立 TTL 默认 60 秒。迟到读取可能填回旧 key，但新请求先读数据库新版本，不会使用旧内容。撤权/删除同样在触缓存前挡住。

自己的模块定义 key、版本、授权查询和匹配版本回源；不要直接调用 Knowledge 的私有读取函数，也不要缓存带成员资格的完整 DTO。

## 预算与故障观察

GET 和填充共享默认 100 ms 总预算，每次短连接只尝试一次，最多 16 并发；满容量立即回源。值最多 1 MiB UTF-8；响应大小在客户端解析后检查，不声称防止恶意 Redis 巨型回复的瞬时分配。取消释放连接所有者，不证明已经被 Redis 接受的写入撤销。

[配置参考](site:reference/config.md)列出 `REDIS_URL / CACHE_PREFIX / CACHE_TTL_SECS / CACHE_BUDGET_MS`，URL 未设置禁用，格式错在监听前失败。URL/原始 Redis 错误不进日志。开发 Redis 为 128 MiB noeviction、无 RDB/AOF；内存压力失败回源。

只在自己的开发环境停止/恢复 Redis：

```bash
docker compose stop redis
docker compose up -d --wait redis
```

停用期间业务读取仍成功且 fallbacks 增加，数据库 ready 不失败。Owner/Admin 可查询累计计数，普通成员拒绝；比较差值，重启计数归零。

## 验证和下一步

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test cache --test config
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test cached_documents
```

<!-- example:knowledge:reference-03:end -->

HTTP 检查覆盖 miss/hit、新版本、撤权/删除、权限不共享和预算回源；[Redis gate](../../tests/support/redis_gate.rs)转发真实 Redis，用受控 barrier 验证 miss 期间修改不污染旧 key、阻塞 GET 仍按时回源。自己的业务应有相同版本/授权/故障断言，接着配置[请求限流](17-rate-limits.md)。

<!-- example:knowledge:reference-04:start -->

完整参考：[HTTP 检查](../../apps/api/tests/cached_documents.rs)。

<!-- example:knowledge:reference-04:end -->
