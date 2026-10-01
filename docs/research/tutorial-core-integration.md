# 工单后端教程：Core 接入查证

查证日期：2026-10-01。源码基准：`0b53e60ef0f0991768399aec41a29b2bdd00ddaa`；调查同时读取当前工作区。目的：为 DOC02 连续工单教程选取真实公共接口，不改变 Core 或默认应用。以下签名来自源码；本记录没有新增可运行代码、执行编译或重跑集成测试。列出的测试是现有行为证据，不能作为本轮测试通过的记录。

领域约束沿用 [CONTEXT](../../CONTEXT.md) 和 [ADR 0001](../adr/0001-single-organization-deployment.md)：一次部署服务一个 Organization。教程新增业务不增加租户层；[ADR 0002](../adr/0002-executable-removable-reference.md)、[ADR 0003](../adr/0003-static-example-composition.md) 要求业务持有自身规则、数据与组装贡献，Core 不依赖业务。[已接受方案](../plans/documentation-rebuild.md)中的工单属于读者新增的教学业务。

## 1. Files 公共接口

入口：`saas_app::modules::files`。[实现与类型](../../crates/app/src/modules/files/mod.rs)，[清理接口](../../crates/app/src/modules/files/cleanup.rs)。下列签名省略共同的 `pub` / `async` 标记，仅构造器与 `validate` 为同步方法。

| 接口 | 实际签名与职责 |
| --- | --- |
| 构造 | `FileService::from_settings(storage: &StorageSettings, limits: &FileLimits) -> Self`；`FileService::new(storage: Arc<dyn ObjectStorage>, bucket: String, policy: FilePolicy) -> Self` |
| 输入 | `validate(&self, input: &mut UploadInput) -> Result<(), Error>` |
| 注册 | `start(&self, connection: &mut PgConnection, actor_id: &str, input: &UploadInput) -> Result<Upload, Error>` |
| 重放加载 | `load(&self, connection: &mut PgConnection, id: &str) -> Result<Upload, Error>` |
| 签上传 | `upload_capability(&self, upload: &Upload) -> Result<UploadCapability, Error>` |
| 规划完成 | `plan_completion(&self, connection: &mut PgConnection, id: &str) -> Result<CompletionPlan, Error>` |
| 存储核验 | `verify_candidate(&self, attempt: &CompletionAttempt) -> Result<VerifiedCandidate, Error>` |
| 放弃候选 | `abandon(&self, connection: &mut PgConnection, attempt: &CompletionAttempt, rejected: bool) -> Result<(), Error>` |
| 发布 | `publish(&self, connection: &mut PgConnection, verified: &VerifiedCandidate) -> Result<Publication, Error>` |
| 签下载 | `download(&self, connection: &mut PgConnection, id: &str, inline: bool) -> Result<DownloadCapability, Error>` |
| 批量信息 | `ready_info(connection: &mut PgConnection, ids: &[String]) -> Result<Vec<FileInfo>, Error>` |
| 删除 | `mark_deleting(connection: &mut PgConnection, id: &str, correlation_id: &str) -> Result<(), Error>` |

`UploadInput` 的字段是 `file_name: String`、`content_type: String`、`size: i64`、`sha256: String`，拒绝未知 JSON 字段。`validate` 规范化 MIME essence 与小写 SHA-256，要求 32 字节十六进制摘要，拒绝负数、路径分隔符、控制字符和超过 255 字符的文件名。`start` 再次校验输入。默认限制是 20 MiB、上传 900 秒、下载 60 秒；[环境配置](../../crates/platform/src/config.rs)把最大文件限制为 1..104857600 字节、上传期限 1..3600 秒、下载期限 1..300 秒。

