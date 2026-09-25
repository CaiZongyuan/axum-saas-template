# 跟做：上传附件、引用图片与下载

`just dev` 现在启动 PostgreSQL 与 RustFS，运行数据库迁移，并初始化专用私有 bucket 的浏览器 CORS。首次运行需要拉取固定版本镜像；API/Web 仍支持原来的开发反馈循环。

保存一篇文档，在“附件”选择文件并点击“上传附件”。页面显示准备、上传进度和校验状态，校验完成后附件才进入列表。点击下载可以取回原始字节；图片可以在编辑页点击“插入引用”，切到预览查看，再显式保存正文。

默认单文件上限 20 MiB、上传会话 15 分钟、下载链接 60 秒。实际值来自[生成配置参考](site:reference/config.md)，不能只修改前端提示。

## 1. 浏览器拿到的是受限能力

[Web 文件适配](../../apps/web/src/knowledge-files.ts)负责读取 File、计算 SHA-256、XHR 上传进度和实际下载。应用 Cookie 只用于自己的 API，对 S3 传输省略凭据。单次字节传输最多 120 秒（包含响应体读取），超时后恢复重试操作；离开页面会取消传输。

申请上传时发送文件名、MIME、大小和校验和。服务端验证文档编辑权，生成暂存 key，保存上传记录及业务关联，并返回 URL、方法、必需 headers 与截止时间。前端不能指定 bucket/key，也拿不到存储管理密钥。原始文件名只是显示值，不用作对象路径。

[ObjectStorage 适配器](../../crates/platform/src/object_storage.rs)使用标准 S3 API，固定 RustFS 1.0.0 与 AWS SDK 1.149.0。内部操作端点与公开签名端点分开，先按公开地址签名，不事后改 hostname 或路径。签名绑定类型、校验头与上传标识；Content-Encoding 固定为 identity，避免下载时发生内容解码变化。浏览器控制的 Content-Length 不进入返回 headers。

专用 bucket 默认私有。初始化只在 HEAD 确认 404 时创建，不把 403 当作不存在；可重复执行的初始化使用有上限的标准重试，覆盖实测的并发 CreateBucket `503 SlowDown`。条件复制保持一次尝试，超时结果通过候选记录处理。

## 2. 上传到存储，不代表附件已经发布

[Core Files](../../crates/app/src/modules/files/mod.rs)拥有文件状态和候选对象记录；[知识库附件用例](../../crates/app/src/modules/knowledge/attachments.rs)拥有文档关联和库级授权。Core 不读取 Document 或 Grant 表。

完成操作分三个阶段：

1. 短事务重新验证文档编辑权，先登记唯一候选 key，再提交。
2. 在事务外读取暂存对象 ETag，条件复制到独占候选 key，检查候选的实际长度、MIME/上传标识、完整字节和 SHA-256。
3. 再次验证当前凭据、文档存在性、Grant、上传状态与期限，原子选定唯一 ready 对象、关联附件并写入 Audit。

候选复制同时使用源 ETag 条件和目标 `If-None-Match: *`。发布后不再写这个 key；旧上传 URL 只能作用于暂存对象。两个完成请求竞争时，只有一个候选被采用，其他请求返回同一附件。

图片与 PDF 额外检查文件标识；其他类型按声明的 MIME 和完整字节校验下载。本模板不做通用文档解析或恶意内容扫描，上传 HTML 也不会被当作可信应用页面执行。

## 3. 重试与失败

创建上传资源使用 Idempotency-Key，记录稳定 upload_id。短期 URL 每次重新授权后生成，截止时间不超过上传会话。网络失败可重试同一资源；过期或被拒绝时明确提示重新上传，并使用新资源。

大小/类型不匹配不会发布；撤权、认证会话过期或源文档消失也会阻止最终提交。审计失败时 ready 状态与附件关联一起回滚，之后仍可重试完成。

每个候选在 I/O 前就有持久记录。复制超时可能已经在远端成功，失败候选和暂存位置不会被遗忘；后续清理章节会处理过期、拒绝与删除对象。不能把一次 Delete 或 SDK timeout 当作“再也不会出现晚到对象”的证明。

## 4. 短期下载与 Markdown 引用

只有仍关联可见文档的 ready 附件可以取得新下载链接。Reader 可下载，Editor 可上传；撤权后不能继续申请链接，已经签发的链接在到期前仍可能有效，已接受的传输也可能继续。这是此直下载模式的明确权限边界。

默认下载使用 attachment disposition、no-store 和安全文件名编码。Web 将下载内容校对长度后保存为二进制文件；临时 Blob URL 随后释放。

Markdown 保存的是 `attachment:<附件 ID>`，不会保存预签名 URL 或永久公开地址。[Markdown 附件渲染](../../packages/views/src/knowledge/attachment-markdown.tsx)验证引用格式，再按当前文档与成员向 API 请求访问能力。只有通过检查的常见位图支持 inline 预览；其他附件用下载动作，任意外链图片仍不会自动加载。

## 5. 从本地配置到自己的部署

本地 `.env.example` 提供仅用于开发的 RustFS 凭据。关键配置为：

- `S3_ENDPOINT`：API/Worker 使用的内部 S3 根地址；不设置时文件能力关闭，文本与认证继续工作。
- `S3_PUBLIC_ENDPOINT`：浏览器可访问的独立 S3 origin；生产使用 HTTPS，不挂在会改写路径的子目录。
- `S3_BUCKET / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY`：专用 bucket 与显式服务端凭据。
- `FILE_MAX_BYTES / UPLOAD_SESSION_SECS / DOWNLOAD_URL_SECS`：实际上传与签名边界。

```bash
just bootstrap-storage
```

初始化命令像 `just dev` 一样加载 `.env.example` / `.env` 及进程环境，使用应用配置管理专用 bucket 的 CORS。RustFS 数据和日志命名卷需允许 UID/GID 10001 写入；`/health/ready` 用于就绪判断。`Ctrl+C` 停止 API/Web，数据卷保留。

## 6. 验证同一条路径

```bash
node scripts/test-storage.mjs
node scripts/test-backend.mjs --test attachments
pnpm exec vitest run apps/web/src/attachments.test.tsx
just check
```

存储测试连接真实 RustFS，覆盖期限与签名头、错误校验和、字节读取、源/目标复制条件与并发初始化。HTTP 测试连接真实数据库和存储，覆盖暂存不可见、唯一发布、重放、期限、大小/类型、审计回滚、Reader/Editor、跨文档引用，以及复制期间撤权/会话过期/源资源消失。

View 测试使用真实页面、WebCrypto 和 HTTP 边界，验证上传进度、失败后复用资源、大小限制、只读、引用插入和安全图片 URL。关键旅程完成后运行一次：

```bash
node scripts/e2e.mjs tests/e2e/attachments.spec.ts
```

浏览器上传真实图片，下载后比对字节，再保存附件引用并刷新预览。默认反馈循环不重复运行浏览器旅程。

[所有权清单](../../examples/knowledge-base/manifest.json)将附件关联、业务路由、Views、Web 接线与教程归到知识库示例；Core Files、S3 adapter、通用配置与隔离测试运行器会保留，供自己的业务复用。
