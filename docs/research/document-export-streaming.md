# T10 文档导出：有界 ZIP 与对象流

查证日期：2026-09-26。依据 spec §8.5、§11，以及现有 `crates/platform/src/object_storage.rs`。以下 API 已对照官方 crate 文档/发布包源码；片段用于展示 API 组合，**未编译、未跑测试或 E2E**。建议由 T10 实施者结合公开测试接口验证。

## 推荐路径与版本

采用顺序的 **S3 GET → 私有临时文件 → `spawn_blocking` 写临时 ZIP → S3 条件 PUT → 有效租约提交 DB**。每阶段消费流或文件，不把全部附件或完整 ZIP 放进 `Vec<u8>`。现有 `ObjectStorage::read() -> Vec<u8>` 适合 T09 的受限校验，导出应增加落盘读/从文件写的能力；ZIP 路径与快照解释留在 Knowledge，SDK 留在 Platform。

| 依赖 | 已核对结论 |
| --- | --- |
| `zip = { version = "=8.6.0", default-features = false }` | crates.io 当前稳定版为 8.6.0，9.0.0-pre3 是预发行；8.6.0 要求 Rust 1.88，项目 1.96 满足。[版本][zip-registry] [清单][zip-cargo] |
| `CompressionMethod::Stored` | 不压缩，仍产生正规 ZIP；不需要 deflate、zstd、加密等默认特性。`ZipWriter<W>` 要求 `Write + Seek`，可用普通文件；内部保存每个条目的元数据，因此必须限制文件数量与名字长度。[压缩方法][zip-compression] [writer 源码][zip-write] |
| `tempfile = "=3.27.0"` | 当前稳定版，MSRV 1.63；具备私有权限配置、`TempDir` 和显式 `close()`。[版本][temp-registry] [Builder][temp-builder] |
| `aws-sdk-s3 = "=1.149.0"` | 现有 `rt-tokio` 特性提供文件 `ByteStream`。本仓库实际锁定的 `aws-smithy-types` 为 1.8.1，Tokio 为 1.53.1。新增 Tokio 文件 API 时显式启用 `fs` / `io-util`，不要只依赖传递特性。[ByteStream][byte-stream] |

建议起始预算（工程取值，非上游限制）：每份导出最多 100 个附件、正文加附件 256 MiB、最终 ZIP 272 MiB、总执行预算 120 秒、同时执行 1 个导出。原附件 20 MiB 单文件上限继续适用；**生成产物上限应有明确独立配置**，避免把附件上传上限意外套到整个 ZIP。文件数、每个名称长度、正文大小、单文件大小、总输入大小、ZIP 输出大小、并发数均须有界。

## 1. 异步 GET 落盘

先根据 DB 快照中的 File ID 验证当前 File 仍为 ready，再由 Core 解析受管理的 bucket/key；不接受用户 URL 或任意路径，不向业务/浏览器暴露存储凭据。顺序下载到临时目录下由程序生成的文件名。核对响应长度只是预检，**仍按实际消费字节计数并增量 SHA-256**，必须与快照的 size/hash 一致；缺失、截断、超长、hash 不符都不能继续生成“成功”导出。

已核对的 SDK 调用组合：

```rust
// 片段：client、location、target、expected_size、deadline 由受控流程提供。
use tokio::io::AsyncWriteExt;

let mut object = client.get_object()
    .bucket(&location.bucket)
    .key(&location.key)
    .send().await?;
let mut target = tokio::fs::File::create(target).await?;
let mut received = 0_u64;
while let Some(chunk) = object.body.try_next().await? {
    received = received.checked_add(chunk.len() as u64)
        .ok_or_else(|| std::io::Error::other("export size overflow"))?;
    if received > expected_size {
        return Err(std::io::Error::other("export attachment too large").into());
    }
    // 在这里检查共享取消标志/绝对 deadline，更新 SHA-256 和总量预算。
    target.write_all(&chunk).await?;
}
target.flush().await?;
// received 必须等于 expected_size，hash 必须匹配，随后关闭 writer。
```

`ByteStream::try_next()` 逐块返回 `Bytes`；无需 `collect()`。如果需要自有固定读缓冲，可用 `into_async_read()` 配合 `AsyncReadExt::read(&mut [u8; 64 * 1024])`；SDK/HTTP 层仍可能保留当前 chunk，不能声称整个进程内存精确只有 64 KiB。[ByteStream][byte-stream] 这里的有界内存是一个活动对象流、固定应用缓冲和受限条目元数据，而非附件总量的内存副本。

