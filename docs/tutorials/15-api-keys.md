# 跟做：用 API Key 读取有权访问的文档

运行 `just dev` 并登录，从首页进入“API Keys”。填写便于辨认的名称，选择“读取有权访问的文档”和有效期，点击“创建密钥”。保存本次显示的完整 secret；可以复制，保存后点击“我已保存，隐藏密钥”。隐藏、离开页面或重新加载后都无法再次取得完整值，列表只显示名称、前缀、scopes、有效期和撤销状态。

同一个页面也可创建只允许“读取自己的基本资料”的 Core Key。scope 是凭据的权限上限：有文档 scope 仍必须拥有对应知识库的当前权限，有资料 scope 不代表能读文档。Key 不提供成员管理、写文档或创建其他 Key 的能力。

## 1. 通过真实 HTTP 调用

打开一篇你有权读取的文档，复制地址中的文档 ID。在 Bash 中按提示读取 secret，避免把实际值写进命令历史；下面的 curl 从标准输入取得请求配置：

```bash
read -rsp 'API Key: ' SAAS_API_KEY
read -rp 'Document ID: ' SAAS_DOCUMENT_ID
curl --fail-with-body --config - <<CURL
url = "http://127.0.0.1:3000/api/v1/knowledge/documents/${SAAS_DOCUMENT_ID}"
header = "Authorization: Bearer ${SAAS_API_KEY}"
CURL
unset SAAS_API_KEY
```

响应包含 Markdown，但 `can_edit` 为 false。使用相同 Key 调用 `GET /api/v1/knowledge/documents` 可以读取自己的文档摘要；传 `knowledge_base_id` 可查询有权访问的库，`can_create` 为 false。两条接口均支持已有的搜索/分页合同。

只有 `profile:read` 的 Key 可调用 `GET /api/v1/profile` 读取自己的基本资料。机器请求不依赖 Cookie 或 CSRF；Key 的创建、列表和撤销仍需要登录会话，修改操作还需受信 Origin 与 CSRF。

撤销 Key 后，再次输入之前保存的值执行文档请求会得到 401。管理员撤销库 Grant 后，Key 读取该库资源会得到 404；缺少对应 scope 返回 403。Key 到期或创建者停用同样返回 401。已经在撤销前通过鉴权的在途请求不能被回收，后续请求必须重新检查凭据。

## 2. 只保存 hash，创建响应不重放

[Core API Keys](../../crates/app/src/modules/api_keys/management.rs)用操作系统随机源生成 256 位不可预测 secret，再保存 SHA-256 hash。名称、前缀、创建者、scopes、有效期、撤销时间与最近使用时间存入 [api_keys 表](../../migrations/0015_api_keys.sql)。前缀只用于辨认，不能用来认证。

创建接口只接受名称、受支持的 scopes 和 1–365 天有效期，创建者来自当前 Session，不能由请求指定。它先锁定当前有效成员身份并重新检查会话，在一个事务中写入 Key 与 Audit；审计失败则 Key 不会独立存在。

这个 POST 不使用通用幂等重放表，SDK 和页面不自动重试。重复提交是新的创建操作，会得到独立 Key 和 secret。如果响应丢失，请刷新列表，依据名称和时间撤销那条记录，再明确创建一个新的 Key。服务端不能恢复已丢失的 secret。

前端 [ApiKeysView](../../packages/views/src/api-keys/api-keys-view.tsx)把创建响应中的 secret 仅保存在当前页面状态，不放入 TanStack Query/Mutation 缓存、localStorage 或持久状态；离开时取消仍在等待的创建响应。复制通过应用壳提供的剪贴板回调完成。撤销正在显示的新 Key 后，同样清除其 secret。

## 3. 权限是两个条件的交集

[凭据认证](../../crates/app/src/modules/api_keys/authentication.rs)每次检查 hash、到期、撤销、创建者是否仍为有效成员，以及请求所需的 scope。成员锁先于凭据锁，创建、撤销和认证遵守相同顺序。通过认证后，业务模块继续执行自己的库权限和删除状态检查。

请求显式携带 Authorization 时不会失败后回退到浏览器 Cookie；Session 专用的管理接口拒绝 Bearer，避免混合凭据扩大机器权限。只读 Key 也不能通过响应里的 UI 能力标志获得写入能力。

[知识库读取入口](../../crates/app/src/modules/knowledge/mod.rs)只为文档详情与文档列表启用 `knowledge:read`。附件下载、导出、写入和权限管理沿用原有 Session 流程，不把“支持 API Key”解释为默认放开所有路由。

## 4. scopes 由实际模块注册

Core 注册 `profile:read`，知识库通过 [API 组装入口](../../apps/api/src/lib.rs)追加 `knowledge:read`。`GET /api/v1/api-keys/scopes` 返回当前应用真正支持的选项，创建接口拒绝其他值。Core 不含知识库的 scope 名称或业务模型。

移除知识库时，其读取路由和 scope 注册一起移除；Core Key 列表、创建、撤销和个人资料读取仍然可用。旧 Key 的历史 metadata 可以保留，但已移除的业务路由不再提供能力。

实现自己的业务时，在组装点注册明确的 scope，在对应读取处理器调用 `api_keys::require_read`，再验证该用户对业务资源的当前权限。不要只根据 Key 的 scope 跳过业务授权；要支持新的写操作时另行设计该操作的凭据权限与审计规则。

## 5. 验证

```bash
node scripts/test-backend.mjs --test api_keys --test key_documents --test sessions
pnpm exec vitest run apps/web/src/api-keys.test.tsx
just check
```

Core HTTP 测试覆盖单次展示、私有列表、scope/有效期输入、CSRF、审计回滚、到期、用户停用、撤销以及混合 Cookie/Bearer 拒绝。Reference HTTP 测试验证 scope 与库授权交集、Reader/Editor 也不能通过只读 Key 写入、撤权后拒绝。

`key_documents` 还启动真实 TCP HTTP 服务，通过实际 reqwest 客户端注册、创建文档和 Key、带 Bearer 读取，再撤销并取得 401。它不用浏览器拦截或假的认证服务；本章不另外重复整套浏览器 E2E。

View 测试验证创建/复制/隐藏、刷新后只有 metadata、失败撤销重试，以及创建失败不自动发出第二次 POST。生成合同、[所有权清单](../../examples/knowledge-base/manifest.json)和在线文档随本章一起更新。
