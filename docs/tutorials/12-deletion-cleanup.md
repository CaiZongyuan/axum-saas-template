# 业务删除与对象回收

目标：删除自己的资源后立即停止授权访问，再用持久任务可靠清理字节。前提是已接入 [Files](09-attachments.md) 和 [Jobs](10-document-exports.md)。删除是持久数据变更，知识库参考没有回收站。

## 先提交不可见性

Knowledge 删除用例短事务标记文档/库删除，并写 Audit 和清理 Job；附件删除由附件用例删除关联、mark_deleting、Audit 一起提交。审计失败资源仍可见，不能留下孤立清理任务。

<!-- example:knowledge:reference-01:start -->

完整参考：[Knowledge 删除用例](../../crates/app/src/modules/knowledge/deletion.rs)；[附件用例](../../crates/app/src/modules/knowledge/attachments.rs)。

<!-- example:knowledge:reference-01:end -->

自己的读取、搜索、更新、上传完成和导出必须检查删除状态。大集合按批由业务 Handler 清理关联，不在 HTTP 请求遍历全部文件或执行 S3。个人库保留删除标记及唯一关系，首次写入不能自动复活它；旧创建幂等结果也需重新读当前可见性。

## 通过公共 Files 接口登记清理

[Files 清理](../../crates/app/src/modules/files/cleanup.rs)公开接口：

```rust
pub async fn mark_deleting(
    connection: &mut PgConnection,
    id: &str,
    correlation_id: &str,
) -> Result<(), Error>;
```

这是签名摘录，类型 `Error` 为 Files 错误；在自己的已授权删除事务调用。Core 登记不可变 bucket/key 的 object_cleanup 和任务，不要求自己的 Handler 重写 S3 删除队列。业务关联与文件状态、任务和 Audit 一起提交。

[Worker 入口](../../apps/worker/src/main.rs)注册 `files::cleanup_handler`、`files::rescan_handler` 和 `files::cleanup_maintenance`；自己的业务可另注册关联/过期维护。维护通过 `jobs::run_maintenance` 独立运行，只做有界数据库/入队，不阻塞续租或做存储 I/O。

## 限定工作量并保留位置

每轮最多 100 个目标，事务外 S3 Delete 后以有效租约提交进度；对象已不存在算成功。部分成功后从剩余位置恢复，五次预算耗尽由管理员明确重试，维护不不断补发新预算。清理依据已提交删除状态，不因用户退出停止。

迟到 PUT/COPY 可能在首次删除后才完成，因此登记位置持续保留。默认一小时后再探测，共享 `files.rescan` 每轮最多 100 个到期位置；间隔是最早调度，不保证精确完成时间。独立 UUID key 不复用，旧清理不会删除新 ready 文件。

Core 清理过期 pending/rejected、staging 和非采用候选，不会仅因 retention 过期删除当前 ready 产物。自己的业务应停止到期下载、清快照/引用并调用 mark_deleting，参考导出维护。

<!-- example:knowledge:reference-02:start -->

完整参考：[导出维护](../../crates/app/src/modules/knowledge/exports/maintenance.rs)。

<!-- example:knowledge:reference-02:end -->

## 在途操作与验证

上传完成和导出发布在 I/O 后重新检查资源；复制成功不能复活已删除业务。删除快照中的附件会使未执行导出失败，不能发布缺字节的成功结果。新下载立即拒绝，旧签名 URL 仍有[TTL 边界](09-attachments.md)。

仓库根目录执行：

<!-- example:knowledge:reference-03:start -->

```bash
node scripts/test-backend.mjs --test deletion --test attachments --test exports
```

<!-- example:knowledge:reference-03:end -->

真实 HTTP/Worker 测试验证立即不可见、RustFS 字节删除、Audit 回滚、不复活、复制竞态、过期和晚到对象复查。自己的业务新增删除关联/查询断言，保留 Core 清理能力；接着使用[通知](13-export-notifications.md)和[审计](14-audit-history.md)追溯结果。

<!-- example:knowledge:reference-04:start -->

完整参考：[真实 HTTP/Worker 测试](../../apps/api/tests/deletion.rs)。

<!-- example:knowledge:reference-04:end -->
