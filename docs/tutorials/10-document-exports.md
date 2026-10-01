# 业务快照、后台任务与生成文件

目标：把耗时业务从 HTTP 请求移到 Worker，可靠地发布结果。前提是已接入授权、[Files](09-attachments.md)和事务。知识库导出是真实 ZIP 完整实现；自己的业务定义自己的快照、Handler 和产物有效期。

<!-- example:knowledge:reference-01:start -->

完整参考：[授权](07-library-grants.md)；[事务](04-personal-documents.md)。

<!-- example:knowledge:reference-01:end -->

## 请求事务先固定业务事实

Knowledge 请求用例在一个事务重新授权，检查发起 Session，保存请求时点的标题/正文/版本和 ready 附件身份，入队、登记通知意图、Audit、幂等结果，再提交。编辑原文不会改变该次快照。

<!-- example:knowledge:reference-02:start -->

完整参考：[Knowledge 请求用例](../../crates/app/src/modules/knowledge/exports/requests.rs)。

<!-- example:knowledge:reference-02:end -->

[Jobs](../../crates/app/src/modules/jobs/mod.rs)公共入队接口摘录：

```rust
pub async fn enqueue(connection: &mut PgConnection, job: NewJob<'_>)
    -> Result<String, sqlx::Error>;
```

`NewJob` 为 `kind / schema_version / max_attempts / payload / correlation_id`。payload 只存业务记录 ID，不存正文、Cookie、签名 URL 或秘密；事务回滚时 Job 不可见。业务定义有限预算，数据库限制尝试数 1–20。

通过 `identity::background_credential(connection, auth, headers, user_id)` 捕获当前有效 Session ID 引用；`CredentialRef::Session { id }` 不是 secret/hash，不支持 API Key 后台凭据。执行和发布分别调用 `credential_is_current`，检查未撤销、未过期且不续期。退出原 Session 后，旧任务失败，重新登录不会让旧任务恢复资格。

## 显式实现和注册 Handler

[公开 Handler 合同](../../crates/app/src/modules/jobs/worker.rs)为：

```rust
#[async_trait::async_trait]
pub trait Handler: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn run(&self, lease: &Lease) -> Result<(), JobError>;
}
```

自己的实现校验 kind/schema/payload、读取业务快照和当前身份/权限，在事务外做有界生成。通过 [Worker 组装点](../../apps/worker/src/main.rs)加入 `Arc<dyn Handler>`，kind 保持唯一；Worker 只领取已注册类型。`Worker::new(pool, handlers, policy)` 是公共构造器，`run_once` 适合受控测试；它返回 true 仅表示执行过任务，不证明业务成功。

`run` 返回 Ok 不会自动标成功。最终短事务先 `lease.lock_current(&mut tx)` 保持租约 fence，再重新检查业务条件、发布文件/结果、Audit、`lease.succeed(&mut tx)`，最后 commit。Job、attempt/batch 与结果/通知共同提交；丢失租约的旧 Worker 不能发布。

## 用 Files 生成可下载产物

[Files](../../crates/app/src/modules/files/mod.rs)的调用顺序为：

1. `snapshots(connection, ids)` 获取已经由业务授权的 ready 文件不可变身份；缺任何输入就失败，不能从 HTTP 接受任意 FileSnapshot。
2. 在私有临时目录生成文件，限制条目数、输入/输出字节、执行时间和并发，关闭输出后计算真实大小与 SHA-256。
3. 短事务 `prepare_generated(connection, actor_id, input, max_bytes, retention_secs)` 登记唯一候选并提交。
4. 事务外 `write_generated(attempt, path)` 条件上传不可变文件，核验大小/MIME/upload-id，得到 VerifiedCandidate。
5. 进入上述 fenced 发布事务，调用 `publish` 并关联业务结果。

`write_generated` 信任服务端声明的真实摘要，不重复客户端上传的完整 READ/魔数核验，调用者必须保证文件生成完毕且不再改变。需要包含附件字节时使用 `download_snapshot` 流式取回并校验，不能把附件元数据 JSON 称为离线 ZIP。

## 有界运行与有效期

完整生成/发布代码和ZIP 打包采用临时文件、分块输入和条件 PUT。知识库默认最多 100 附件、256 MiB 输入、272 MiB 输出、120 秒总预算、单进程一个打包；参数来自[生成配置](site:reference/config.md)，不是 Core 对所有业务的规定。

<!-- example:knowledge:reference-03:start -->

完整参考：[生成/发布代码](../../crates/app/src/modules/knowledge/exports/worker.rs)；[ZIP 打包](../../crates/app/src/modules/knowledge/exports/archive.rs)。

<!-- example:knowledge:reference-03:end -->

ZIP 路径用受控 ID，不使用用户文件名成为目录；只改写快照内的 Markdown 附件链接，不抓取外链。已开始的阻塞打包不能强制 abort，线程持有临时目录/并发许可至真实退出；SIGKILL 可能留下临时目录。

知识库结果默认 24 小时到期，停止签新链接并由业务维护清快照、mark_deleting 文件。Files 的 retention 参数本身不删除当前 ready 产物，自己的业务也必须实现过期规则。访问结果时重新检查当前访问者、原请求者和源资源；已签 URL 仍有[下载 TTL](09-attachments.md)。

<!-- example:knowledge:reference-04:start -->

完整参考：[业务维护](../../crates/app/src/modules/knowledge/exports/maintenance.rs)。

<!-- example:knowledge:reference-04:end -->

## 验证与后续

仓库根目录执行：

```bash
node scripts/test-backend.mjs --test jobs
node scripts/test-storage.mjs generated_files
```

<!-- example:knowledge:reference-05:start -->

```bash
node scripts/test-backend.mjs --test exports
```

<!-- example:knowledge:reference-05:end -->

公开 HTTP/Worker 检查证明请求快照、真实 ZIP 字节、原凭据失效拒绝、丢失租约拒绝、Audit/通知故障回滚、产物到期和输入预算。自己的 Handler 最少验证请求事务、执行、结果读取和一次迟到旧执行者拒绝。继续[恢复与尝试预算](11-job-recovery.md)、[清理](12-deletion-cleanup.md)和[通知意图](13-export-notifications.md)。

<!-- example:knowledge:reference-06:start -->

完整参考：[公开 HTTP/Worker 检查](../../apps/api/tests/exports.rs)。

<!-- example:knowledge:reference-06:end -->
