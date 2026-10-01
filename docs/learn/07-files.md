# 07 给工单接入上传、核验与下载

起点：第六课的受保护工单，保留 Session、`TICKET_ID` 与版本。本课升级到 `files`，新增工单/文件关联；文件字节进入 RustFS，资源权限仍由工单判断。

## 安装文件检查点

停止课程副本开发进程，在原模板根目录运行，再启动副本：

```bash
node scripts/tutorial-course.mjs --stage files --root .scratch/ticket-saas
cd .scratch/ticket-saas
just dev
```

副本新增 `crates/app/src/modules/tickets/attachments.rs`、附件关系迁移/表归属，以及 Router/OpenAPI 接入。应用从 Settings 构造 FileService 并注入工单 Router，不把 S3 密钥传给客户端。请求终端继续 `source .course.env`，沿用课程 Cookie 与 CSRF。

## 创建有真实摘要的上传

在副本根目录创建一个小文本与对应的 UploadInput：

```bash
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const bytes = Buffer.from('Ticket attachment\n');
writeFileSync('.scratch/course-http/attachment.txt', bytes);
writeFileSync('.scratch/course-http/upload-input.json', JSON.stringify({
  file_name: 'attachment.txt',
  content_type: 'text/plain',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));
NODE
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: ticket-attachment" -H "Content-Type: application/json" \
  --data-binary @.scratch/course-http/upload-input.json \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/uploads" \
  > .scratch/course-http/upload.json
```

预期 201，返回 upload_id、state 和可选 upload 能力。首次 pending 上传的 upload 含 url/method/headers/expires_at。同 key 重放保留上传身份；已完成时 upload 可以为 null，不应再次 PUT。

工单在授权后的事务中使用 Files::start，并写自己的关联与重放记录：

<<< ../../examples/tutorial-tickets/attachments.rs#upload-register

## 传字节后显式完成

所有签名 header 都要使用，不打印完整签名 URL：

```bash
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/upload.json', 'utf8')).upload;
if (!capability) throw new Error('Upload is already complete; skip the staging transfer');
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
  body: readFileSync('.scratch/course-http/attachment.txt'),
});
if (!response.ok) throw new Error('Staging upload failed');
NODE
export UPLOAD_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/upload.json','utf8')).upload_id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -X POST "$BASE_URL/api/v1/tickets/$TICKET_ID/uploads/$UPLOAD_ID/complete" \
  > .scratch/course-http/file.json
export FILE_ID=$(node -p "JSON.parse(require('node:fs').readFileSync('.scratch/course-http/file.json','utf8')).id")
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments"
```

完成返回 200/FileInfo，列表出现 `FILE_ID`。单独 PUT 成功不会把 pending 上传发布到业务列表。

完成流程先在短事务规划候选，在事务外核验/复制对象，再在新事务重新检查 Session、有效成员和工单权限，最后发布 Files 与业务关联：

<<< ../../examples/tutorial-tickets/attachments.rs#file-completion

对象 I/O 不能由 PostgreSQL 回滚；失败候选要登记清理，只有实际发布关联可作为附件。

## 下载字节与拒绝路径

```bash
curl --fail-with-body -sS -b .scratch/course-http/cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments/$FILE_ID/download" \
  > .scratch/course-http/download.json
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const capability = JSON.parse(readFileSync('.scratch/course-http/download.json', 'utf8'));
const response = await fetch(capability.url, {
  method: capability.method,
  headers: capability.headers,
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error('Attachment download failed');
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== capability.file.size ||
    createHash('sha256').update(bytes).digest('hex') !== capability.file.sha256)
  throw new Error('Attachment bytes differ from published metadata');
console.log('Attachment bytes verified');
NODE
curl -i -b .scratch/course-http/other-cookies \
  "$BASE_URL/api/v1/tickets/$TICKET_ID/attachments/$FILE_ID/download"
```

授权下载返回 200 能力，实际对象字节与发布摘要一致；第四课的其他成员得到 404。短期 URL 是 bearer 能力，不提交或记录到日志；重新请求下载必须重新授权。

完整来源是 [attachments.rs](../../examples/tutorial-tickets/attachments.rs)与[Files 公共接口](../../crates/app/src/modules/files/mod.rs)。若对象未传、摘要不符或 Session 在核验期间失效，不能发布附件；修复后使用可恢复的上传状态或创建新上传。

上一课：[重试与版本](06-retries-versions.md)。下一课：[后台生成 JSON 快照](08-jobs.md)。