**必须把整个 GET 消费循环纳入 `timeout_at`，不只包 `send()`。** AWS 明确说明 operation/attempt timeout 不覆盖 SDK 返回后消费的 ByteStream；已有 adapter 的 20 秒 operation timeout 因此不是下载总时限。[AWS 超时][aws-timeouts] 所有阶段共享同一个绝对 deadline，不能每个附件重新获得完整 120 秒。

Tokio 文件写入返回时后台写可能未完成，交给同步 ZIP 读取前必须 `flush().await` 并关闭写句柄。Tokio 官方文档明确指出这一差异。[Tokio fs][tokio-fs] 不在持有数据库行锁的事务内下载。

## 2. 阻塞 ZIP 与真正的输出上限

下载结束后，把临时目录所有权、受限附件清单、正文、取消标志和并发 permit 一并 move 进 `spawn_blocking`。该 closure 只做本地普通文件 I/O，不做 DB 或 S3 操作。建议整体 ZIP 工作只用一个阻塞任务，避免每个小块都创建阻塞任务。

已核对的同步 ZIP API：

```rust
use std::io::{Read, Write};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

// capped_file 是项目实现的 Write + Seek 包装器，底层为 std::fs::File。
let mut zip = ZipWriter::new(capped_file);
let options = SimpleFileOptions::default()
    .compression_method(CompressionMethod::Stored);
zip.start_file("document.md", options)?;
zip.write_all(markdown.as_bytes())?;

let mut buffer = [0_u8; 64 * 1024];
for entry in entries {
    zip.start_file(entry.zip_path, options)?;
    let mut input = std::fs::File::open(entry.local_path)?;
    loop {
        // 每块读取/写入前检查 deadline 与取消标志，并验证输入实际长度。
        let read = input.read(&mut buffer)?;
        if read == 0 { break; }
        zip.write_all(&buffer[..read])?;
    }
}
let mut output = zip.finish()?; // 必须显式检查 finish，中央目录也可能写失败。
output.flush()?;
```

`start_file`、`finish`、`SimpleFileOptions`、Stored 均已在 8.6.0 源码核对；`finish()` 写中央目录，Drop 也尝试收尾，但不能用 Drop 隐藏失败。[ZipWriter][zip-api] [源码][zip-write]

`capped_file` 是需要实现的小型保护层，**不是 zip crate 内置类型**：每次 Write/Seek 都检查取消、deadline 和 checked arithmetic；按写入后的文件位置/最大 extent 限制输出，覆盖 ZIP 头、正文、中央目录。Seek 回去重写 ZIP 头是正常行为，不能把所有 Write 次数累加当作最终文件长度。限制 Seek 到 `[0, output_limit]`，超限立即返回固定安全错误；结束后再核对 metadata 长度。只在 ZIP 完成后检查长度会允许磁盘先被写满，不足以落实预算。

不要在可 Seek 的 ZIP 输出上直接用“顺序 hash writer”计算最终 SHA-256：ZIP 头回写会令这种 hash 与最终字节不同。`finish` 后对最终文件再做一次有界顺序读取计算 SHA-256，随后本地文件保持只读、不修改。正文替换也应限制最终大小，不能因路径展开突破正文预算。

**路径规则由服务端构造。** 推荐 `document.md` 和 `attachments/<file-id>/<safe-basename>`；basename 拒绝/清洗 `/`、`\`、控制字符、`.`/`..`、Windows 盘符/保留名，限制 UTF-8 字节数，空名称给固定回退名；稳定 File ID 隔离同名附件。Markdown 中 `attachment:<uuid>` 只替换为快照清单中的对应相对链接，并对 Markdown/URL 特殊字符正确编码。`start_file_from_path()` 会归一化 `.`/`..` 并忽略越界部分，**这是规范化，不是拒绝非法用户输入的验证器**。[路径 API][zip-path] 最简做法可完全用 UUID 加安全扩展名作为 ZIP 名称，从而避免大量平台文件名规则。

## 3. 从 ZIP 文件条件 PUT

对象写入前，先在短事务创建输出 File/candidate 和唯一 candidate key，提交后才开始 PUT；每个租约执行有自己的候选对象。下面 API 中 `if_none_match("*")` 强制不存在时才创建，UUID 本身不等于禁止覆盖。已有 1.149.0 SDK 直接支持该条件，412 表示目标已存在，409 表示竞争；RustFS 实际行为仍应通过本项目 adapter conformance 验证。[PutObject 条件][put-api]

```rust
use aws_sdk_s3::primitives::ByteStream;

let body = ByteStream::read_from()
    .path(&artifact.zip_path)
    .buffer_size(64 * 1024)
    .build().await?;
