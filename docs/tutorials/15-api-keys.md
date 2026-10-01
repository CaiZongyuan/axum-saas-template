# 为自己的读取 API 注册 Key Scope

目标：给机器客户端开放有明确权限上限的读取入口。前提是业务已有资源授权和组合 Router/OpenAPI。现有 API Key 仅支持明确启用的只读操作，不支持业务写入或后台 Session 凭据。

<!-- example:knowledge:reference-01:start -->

完整参考：[资源授权](07-library-grants.md)。

<!-- example:knowledge:reference-01:end -->

## 在应用组装点注册能力

[API Keys](../../crates/app/src/modules/api_keys/mod.rs)公开 `KeyScope { id, label }`、`core_scopes()` 与 `require_read`。Core 注册 `profile:read`，参考业务在[API 组装点](../../apps/api/src/lib.rs)追加 `knowledge:read`。自己的 scope 同样通过 `CoreOptions.api_key_scopes` 传入；接入片段为：

```rust
let mut scopes = saas_app::modules::api_keys::core_scopes();
scopes.push(saas_app::modules::api_keys::KeyScope {
    id: "tickets:read".into(),
    label: "Read accessible tickets".into(),
});
```

这只是新业务的组装片段，不会自动创建 ticket 路由。`GET /api/v1/api-keys/scopes` 返回应用实际支持的集合；Key 创建拒绝未知 scope。

## 在读取 Handler 验证

[公共认证接口](../../crates/app/src/modules/api_keys/authentication.rs)摘录：

```rust
pub async fn require_read(
    pool: &PgPool,
    auth: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
    scope: &str,
) -> Result<ReadActor, Response>;
```

传自己的 `tickets:read`，随后按返回 User ID 验证业务资源当前权限和删除状态。scope 与资源资格取交集，不把 scope 当全局可见权。完整 Handler 参考Knowledge 读取，只有列表/详情启用 Key；附件、导出、写入仍用 Session。

<!-- example:knowledge:reference-02:start -->

完整参考：[Knowledge 读取](../../crates/app/src/modules/knowledge/mod.rs)。

<!-- example:knowledge:reference-02:end -->

显式 Authorization 无效时不回退 Cookie。Session 专用管理入口拒绝 Bearer；认证每次检查 hash、到期、撤销、当前有效成员与 scope，成员锁先于凭据锁。缺 scope 403，无效/到期/撤销/停用 401，无权资源按业务策略隐藏为 404。

## 真实请求与秘密处理

先通过 Session 管理 API 创建 Key，再在 Bash 输入一次展示的 secret；以下从标准输入传 curl 配置，避免 secret 进入历史或进程参数：

```bash
read -rsp 'API Key: ' SAAS_API_KEY
curl --fail-with-body --config - <<CURL
url = "http://127.0.0.1:18000/api/v1/profile"
header = "Authorization: Bearer ${SAAS_API_KEY}"
CURL
unset SAAS_API_KEY
```

该请求要求 `profile:read`，返回自己的基本资料。撤销后同请求 401。自己的业务 URL/响应应来自已生成合同，不把 Key 的只读 `can_edit=false` 当成服务端写保护。

Key 为 256-bit 随机值，数据库只存 SHA-256；创建响应只展示一次。创建不使用可重放幂等表、不自动重试；响应丢失时按 metadata 找到并撤销，再明确创建新的。名称、前缀、scope 和时间可存储，secret 不进日志、Query 缓存或持久状态。有效期 1–365 天；已通过鉴权的在途请求无法撤回。

## 验证与扩展

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test api_keys --test sessions
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test key_documents
```

<!-- example:knowledge:reference-03:end -->

[Core 测试](../../crates/app/tests/api_keys.rs)覆盖单次秘密、私有管理、CSRF、回滚、撤销和混合凭据；真实 TCP 客户端创建 Key、Bearer 读取、撤销后 401，并验证资源权限交集。自己的读取 API 增加有权成功、缺 scope、撤权和写入拒绝。移除业务时同时移除 scope 注册；继续[版本缓存](16-versioned-cache.md)。

<!-- example:knowledge:reference-04:start -->

完整参考：[真实 TCP 客户端](../../apps/api/tests/key_documents.rs)。

<!-- example:knowledge:reference-04:end -->
