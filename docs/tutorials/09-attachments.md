# 为自己的业务接入 Files

目标：为业务资源添加私有附件，复用 Core 文件生命周期和 S3 适配器。前提是 API/PostgreSQL/RustFS 已通过[快速开始](../getting-started/quickstart.md)运行，资源已有授权策略。业务拥有资源/file 关联表，Files 不知道文档或工单权限。

<!-- example:knowledge:reference-01:start -->

完整参考：[授权策略](07-library-grants.md)。

<!-- example:knowledge:reference-01:end -->

## 构造与公共接口

[Files 类型与服务](../../crates/app/src/modules/files/mod.rs)公开 `FileService::from_settings(storage, limits)`；替换适配器用 `FileService::new(storage, bucket, policy)`。`UploadInput` 为 `file_name / content_type / size / sha256`；validate 规范化 MIME/摘要并检查预算，start 也重新验证。

| 阶段     | 公共方法                                 | 返回值                               |
| -------- | ---------------------------------------- | ------------------------------------ |
| 注册     | `start(connection, actor_id, input)`     | `Upload`，公开 `id`                  |
| 重放     | `load(connection, id)`                   | 原 Upload                            |
| 签上传   | `upload_capability(upload)`              | URL、method、headers、expires_at     |
| 规划完成 | `plan_completion(connection, id)`        | Ready / Attempt / Expired / Rejected |
| 核验     | `verify_candidate(attempt)`              | VerifiedCandidate                    |
| 放弃     | `abandon(connection, attempt, rejected)` | 候选可被清理                         |
| 发布     | `publish(connection, verified)`          | Adopted / Existing / Expired         |
| 下载     | `download(connection, id, inline)`       | DownloadCapability                   |

这些是方法调用形状；完整签名和类型见源码。`CompletionAttempt / VerifiedCandidate` 字段私有，必须由服务返回，不能手工制造绕过核验。

<!-- example:knowledge:reference-02:start -->

完整参考：[Knowledge 附件](../../crates/app/src/modules/knowledge/attachments.rs)。

<!-- example:knowledge:reference-02:end -->

## 完整提交边界

1. 短事务 A：验证 Session，锁当前 Membership 和业务资源、授权；claim 幂等命令，start 并写资源/file 关联，complete 只存 upload_id，commit。重放检查关联并 load。事务外签上传，不存短期 URL。
2. 客户端使用返回 method/headers PUT staging；成功上传仍不在业务附件列表可见。
3. 短事务 B：再次授权、确认关联，plan_completion 并提交候选记录。Ready 重放仍检查业务已发布关联；Expired/Rejected 明确拒绝。
4. 事务外 verify_candidate：HEAD、按源 ETag 条件 COPY 到唯一候选、HEAD/完整字节/长度/MIME/SHA-256 校验。候选目标不可覆盖；图片/PDF 另查文件标识。
5. 短事务 C：重新验证当前凭据、成员、资源/授权/关联和期限，publish、发布业务关联、Audit、commit。失败候选调用 abandon，持久清理记录保留。

事务外 I/O 后必须重新授权；开始时合法不代表完成时合法。并发完成只采用一个 ready 对象，其他返回相同附件。Audit 失败回滚文件状态和关联，可恢复完成。超时不证明远端写入失败，候选位置先登记再 I/O。

## 下载与配置边界

默认单文件 20 MiB、上传 900 秒、下载 60 秒，实际值以[配置参考](site:reference/config.md)为准。下载先检查业务关联和当前资源权限，再对 ready 文件签名；`ready_info(connection, ids)` 只批量读已授权 IDs，不替业务授权。

撤权/删除后停止签发新链接，已签 URL 到期前仍可能有效，已接受传输可能继续。业务只保存 file ID，不保存签名 URL。S3 凭据只在 API/Worker，Cookie 不发送到 S3。`S3_ENDPOINT` 与 `S3_PUBLIC_ENDPOINT` 分开；按公共 origin 签名，不能事后改 hostname/path。

## 验证与恢复

仓库根目录执行：

```bash
just bootstrap-storage
node scripts/test-storage.mjs
```

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test attachments
```

<!-- example:knowledge:reference-03:end -->

真实 HTTP/存储测试证明 staging 不可见、唯一发布、大小/类型拒绝、Audit 回滚、关联检查，以及复制期间撤权/Session 过期/资源消失的发布拒绝。过期或 rejected 上传使用新资源；暂时故障重试原资源。自己的业务沿用同样边界，并登记关联迁移、Router、测试与所有权。继续[生成文件与 Jobs](10-document-exports.md)和[对象清理](12-deletion-cleanup.md)。

<!-- example:knowledge:reference-04:start -->

完整参考：[真实 HTTP/存储测试](../../apps/api/tests/attachments.rs)。

<!-- example:knowledge:reference-04:end -->