client.put_object()
    .bucket(&candidate.bucket)
    .key(&candidate.key)
    .if_none_match("*")
    .content_type("application/zip")
    .content_encoding("identity")
    .checksum_sha256(&artifact.sha256_base64)
    .body(body)
    .send().await?;
```

`ByteStream::from_path(&path).await` 也是有效简写；`read_from().buffer_size()` 可以显式控制读取缓冲。基于 path 的流可重新打开文件重试，文件必须在所有尝试期间保留且字节不变；`read_from().file(tokio_file)` 是不可重试流，可用于避免 path 重开，但无需为 v1 引入第二条上传路径。[ByteStream][byte-stream] [FsBuilder][fs-builder]

保留现有单次 SDK 调用策略，让 Job 负责有预算的重试。PUT 超时/断线不证明对象不存在，不能直接遗忘 candidate 或无条件覆盖同 key；采用下一次独立 candidate 并把前次留给清理最容易解释。上传成功后仍须以有效 lease_token、当前权限和源文档可见性为条件，在 DB 事务内收纳一个 candidate、提交 Export/Job/Audit（T10/T11 按各自验收范围）；租约过期或事务失败的候选对象保持可追踪。前端只在发布成功后拿受限下载链接。

## 4. 取消、进程退出与临时文件

Tokio 官方明确：**已经开始的 `spawn_blocking` 不能通过 `JoinHandle::abort()` 停止。** `timeout`/丢弃 JoinHandle 也不会停止它；runtime shutdown 默认等待，`shutdown_timeout` 只是停止等待，线程仍可能运行。[spawn_blocking][blocking] 因此不能宣称 120 秒 deadline 可以强杀任意本地文件系统 syscall。

可实施的 v1 边界：

1. 用 `Arc<AtomicBool>` 或现有取消 token 协作取消；ZIP 每个 64 KiB 块、每次输出 Write/Seek、收尾前均检查。deadline 到达或续租失败后设标志，绝不进入后续 PUT/DB 发布。
2. 阻塞 closure 持有临时目录与 semaphore permit，直到它真正退出；协调层持有并最终 join 任务。避免 timeout 返回后释放 permit，随后堆积仍在运行的旧 ZIP 线程。
3. 有限停机等待之后由进程管理器终止进程，依赖 Job 租约恢复。阻塞 closure 只有本地副作用，旧结果没有有效租约无法发布。若以后要求严格杀死超时计算，使用子进程；单靠线程 API 做不到。

`TempDir`/`NamedTempFile` 依赖 Drop，SIGKILL 或不执行析构的退出会留下文件；不要把自动 Drop 写成崩溃清理保证。[tempfile 清理][temp-docs] `TempDir` 默认权限受 umask 影响，通常是 0755，**不会自动私有**。Unix 使用 `Builder::permissions(Permissions::from_mode(0o700)).tempdir_in(export_temp_root)`；root 也应仅服务身份可访问。命名临时文件默认 0600。[Builder 权限][temp-builder]

不需要把临时目录做成业务持久化卷或备份：导出输入快照/Job 在 DB，产物在 RustFS，丢失本地文件可重做。不调用 `TempDir::keep()`。正常完成/失败时关闭所有句柄，再 `TempDir::close()`，其错误可观察；不只依赖吞错的 Drop。[TempDir][temp-dir]

单机首版可在 Worker 启动领取任务前清扫专用临时根目录，但必须确保该根目录不会被另一个活 Worker 共用；只有明确独占目录时才能删全部旧内容。若以后允许并行 Worker 进程，为每个进程实例隔离目录并提供有 ownership/锁证明的清理；mtime 过旧不证明文件无人使用，租约失效也不证明旧 blocking 线程停止。常驻运行遇到 `close()` 失败应保留路径并安排受限重扫/告警。普通操作系统 `/tmp` 定时清理不是本项目的完整承诺。[tempfile 临时目录风险][temp-docs]

预算还需覆盖磁盘：顺序先落全部输入再写 ZIP 的峰值约为输入上限 + 输出上限 + 少量元数据（以上建议约 528 MiB/并发任务）；不满足空间/写入失败应结束当前尝试并保留可恢复状态。本地临时文件和 RustFS candidate 是两种清理对象，后者仍需 T12 的持久清理记录、重扫和晚到写处理，不能用清理本地目录替代。

## 实施验证重点

建议聚焦真实适配器的多块读取/条件 PUT、实际 ZIP 内容与快照一致、文件名穿越/重名、实际字节超预算、finish 写失败、消费响应后超时、取消后不发布和目录/permit 生命周期；不需要为此次研究运行浏览器测试。当前建议中的 RustFS 条件 PUT 从文件传输尚未在本仓库验证。

[zip-registry]: https://crates.io/api/v1/crates/zip
[zip-cargo]: https://docs.rs/crate/zip/8.6.0/source/Cargo.toml
[zip-compression]: https://docs.rs/zip/8.6.0/zip/enum.CompressionMethod.html
[zip-write]: https://docs.rs/crate/zip/8.6.0/source/src/write.rs
[zip-api]: https://docs.rs/zip/8.6.0/zip/write/struct.ZipWriter.html
[zip-path]: https://docs.rs/zip/8.6.0/zip/write/struct.ZipWriter.html#method.start_file_from_path
[temp-registry]: https://crates.io/api/v1/crates/tempfile
[temp-docs]: https://docs.rs/tempfile/3.27.0/tempfile/
[temp-builder]: https://docs.rs/tempfile/3.27.0/tempfile/struct.Builder.html#method.permissions
[temp-dir]: https://docs.rs/tempfile/3.27.0/tempfile/struct.TempDir.html#method.close
[byte-stream]: https://docs.rs/aws-smithy-types/1.8.1/aws_smithy_types/byte_stream/struct.ByteStream.html
[fs-builder]: https://docs.rs/aws-smithy-types/1.8.1/aws_smithy_types/byte_stream/struct.FsBuilder.html
[put-api]: https://docs.rs/aws-sdk-s3/1.149.0/aws_sdk_s3/operation/put_object/builders/struct.PutObjectFluentBuilder.html#method.if_none_match
[aws-timeouts]: https://docs.aws.amazon.com/sdk-for-rust/latest/dg/timeouts.html
[tokio-fs]: https://docs.rs/tokio/1.53.1/tokio/fs/index.html
[blocking]: https://docs.rs/tokio/1.53.1/tokio/task/fn.spawn_blocking.html

## 补充：只改 Markdown 附件链接的 destination

补充查证日期：2026-09-26。当前稳定版是 **`pulldown-cmark 0.13.4`**、**`pulldown-cmark-to-cmark 22.0.1`**，两者 MSRV 均为 1.71.1；后者依赖 `pulldown-cmark = "0.13.0"`，与 0.13.4 兼容。[Parser 版本][pc-registry] [Serializer 清单][pcc-cargo]

**结论：公共 API 没有 destination-only source span，不能仅凭 offset iterator 和 `reference_definitions()` 保证原格式不变地定位所有合法写法。** `Parser::into_offset_iter()` 给 `(Event, Range<usize>)`，Link/Image 的范围是整个节点；`LinkDef { dest, title, span }` 的 span 是整条参考定义，包含标签、目标以及可选标题。`dest` 已执行 unescape，因此 `attachment&#58;…`、反斜杠转义等源码可能与解析后的值不同；目标字符串也可能同时出现在 label、title 或 label 内的代码里。`find(dest)`/范围内全局 `replace` 都没有正确性保证。真正扫描目标的 `scan_link_dest` 是 **`pub(crate)` 私有函数**。[offset 与 LinkDef 源码][pc-parse] [定义解析源码][pc-firstpass] [扫描器源码][pc-scanners]

