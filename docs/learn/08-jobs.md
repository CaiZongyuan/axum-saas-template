# 08 用 Worker 生成工单 JSON 快照并发布通知

起点：同一个工单与 ready 附件。本课升级到 `jobs`，在请求时冻结工单和附件元数据，后台生成最大 64 KiB JSON。它不包含附件字节，不是 ZIP，也不是全站备份。

## 安装任务检查点

停止课程开发进程，在原模板根目录运行，再启动副本：

```bash
node scripts/tutorial-course.mjs --stage jobs --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

副本新增 `crates/app/src/modules/tickets/exports.rs`、导出记录/迁移与 OpenAPI，并在 `apps/worker/src/main.rs` 显式注册导出 Handler 和业务期限维护。请求终端仍加载 `.course.env`，沿用自己的 Cookie、CSRF 和工单 id。

## 请求事务保存快照、Job 和通知意图

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: ticket-export-1" -H "Content-Type: application/json" \
  --data '{}' "$BASE_URL/api/v1/tickets/$TICKET_ID/exports" \
  > .scratch/course-http/export.json
export EXPORT_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/export.json','utf8')).id")
```

预期 202，返回 id/job_id/status/expires_at。任务可能很快执行，202 表示已受理，不表示文件已经生成。

请求用自己的事务完成授权、快照、`jobs::enqueue`、`notifications::on_job_outcome`、审计和幂等结果：

<<< ../../examples/tutorial-tickets/exports.rs#enqueue-export

Job payload 只保存 export_id；业务快照和发起 Session 标识在自己的导出表，不保存 Session secret 或短期签名 URL。通知此时只是意图，只有成功或最终失败才进 Core 收件箱，重试等待不通知。当前公共通知合同每个 Job 只有一个收件人。

## 执行与发布是两个边界

<<< ../../examples/tutorial-tickets/exports.rs#export-handler

Handler 校验 kind/schema_version/payload，在有界生成阶段计算实际 JSON 大小与 SHA-256，使用 Files::prepare_generated/write_generated 写不可变候选。超出 64 KiB 就拒绝；不能把客户端提供的 size/hash 当成生成文件事实。

发布事务持有当前 Lease，重新检查原发起 Session、有效成员、工单权限与文件身份，再把导出结果、Files、Audit、Job succeed 和终态通知共同提交：

<<< ../../examples/tutorial-tickets/exports.rs#export-publication

`Ok(())` 不是自动 succeed。租约丢失的旧 Worker 不能覆盖新执行者结果；临时失败可以按预算重试，永久授权失败不发布产物。退出/过期的原 Session 不能用新 Session 替换来“复活”排队任务。

## 等待终态并读取真实产物

在请求终端导出公开变量后，用有截止时间的轮询：

```bash
export BASE_URL TICKET_ID EXPORT_ID
node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const endpoint = `${process.env.BASE_URL}/api/v1/tickets/${process.env.TICKET_ID}/exports/${process.env.EXPORT_ID}`;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  const response = spawnSync('curl', [
    '--fail-with-body', '-sS', '-b', '.scratch/course-http/cookies', endpoint,
  ], { encoding: 'utf8', timeout: 5000 });
  if (response.status !== 0) throw new Error('Export status request failed');
  const result = JSON.parse(response.stdout);
  if (result.status === 'succeeded') {
    console.log('Export succeeded');
    process.exit(0);
  }
  if (['failed', 'expired'].includes(result.status))
    throw new Error('Export reached an unavailable terminal state');
  await setTimeout(1000);
}
throw new Error('Export did not finish before the deadline');
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/exports/$EXPORT_ID/download" \
  > .scratch/course-http/export-download.json
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/export-download.json', 'utf8'));
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error('Export download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 64 * 1024) throw new Error('Export exceeds its budget');
const snapshot = JSON.parse(bytes.toString('utf8'));
if (snapshot.ticket.id !== process.env.TICKET_ID || !Array.isArray(snapshot.attachments))
  throw new Error('Export snapshot differs from the requested business');
writeFileSync('.scratch/course-http/ticket-export.json', bytes);
console.log('Ticket snapshot verified');
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/notifications"
```

预期文件含请求时的 ticket 与 attachments 元数据；后续编辑工单不修改这份快照。Core 通知包含本次任务终态，可按 target 的资源 id 与任务记录关联。subject 使用通用标题，不泄露工单内容。

## 一个拒绝与业务期限

第四课其他成员请求导出下载应返回 404：

```bash
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/exports/$EXPORT_ID/download"
```

导出业务保留 1 小时，到期后拒绝新签下载，并由自己的 Maintenance 调用 Files 清理，释放 snapshot/file 引用。Core ready 文件的 expires_at 不会自动实现这项业务回收规则。发起者失效、租约丢失和通知写入失败等组合由[课程集成测试](../../crates/app/tests/tutorial_course.rs)验证。

上一课：[附件发布](07-files.md)。下一课：[公开验证与生成 SDK](09-verification.md)。