`Upload` 只有 `id` 字段公开；状态、bucket/key、摘要与期限私有。`CompletionAttempt`、`VerifiedCandidate` 的字段全部私有，必须由上述方法取得，不能通过手工构造跳过验证。`CompletionPlan` 是 `Ready(FileInfo)`、`Attempt(CompletionAttempt)`、`Expired`、`Rejected`；`Publication` 是 `Adopted(FileInfo)`、`Existing(FileInfo)`、`Expired`。[源码](../../crates/app/src/modules/files/mod.rs#L56)

`ObjectCapability` 公开 `url`、`method`、`headers`、`expires_at`；`UploadCapability` 是 `upload_id`、`state`、`upload: Option<ObjectCapability>`，ready 重放没有新上传链接。`DownloadCapability` 把 `request: ObjectCapability` flatten 到响应顶层，另含 `file: FileInfo`。请求者必须使用返回的 method 与 headers，不能自行改写签名参数。[类型与签名](../../crates/app/src/modules/files/mod.rs#L72)

### 最小完整附件流程

Files 不知道工单权限或所属资源，不会替业务验证操作者、工单/file 关联。业务持有自己的关联表，沿用现有 [Knowledge 附件](../../crates/app/src/modules/knowledge/attachments.rs)展示的提交边界：

1. Handler 调用 `identity::require_session(..., true)`，解析业务 id，校验 `UploadInput`，读取 `Idempotency-Key`。
2. 短事务 A：锁定有效 Membership，再锁定并授权工单；调用 `idempotency::claim`。新请求调用 `files.start`，插入工单与 upload.id 的关联，`idempotency::complete` 只保存 upload_id。重放重新检查关联后 `files.load`。提交后调用 `upload_capability`，避免把短期签名 URL 存进幂等响应。
3. 客户端 PUT 对象到 staging。此时业务附件列表仍不可见，不能把上传成功当成附件发布。
4. 短事务 B：再次授权工单并检查 upload 关联，调用 `plan_completion`，提交候选记录。`Ready` 重放还须确认业务已发布关联；`Expired` / `Rejected` 返回对应失败。
5. 事务外 `verify_candidate`：HEAD staging、按源 ETag 条件 COPY 到唯一候选对象、HEAD + 有界 READ 最终候选、比对尺寸/MIME/upload-id/SHA-256，并做特定媒体的魔数检查。失败通过新短事务 `abandon`；`Rejected` / `TooLarge` 使用 `rejected = true`，临时故障使用 `false`。
6. 复制可能耗时，重新调用 `require_session(..., true)`。短事务 C 再锁 Membership、授权工单并检查关联，然后 `files.publish`。`Adopted` 才新增已发布附件关系并 `audit::append`；`Existing` 只核对既有关系，不重复审计；`Expired` 提交状态转换后返回失败。最后提交，业务关系、Core ready 状态与审计一起生效。
7. 下载时先在事务中授权工单并查已发布关联，再调用 `files.download`；列表只取业务关联中的 id 调用 `ready_info`。删除时同一事务删除业务可见关系、调用 `files::mark_deleting`、写审计；提交即停止新授权下载，Worker 随后删除对象。

`verify_candidate` 每个 FileService 共享实例最多同时核验 4 个文件，忙时返回 `Unavailable`，整体 30 秒预算，实际文件内容会读入内存；这不是任意大文件的流式上传检验。[核验实现](../../crates/app/src/modules/files/mod.rs#L398) MIME 魔数仅检查 PNG/JPEG/GIF/WebP/PDF；其他类型校验大小与摘要，不能描述为病毒扫描或完整文件格式校验。[内容检查](../../crates/app/src/modules/files/mod.rs#L569)

下载 `inline = true` 仅接受 PNG/JPEG/GIF/WebP；返回签名 GET，以 no-store 与下载文件名构造响应。签名 URL 是在期限内可独立访问的能力，撤权只能阻止签发新链接，不能立即撤销已经签发的 URL。[下载实现](../../crates/app/src/modules/files/mod.rs#L520)，[公开行为测试](../../apps/api/tests/attachments.rs#L464)

删除需要注册 `files::cleanup_handler(pool, files)`、`files::rescan_handler(pool, files)` 与 `files::cleanup_maintenance(pool)`，它们分别返回 `Arc<dyn jobs::Handler>`、`Arc<dyn jobs::Handler>`、`Arc<dyn jobs::Maintenance>`。Core 保存待清理位置并重新探测迟到对象，保留失败预算；不应业务代码直接同步调用 S3 delete。[清理实现](../../crates/app/src/modules/files/cleanup.rs)，[默认 Worker 组装](../../apps/worker/src/main.rs#L28)

## 2. ObjectStorage 适配器的能力和限制

入口：`saas_platform::object_storage`。[trait 与 S3 实现](../../crates/platform/src/object_storage.rs)。使用 `#[async_trait]`，`ObjectStorage: Send + Sync`，所有方法返回 `Result<_, StorageError>`：

```rust
async fn presign_upload(&self, location: &ObjectLocation,
    headers: &UploadHeaders, deadline: SystemTime) -> Result<SignedRequest, StorageError>;
async fn delete(&self, location: &ObjectLocation) -> Result<(), StorageError>;
async fn head(&self, location: &ObjectLocation) -> Result<ObjectInfo, StorageError>;
async fn copy_if_absent(&self, source: &ObjectLocation, source_etag: &str,
    target: &ObjectLocation) -> Result<(), StorageError>;
async fn read(&self, location: &ObjectLocation, limit: u64) -> Result<Vec<u8>, StorageError>;
async fn download_to(&self, location: &ObjectLocation, path: &Path,
    limit: u64) -> Result<FileDigest, StorageError>;
async fn put_file_if_absent(&self, location: &ObjectLocation, path: &Path,
    headers: &UploadHeaders) -> Result<(), StorageError>;
async fn presign_download(&self, location: &ObjectLocation, disposition: &str,
    content_type: &str, ttl: Duration) -> Result<SignedRequest, StorageError>;
```

`ObjectLocation { bucket, key }`、`UploadHeaders { content_type, upload_id, checksum_sha256 }` 字段均为 String；checksum 使用 base64 编码的 SHA-256 原始字节。`SignedRequest` 提供 url/method/headers/SystemTime expires_at；`ObjectInfo` 提供 size/content_type/etag/metadata；`FileDigest` 提供 size 与十六进制 sha256。[类型源码](../../crates/platform/src/object_storage.rs#L22)

S3 adapter 分 internal 和 public endpoint，强制 path-style；普通操作仅一次 SDK attempt，连接 3 秒、操作 20 秒预算。条件复制用源 `CopySourceIfMatch` 和目标 `IfNoneMatch("*")`，生成写入也以目标不存在为条件。该能力依赖存储实现真正支持条件复制/写入，仓库通过真实 RustFS 测试检查，不应泛称所有 S3 兼容服务都符合。[实现](../../crates/platform/src/object_storage.rs#L124)，[真实协议测试](../../crates/platform/tests/object_storage.rs#L46)

`read` 会申请与实际内容相应的 Vec，HEAD Content-Length 与每个消费 chunk 双重限额；`download_to` 流式落盘并增量摘要，有 120 秒预算。`put_file_if_absent` 从本地文件读取，64 KiB SDK buffer，调用者必须先生成不可变产物并控制大小；这两个方法不自动管理业务临时目录。`delete` 对 NotFound 幂等；错误类型是 Expired/Unavailable/NotFound/PreconditionFailed/TooLarge/InvalidResponse。[实现](../../crates/platform/src/object_storage.rs#L328)

普通业务应使用 FileService，不接受外部提供的 bucket/key/URL，不使用私有 `FileService.storage`。适配器没有 multipart、对象枚举、恶意内容扫描、通用 put-bytes 或附件授权接口。

## 3. 自有 Job Handler 与原子结果

入口：`saas_app::modules::jobs`。[公共 Job / Lease 接口](../../crates/app/src/modules/jobs/mod.rs)，[Handler / Worker](../../crates/app/src/modules/jobs/worker.rs#L80)。

```rust
pub struct NewJob<'a> {
    pub kind: &'a str,
    pub schema_version: i32,
    pub max_attempts: i32,
    pub payload: serde_json::Value,
    pub correlation_id: &'a str,
}
pub async fn enqueue(connection: &mut PgConnection, job: NewJob<'_>)
    -> Result<String, sqlx::Error>;

#[async_trait::async_trait]
pub trait Handler: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn run(&self, lease: &Lease) -> Result<(), JobError>;
}
```

`enqueue` 在调用者事务内写 jobs 与初始 batch，Worker 只看到提交的数据，返回 String job id。payload 可仅放业务 export_id；业务快照存自有表。Core 自动记录当前 request/actor/trace/causation 上下文。[实现](../../crates/app/src/modules/jobs/mod.rs#L22)

`Lease` 公开 id/kind/schema_version/payload/lease_token/correlation_id、可选 causation_id/request_id/actor_id/traceparent、batch/attempt。真实提交接口：

| 接口 | 签名 |
| --- | --- |
| 当前租约锁 | `lock_current(&self, connection: &mut PgConnection) -> Result<(), JobError>` |
| 成功 | `succeed(&self, connection: &mut PgConnection) -> Result<(), JobError>` |
| 心跳 | `heartbeat(&self, pool: &PgPool, lease_secs: u32) -> Result<(), JobError>` |
| 失败 | `fail(&self, pool: &PgPool, error: &JobError) -> Result<(), sqlx::Error>` |
| 批量状态 | `statuses(connection: &mut PgConnection, ids: &[String]) -> Result<Vec<JobStatus>, sqlx::Error>` |
| 受控领取 | `claim(pool: &PgPool, kinds: &[&str], worker: &str, lease_secs: u32) -> Result<Option<Lease>, sqlx::Error>` |

Handler 必须校验 kind/schema_version/payload，读取业务快照，核对当前成员、业务权限与凭据。在事务外做受预算限制的生成/存储操作，发布事务持有 `lock_current` 后再修改业务结果、append 审计、`succeed`、commit。成功不仅更新 Job，还同时更新 attempt/batch 并发布通知。`Ok(())` 不会让 Worker 自动 succeed；因此不能只实现“生成成功就返回 Ok”。[Lease 实现](../../crates/app/src/modules/jobs/mod.rs#L105)，[Worker 调度](../../crates/app/src/modules/jobs/worker.rs#L119)

返回 `JobError::Transient(&'static str)` 会在预算内随机退避重试；`Permanent(&'static str)` 进入失败终态；`LostLease` 不允许旧执行者写终态。Worker 调用 fail 并负责心跳，run_once 的 `Ok(true)` 仅表示执行过一个 Job，不能当成业务成功断言。[失败转移](../../crates/app/src/modules/jobs/mod.rs#L147)

`Worker::new(pool: PgPool, handlers: Vec<Arc<dyn Handler>>, policy: WorkerPolicy) -> Self` 显式注册；Worker 只 claim 已注册 kind。`run_once(&self) -> Result<bool, sqlx::Error>` 适合受控测试，`run_until(&self, shutdown: impl Future<Output = ()>)` 用于进程。默认 policy 为 lease 60 秒、heartbeat 20 秒、shutdown 10 秒、maintenance 30 秒；注册重复 kind 没有公共验证器，教程要保持唯一。[源码](../../crates/app/src/modules/jobs/worker.rs#L7)

生产进程的真实组装点是 [apps/worker/src/main.rs](../../apps/worker/src/main.rs#L32)。教学 fixture 可构造自己的 Worker，无需向这里添加 tickets。维护任务的接口是 `Maintenance::name() -> &'static str`、`schedule(&self) -> Result<(), JobError>`；`run_maintenance(tasks: Vec<Arc<dyn Maintenance>>, period: Duration, shutdown: impl Future<Output = ()>)` 独立运行，不能把它藏进会阻塞正在续约的 Handler。[维护调度](../../crates/app/src/modules/jobs/maintenance.rs)

### 生成文件仍用 Files

[公共生成接口](../../crates/app/src/modules/files/mod.rs#L582)：

```rust
pub async fn snapshots(connection: &mut PgConnection, ids: &[String])
    -> Result<Vec<FileSnapshot>, Error>;
// 以下均为 FileService 方法。
pub async fn prepare_generated(&self, connection: &mut PgConnection,
    actor_id: &str, input: &UploadInput, max_bytes: i64, retention_secs: u32)
    -> Result<CompletionAttempt, Error>;
pub async fn download_snapshot(&self, snapshot: &FileSnapshot, path: &Path)
    -> Result<(), Error>;
pub async fn write_generated(&self, attempt: &CompletionAttempt, path: &Path)
    -> Result<VerifiedCandidate, Error>;
```

`snapshots` 只接受已授权业务提供的 ready file ids，返回 immutable object identity 并 FOR SHARE；不会判断工单权限，也不会允许缺少其中一个文件。`FileSnapshot` 字段公开，内容必须来自该函数或可信业务快照；不要从 HTTP 接受任意 snapshot。`download_snapshot` 比对实际流式下载的长度与摘要。`prepare_generated` 单独接受业务产物大小/期限预算，避免套用上传大小限制；事务提交候选后才 `write_generated`，再重新授权并 fenced publish。[Knowledge 导出实现](../../crates/app/src/modules/knowledge/exports/worker.rs#L174)

`write_generated` 信任服务端已完成且不可变的文件及其声明 SHA-256，以存储 checksum 写入并 HEAD 校验尺寸/MIME/upload-id，不重复使用 `verify_candidate` 的完整 READ/魔数路径。调用者需要计算真实摘要、控制文件大小，并持有临时目录直至写入结束。[实现](../../crates/app/src/modules/files/mod.rs#L652)

ready 文件的 `expires_at` 不是通用业务产物删除期限：Core maintenance 对 ready 过期主要回收 staging/非采用候选，不删除当前 ready 对象。自有导出要在业务 expires_at 到期后拒绝下载，并用自有 Maintenance 调用 `mark_deleting`、清空 snapshot/file 引用；不能只传 retention_secs 就宣称业务过期产物已回收。[Core 清理条件](../../crates/app/src/modules/files/cleanup.rs#L15)，[Knowledge 过期维护](../../crates/app/src/modules/knowledge/exports/maintenance.rs)

## 4. 通知是请求事务中的意图

入口：`saas_app::modules::notifications`。[源码](../../crates/app/src/modules/notifications/mod.rs)。

```rust
pub async fn on_job_outcome(connection: &mut PgConnection, job_id: &str,
    notification: JobNotification<'_>) -> Result<(), sqlx::Error>;
```

`JobNotification` 是 `recipient_id: &str`、`event_key: &str`、`subject: &str`、`target: NotificationTarget`；Target 是 `kind: String`、`resource_id: String`、`context: BTreeMap<String, String>`。与业务请求、快照、enqueue、audit、idempotency 同事务登记，此时 inbox 不可见。Core 在 succeed 或最终 fail 的 fenced 事务发布，retry_wait 不通知。[Knowledge 请求实现](../../crates/app/src/modules/knowledge/exports/requests.rs#L87)

`publish_job_outcome` 是 `pub(crate)`，外部 fixture 不可调用；没有公共即时任意通知接口。`job_notifications.job_id` 为主键，当前每个 Job 只有一个收件人；event_key/subject 1..200 字符，target JSON 文本最多 4096 字节。通知以 `(recipient_id, event_key, outcome)` 去重，重试不重置 read_at；失败和后续成功可以各有一条。[迁移](../../migrations/0013_notifications.sql)，[终态发布](../../crates/app/src/modules/notifications/mod.rs#L56)

subject 保持通用，不写工单标题等撤权后仍会泄露的信息；Target 是导航提示，不能含签名 URL 或作为授权凭据。工单 backend fixture 可以只检查 Core inbox 中的 target，无需新增前端 resolver；正式客户端接入时 resolver 属于业务贡献。[Target 约束](../../crates/app/src/modules/notifications/mod.rs#L10)

## 5. 输入、身份、成员锁、审计与幂等

| 接口 | 实际合同与来源 |
| --- | --- |
| HTTP 输入 | `http::BoundedJson<T>(pub T)`、`ApiPath<T>`、`ApiQuery<T>` 返回统一错误；BoundedJson 3 秒读取预算，字节限制由 Axum body limit 决定，必要时业务 Router 显式配置。要求 composition 装配 request_context；不能把该名字解释为任意 DTO 的字段约束。[http.rs](../../crates/app/src/http.rs#L14) |
| HTTP 错误 | `public_error(status: StatusCode, code: &'static str, message: &'static str, id: RequestId) -> Response`；文件错误可直接 `files::Error::response(id)`。[源码](../../crates/app/src/http.rs#L211) |
| Session | `identity::require_session(pool: &PgPool, settings: &AuthSettings, headers: &HeaderMap, id: &RequestId, mutation: bool) -> Result<CurrentSession, Response>`；写操作检查 Origin/CSRF，显式 Authorization 被拒绝；返回 user.id/email/display_name/role 与 csrf_token。[源码](../../crates/app/src/modules/identity/mod.rs#L500) |
| 当前成员 | `organization::active_role_in(connection: &mut PgConnection, user_id: &str) -> Result<Option<MemberRole>, sqlx::Error>`，FOR SHARE 防成员停用/改角色穿透写事务。`active_role(pool: &PgPool, user_id: &str)` 无锁，不能代替写事务内检查。[源码](../../crates/app/src/modules/organization/mod.rs#L38) |
| 多成员锁 | `organization::lock_memberships(connection: &mut PgConnection, user_ids: &[String]) -> Result<Vec<MembershipAccess>, sqlx::Error>`；按 id 顺序 FOR SHARE，先成员后资源。业务检查 active/role 与请求 id 是否齐全。[源码](../../crates/app/src/modules/organization/mod.rs#L59) |
| 后台凭据 | `identity::background_credential(connection: &mut PgConnection, settings: &AuthSettings, headers: &HeaderMap, user_id: &str) -> Result<Option<CredentialRef>, sqlx::Error>`；只捕获当前用户的有效 Session id。[源码](../../crates/app/src/modules/identity/mod.rs#L554) |
| Worker 身份 | `identity::credential_is_current(connection: &mut PgConnection, settings: &AuthSettings, user_id: &str, credential: &CredentialRef) -> Result<bool, sqlx::Error>`；FOR SHARE 检查 Session 未撤销且绝对/idle 未过期，不续期。CredentialRef 当前只有 `Session { id: String }`，不是原 secret/hash，也不支持 API Key 后台凭据。[源码](../../crates/app/src/modules/identity/mod.rs#L549) |
| 审计 | `audit::append(connection: &mut PgConnection, event: Event<'_>) -> Result<(), sqlx::Error>`；Event 的 actor_id/action/resource_type/resource_id、`Source::Request(&str)` 或 `Source::Job { id, correlation_id }`、可选 subject_user_id。没有任意 metadata JSON 接口，失败回滚业务。[源码](../../crates/app/src/modules/audit/mod.rs) |
| 幂等 | `idempotency::fingerprint(payload: &impl Serialize) -> Result<Vec<u8>, Error>`；`claim(connection: &mut PgConnection, attempt: &Attempt<'_>) -> Result<Option<Value>, Error>`；`complete(connection: &mut PgConnection, attempt: &Attempt<'_>, response: Value) -> Result<(), Error>`。[源码](../../crates/app/src/modules/idempotency/mod.rs) |

`Attempt` 的字段是 actor_id/scope/key/fingerprint。业务必须先重新授权再 claim，scope 需包含端点与资源 id，摘要基于规范化后的业务输入。key 1..128 字节且为 33..126 ASCII，同作用域/用户/键的不同 payload 返回 Conflict；默认记录保留 24 小时。claim 的 None 表示本事务执行新请求，必须 complete 后再提交；Some(response) 表示重放。它不是通用乐观并发 API，工单 version 条件更新与冲突码由工单自己实现。[幂等源码](../../crates/app/src/modules/idempotency/mod.rs#L24)，[期限迁移](../../migrations/0004_idempotency.sql)

若后续章节教只读 API Key，存在 `api_keys::require_read(pool: &PgPool, auth: &AuthSettings, headers: &HeaderMap, id: &RequestId, scope: &str) -> Result<ReadActor, Response>`；scope 通过 CoreOptions 注册，认证后仍须检查工单权限。显式无效 Bearer 不回退 Cookie。本轮连续工单课程可以先只用 Session，不能把写操作或后台凭据描写成 Key 已支持。[源码](../../crates/app/src/modules/api_keys/authentication.rs#L53)

## 6. 建议的有界教学 fixture

建议保持 `examples/tutorial-tickets` 为课程拥有的代码，在阶段检查中通过 `#[path = "..."] mod tickets` 引入，构造 `tickets::router`/`openapi` 并与 `saas_app::compose_routes` 组装。这两个 tickets 名称是教学业务将实现的接口，尚不是 Core 能力。已有 [preview.rs](../../examples/tutorial-tickets/preview.rs)、[公开组装测试](../../apps/api/tests/tutorial_module.rs)证明此接入方式；不要在默认 `modules/mod.rs`、`apps/api/src/lib.rs` 或生产 Worker 注册 tickets。

建议业务只拥有一个工单表、一个上传/附件关联表和一个导出表：

- 工单：id、created_by、title、description、status、version；作者或当前 Owner/Admin 可以访问，其他成员隐藏资源。这是教程建议的权限策略，需在章节清楚声明，不是 Core 预设规则。
- 附件：file_id 关联工单并记录是否已发布，file_id 引用 saas_core.files；列表查询自己的已发布关系再 ready_info。单表替代 Knowledge 的两张关系表可行，但业务必须在完成/重放时检查自己的 published 标志；不能只看 Core ready。
- 导出：id、ticket_id、requested_by、credential、job_id、snapshot、file_id、expires_at；job payload 只放 export_id。请求快照含工单当前版本数据；以小型 JSON 文件展示异步生成，最大输出建议 64 KiB、最多 8 个附件引用、120 秒总任务预算。这些数值是教学建议，不是已存在配置。
- 第一版 JSON 导出可只包含附件元数据，以 Files::snapshots 校验当前对象身份，不读取附件二进制。产物需要由服务端临时文件计算真实大小与 SHA-256，通过 prepare_generated/write_generated/publish 发布。若课程承诺“包含附件字节的离线副本”，须增加 download_snapshot 与真正 ZIP 打包，不能把元数据 JSON 描述成同等成果。
- 使用 tempfile 私有目录，文件生成完成后保持不可变，drop/close 清理目录；生成阶段的大小/数量/超时和并发须有界。小 JSON 可避免复制 Knowledge 的 Markdown destination 改写、ZIP writer 与 blocking cancellation 体系。
- 最终 Worker 同时显式注册自有 Handler、Core cleanup/rescan，独立注册 Core cleanup maintenance 与自有导出期限 maintenance。测试使用 Worker::run_once，生产教学入口使用 run_until 和 run_maintenance。

教学迁移应放在课程自有目录；阶段测试先跑真实 Core migrations，再在隔离数据库执行课程 SQL。`saas_platform::postgres::MIGRATOR` 嵌入仓库根 migrations，Core readiness 严格比较 `_sqlx_migrations` 的数量/版本/checksum。因此把课程迁移加入同一个记录表但未加入嵌入 MIGRATOR 会让健康检查失败；如果只执行 fixture SQL，Core readiness 不证明工单 schema 已安装。教程必须用自己的 HTTP 读写证明工单迁移，生产阶段在临时模板副本把课程迁移并入根 migrations、重编译并验证 health。[嵌入迁移](../../crates/platform/src/postgres.rs)，[schema_version](../../crates/app/src/modules/system/mod.rs#L41)

未公开的辅助代码不能直接移植为框架 API：`knowledge::application` 模块及 lock_document/manager、attachments 的 register_upload/plan/publish/associated 都是私有或 pub(super)；导出 ExportRequest、Snapshot 和创建流程属于 Knowledge。公开 knowledge::export_handler/process_export 虽可被外部调用，但绑定 Knowledge 模型和规则，不能处理工单数据。工单应写自己的少量授权/SQL/Handler，并复用上述 Core 接口。[模块边界](../../crates/app/src/modules/knowledge/mod.rs)，[实际授权](../../crates/app/src/modules/knowledge/application.rs#L19)，[导出请求](../../crates/app/src/modules/knowledge/exports/requests.rs)

仍需明确的业务语义：作者/管理员访问范围；快照是请求时版本还是执行时版本；退出/过期凭据是否取消任务；导出是否包含附件字节；产物期限与下载期限；资源删除怎样清理待上传/ready 附件和导出；通知收件人与通用 subject。以上可采用本记录建议，不应凭空宣称 Core 自动处理。

## 7. 验证证据与阶段验收入口

以下都是现有公开接口测试，提供教学 fixture 应覆盖的失败边界：

| 风险 | 一手测试位置 |
| --- | --- |
| 完成后重新授权、Session 失效、审计回滚 | [attachments.rs](../../apps/api/tests/attachments.rs#L212)：`completion_rechecks_grants_after_object_io`、`a_session_expiring_during_copy_cannot_publish`、`failed_publication_audit_keeps_the_upload_recoverable` |
| 重放、拒绝、只发布一次 | [attachments.rs](../../apps/api/tests/attachments.rs#L601)：`upload_identity_is_replayed_but_expiration_requires_a_new_resource`、`size_or_type_mismatch_is_rejected_without_publishing`、`concurrent_completions_publish_one_attachment_and_staging_replay_cannot_change_it` |
| 删除立即隐藏、Worker 实际清理、迟到对象重探测 | [deletion.rs](../../apps/api/tests/deletion.rs#L150)：`deleted_attachments_are_immediately_invisible_and_worker_removes_the_actual_object`、`expired_uploads_keep_their_error_and_late_objects_are_removed_by_a_recorded_rescan` |
| 条件复制与条件写入 | [object_storage.rs](../../crates/platform/tests/object_storage.rs#L46)：`presigned_upload_is_copied_without_overwriting_an_existing_final_object`、`generated_files_stream_without_overwriting_an_existing_candidate` |
| 过期旧 Worker 无法发布新结果 | [jobs.rs](../../crates/app/tests/jobs.rs#L133)：`crashed_claims_consume_the_budget_and_stale_workers_cannot_change_the_result`、`two_workers_recover_a_lease_without_publishing_the_late_first_result` |
| 通知只有终态可见、去重保留已读 | [notifications.rs](../../crates/app/tests/notifications.rs#L109)：`a_job_outcome_belongs_only_to_its_recipient_and_read_state_survives_refresh`、`only_terminal_failure_notifies_and_admin_retries_deduplicate_without_resetting_read_state` |
| 结果/通知原子提交 | [exports.rs](../../apps/api/tests/exports.rs#L853)：`notification_publication_failure_rolls_back_export_result_and_recovers_without_duplicates` |
| 导出快照、退出失效与来源绑定 | [exports.rs](../../apps/api/tests/exports.rs#L110)：`requesting_an_export_keeps_one_request_time_snapshot_after_document_edits`、`logging_out_the_initiating_credential_fails_the_queued_export`、`export_access_is_bound_to_the_requester_and_source_and_expired_results_stop_signing` |

DOC02 的阶段检查应走自己的真实 HTTP Router、隔离 PostgreSQL 和 Files 的真实 RustFS 协议；任务通过公开 Worker/Lease 驱动，再从工单结果与 Core inbox/audit 查询验收。受控存储 barrier 可以只拦截复制以组织撤权竞态，仍委托真实 adapter；不要为每个私有 helper 写镜像测试。[已约定测试策略](../testing/strategy.md)