参考定义可这样读取：先 `let defs = parser.reference_definitions().clone();`，再消费 `parser.into_offset_iter()`；`defs.get(id)` 按 Unicode case folding 查定义，`defs.iter()` 返回 `(label, &LinkDef)`。已解析的参考式/折叠式/快捷式 Link/Image 事件自身也已携带解析后的 `dest_url`，仅做语义改写时无需另外改定义。不要启用 broken-link callback 去“修复”普通未定义 `[text]`，否则会扩大改写范围。[Parser API][pc-parser] [Tag 字段][pc-tag]

**推荐 T10 的简单路径：只修改 Link/Image 事件，再序列化语义等价 Markdown，明确导出格式可能规范化。** 使用与应用支持语法一致的 Parser options（分别开启 tables、strikethrough、tasklists、所支持的 footnotes；不要 `Options::all()` 打开 smart punctuation/额外语法）。`ENABLE_GFM` 目前只涉及提示式 blockquote，不能当成一键开启全部 GFM。[Parser options][pc-options]

以下是已核对的 API 组合片段，`attachment_path` 表示项目自己的严格 `attachment:<UUID>` 校验与快照 File ID → 安全相对路径映射；未实施或编译：

```rust
use pulldown_cmark::{Event, LinkType, Parser, Tag};
use pulldown_cmark_to_cmark::{
    Options as RenderOptions, calculate_code_block_token_count,
    cmark_with_options, DEFAULT_CODE_BLOCK_TOKEN_COUNT,
};

let events: Vec<_> = Parser::new_ext(markdown, parser_options)
    .map(|mut event| {
        if let Event::Start(
            Tag::Link { link_type, dest_url, .. }
            | Tag::Image { link_type, dest_url, .. }
        ) = &mut event {
            if let Some(path) = attachment_path(dest_url.as_ref()) {
                *dest_url = path.into();
                *link_type = LinkType::Inline;
            }
        }
        event
    })
    .collect();
let options = RenderOptions {
    code_block_token_count: calculate_code_block_token_count(&events)
        .unwrap_or(DEFAULT_CODE_BLOCK_TOKEN_COUNT),
    ..Default::default()
};
cmark_with_options(events.iter(), &mut bounded_formatter, options)?;
```

把**已改写**目标的 `link_type` 设成 Inline 有两个作用：参考式链接直接变成 `[label](attachments/…)`，不用同步维护定义；`<attachment:UUID>` 自动链接转成显式链接且保留原显示文字。后一项不能遗漏：serializer 对 `LinkType::Autolink` 写 `<` + 原 Text + `>`，仅更新 `dest_url` 会被忽略。[Serializer Link 处理][pcc-source]

这段转换不改 `Event::Code`、code block 的 Text、普通 Text、HTML 事件或任何 title；其中出现的 `attachment:…` 保持文字语义。HTML `<a href>`/`<img src>` 不属于 Markdown Link/Image，保持原样。UUID 不在导出快照映射中时不要生成悬空相对路径；可保持原始目标并由产品约定说明，或明确失败，不能偷偷添加其他文件。

实际限制：

- `cmark_with_options` 接受 `Iterator<Item = Event 或 &Event>` 和 `fmt::Write`，返回 `Result<State, Error>`，内部会 finalize。可给受大小上限保护的 formatter，避免输出 String 不受控增长。收集事件占用与**受限 Markdown**相应的内存，不涉及附件/ZIP 二进制。[Serializer API][pcc-api]
- 它会调整空行、列表/强调符号、fence 长度、转义；参考定义可能移到文尾，未使用定义可能消失，不能声称字节一致。默认 fence 长度 4 不足以覆盖任意代码内容，应按上面官方辅助函数选择长度。[Options 与 fence 计算][pcc-source]
- `cmark_with_source_range` 的真实作用只是参考源码保留部分 Text 转义决策，底层仍是同一 serializer；它**不是无损 CST 编辑器**，不会保留原始空白/定义布局。[source-range 源码][pcc-ranges]
- 如果产品坚持“除 destination 外每个字节完全相同”，此路线不满足要求。需要额外的完整 destination 词法定位器并支持参考定义/转义/容器续行，或能公开目标 token span 的解析器；不要用“语义 parser + 正则替换”冒充完成。T10 教程导出没有要求逐字节格式保留，语义改写更容易教学与维护。

建议后续针对真正 destination、同值 label/title、内联/围栏代码、普通文本、参考/折叠/快捷链接、自动链接、实体转义、嵌套图片、长反引号代码内容做小型单元验证。本次研究未执行测试。

[pc-registry]: https://crates.io/api/v1/crates/pulldown-cmark
[pcc-cargo]: https://docs.rs/crate/pulldown-cmark-to-cmark/22.0.1/source/Cargo.toml
[pc-parser]: https://docs.rs/pulldown-cmark/0.13.4/pulldown_cmark/struct.Parser.html
[pc-parse]: https://docs.rs/crate/pulldown-cmark/0.13.4/source/src/parse.rs
[pc-firstpass]: https://docs.rs/crate/pulldown-cmark/0.13.4/source/src/firstpass.rs
[pc-scanners]: https://docs.rs/crate/pulldown-cmark/0.13.4/source/src/scanners.rs
[pc-tag]: https://docs.rs/pulldown-cmark/0.13.4/pulldown_cmark/enum.Tag.html
[pc-options]: https://docs.rs/pulldown-cmark/0.13.4/pulldown_cmark/struct.Options.html
[pcc-api]: https://docs.rs/pulldown-cmark-to-cmark/22.0.1/pulldown_cmark_to_cmark/fn.cmark_with_options.html
[pcc-source]: https://docs.rs/crate/pulldown-cmark-to-cmark/22.0.1/source/src/lib.rs
[pcc-ranges]: https://docs.rs/crate/pulldown-cmark-to-cmark/22.0.1/source/src/source_range.rs
