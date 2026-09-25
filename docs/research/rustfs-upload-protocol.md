# RustFS 附件上传协议：T09 实施查证

查证日期：2026-09-26。范围：[T09 / issue #10][ticket] 与[架构规范第 10 节](../saas-template-architecture-spec.md#10-文件与对象存储)。本文记录已查阅的官方源码、上游测试和注册表元数据；**没有下载容器镜像、启动 RustFS 或运行本项目的兼容性测试**。源码支持、上游测试存在，不等于本项目已通过验收。

建议以 **RustFS 1.0.0 + `aws-sdk-s3` 1.149.0** 开始实现。保持规范已经要求的「暂存直传 → 独立候选对象 → 验证候选 → 数据库唯一发布」流程；条件写入加强最终对象不可覆盖的保证，不能替代完成时重新鉴权与数据库竞争控制。

## 1. 可固定的版本

RustFS 官方最新稳定 release 为 **1.0.0**，2026-09-16 发布，`prerelease=false`；该 annotated tag 指向源码 commit `d47f54bfb2f39f48bd1adda334bd27e151fe85b8`。[release][release]、[tag 元数据][release-tag]

建议 Compose 固定：

```text
rustfs/rustfs:1.0.0@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff
```

这是 OCI 多架构 index digest，已同时由 Docker Hub tag API 与 Registry V2 manifest 的 `Docker-Content-Digest` 核对；其中 Linux amd64 manifest 为 `sha256:ba0a1b53e36f321c0d46f3867104abef169f7bc59c467c664ddac87e7ddc9a8b`，Linux arm64 为 `sha256:42edb61d588775f9431ff436216d14392d2234d4eb2ed68321569fbf7245b36b`。只读取了 manifest，没有读取 image layer。官方发布 workflow 明确将 `rustfs/rustfs` 作为 Docker Hub 发布仓库。[Hub 元数据][image-tag]、[Registry manifest][image-manifest]、[发布 workflow][image-workflow]

## 2. 已核实的操作与限制

| 能力 | 1.0.0 的证据及边界 |
| --- | --- |
| PUT、GET、HEAD、CopyObject、DeleteObject、ListObjectsV2 | 官方兼容矩阵声明这些常见操作有测试覆盖；矩阵自身注明它是 S3 的已测子集。本文进一步核对了 1.0.0 对应实现与测试，不从「S3-compatible」推导所有 S3 行为。[矩阵][matrix]、[固定版本测试清单][compat-tests] |
| SigV4 预签名 PUT / GET | 上游真实服务测试验证 GET 字节、PUT 后 HEAD 大小，以及过期 URL、伪造签名、改变对象路径、错误 secret 被拒绝；另有拒绝未签名 `x-amz-*` 上传属性的回归测试。[预签名测试][presigned-tests] |
| PUT `If-None-Match: *` | 上游跨节点并发测试使用此条件并要求唯一写入成功。对象提交代码在 namespace 写锁内再次检查 HTTP preconditions；通配符与现存 ETag 匹配，失败为 `PreconditionFailed`。[并发测试][conditional-race]、[提交检查][put-commit]、[条件匹配][etag-match] |
| CopyObject 的目标条件 | 请求的普通 `If-None-Match` 进入目标 `ObjectOptions`，复制后的实际写入继承条件；上游测试验证条件失败后目标字节不变。这与 `x-amz-copy-source-if-match` 是两个条件：后者约束读取的源 ETag。[请求条件][write-options]、[复制实现][copy-source]、[存储复制][copy-store]、[条件复制测试][conditional-copy] |
| HEAD 大小与元数据 | HEAD 的 `content_length` 来自对象 `get_actual_size()`，同时返回 Content-Type、ETag、用户元数据与可选 checksum。上游测试验证 PUT 后 HEAD 大小以及复制后的元数据和 GET 字节。[HEAD 实现][head-source]、[预签名测试][presigned-tests]、[复制元数据测试][copy-metadata] |
| 下载响应覆盖 | RustFS 1.0.0 锁定 `s3s` 0.16.0；该依赖的 GET handler 读取 `response-content-disposition` 等字段并覆盖实际响应头，且校验响应头值。[锁文件][rustfs-lock]、[GET 覆盖实现][s3s-get]、[GET 接线][s3s-get-wiring] |
| 无大小上限的普通 PUT | 1.0.0 拒绝缺少可确定长度的普通上传，并有单请求服务端上限；这不等于自动应用本项目的 20 MiB 限制。RustFS 另有签名 query `x-rustfs-max-content-length`，但它是明确的 RustFS 专有扩展，本项目规范要求 S3 通用 Port，因此不建议依赖它。[PUT 长度检查][put-size]、[专有大小限制][rustfs-size] |

**HEAD 的保证边界：**它返回存储系统记录的逻辑长度与元数据，不会证明字节的实际格式；Content-Type 是上传元数据，不是文件内容鉴定。检查必须针对最终候选对象，不能只 HEAD 可被重写的暂存对象。ETag 可用于源条件，不应作为通用 SHA-256 或 MIME 验证替代品。若实现承诺内容校验，应读取最终对象并计算明确算法，或验证已选定且实测过的存储 checksum 行为；本文没有验证所有加密、压缩、multipart 组合。[HEAD 实现][head-source]、[复制校验信息处理][copy-source]

## 3. 签名、CORS 与公开端点

### 签名请求必须连同 headers 交付

AWS SDK 1.149.0 的 PUT 与 CopyObject 均有类型化 `.if_none_match("*")`，序列化为真正的 `If-None-Match` header；CopyObject 另有 `.copy_source_if_match(etag)`。PUT 的 `.presigned(...)` 返回 method、URI 和 headers。SDK 测试明确检查 Content-Type / Content-Length 进入 `X-Amz-SignedHeaders`；RustFS 使用的 s3s 在缺失签名 header 时返回 `SignatureDoesNotMatch`，并把指定 headers、method、path、query 纳入签名验证。[SDK CopyObject][sdk-copy]、[SDK PUT 序列化][sdk-put-wire]、[SDK 签名测试][sdk-sign-tests]、[SDK 签名请求][sdk-presigning]、[s3s 签名验证][s3s-signature]

**条件 header 确实被签名，而非仅发送：**1.149.0 发布包的 lock 使用 `aws-runtime` 1.10.0 / `aws-sigv4` 1.6.0。runtime 传入序列化后的全部 headers，并沿用默认排除清单；签名器排除 Authorization、User-Agent、X-Ray trace、Transfer-Encoding，预签名再排除 `x-amz-user-agent` / `x-amz-checksum-mode`，**没有排除 `if-none-match` 或 `x-amz-checksum-sha256`**。因此 `.if_none_match("*").presigned(...)` 的条件进入 canonical headers 与 `X-Amz-SignedHeaders`；删除 header 被 s3s 拒绝，修改值或移除 signed-header 名称会改变 canonical request，原签名不再匹配。条件验证继续经过上述 RustFS 提交锁检查。这是完整源码链路的结论，尚未运行本项目该组合。[runtime 签名设置][sdk-runtime-settings]、[runtime 请求输入][sdk-runtime-sign]、[默认排除项][sdk-sign-settings]、[canonical headers][sdk-canonical]、[s3s 验证][s3s-signature]

**checksum 是另一层约束：**SDK 上游测试明确证明调用者提供的 checksum 被写入 `X-Amz-SignedHeaders`，普通 presign 不自动替用户决定上传内容。RustFS 在相同 PUT 存储路径用 `HashReader::add_checksum` 读取 checksum headers，读取结束时比较实际摘要；其上游真实服务测试验证错误 SHA-256 返回 `400 BadDigest` 且对象不存在。可以在申请上传时绑定浏览器计算的 Base64 SHA-256，再用 `.checksum_sha256(...)` 签入暂存 PUT；它保证收到的字节匹配声明摘要，不证明内容可信或类型正确。[SDK checksum 签名测试][sdk-checksum-sign]、[RustFS checksum 接线][checksum-wire]、[HashReader 校验][checksum-reader]、[SHA-256 拒绝测试][checksum-tests]

**建议：**上传响应返回 `{upload_id, url, method, headers, expires_at}`，浏览器原样提交可设置的必需 headers；签名 Content-Type 与服务端约定的上传标识元数据，不向浏览器发送 secret。浏览器直接 PUT `File`/`Blob`，不要包成 `FormData`。Fetch 标准把 Content-Length、Host、Origin 等列为 forbidden request headers，由浏览器控制；**默认浏览器协议不显式签入 Content-Length**，用完成阶段的实际长度核对。若以后签名 Content-Length，必须验证各浏览器实际生成的值，不能把 SDK 返回的此 header 直接交给 JavaScript 设置。[Fetch 标准][fetch-forbidden]

**暂存 PUT 不必要求 `If-None-Match: *`。**现有规范允许在 pending 会话内重传同一暂存 key；不可变性边界在最终对象。若以后选择暂存条件 PUT，必须在生成签名前设置该 header，并将其列入 CORS 和返回 headers，且为用户重传设计新 key；只给前端一个可删除的未签名 header 不构成约束。这个组合尚未在本项目真实 RustFS 上验证。

直接向最终 key 发放带已签名条件的 PUT 是技术上值得区分的替代协议，但被当前 issue / 规范明确要求的暂存、复制、候选验证流程排除；T09 不据此改变交付范围。

### 用 bucket CORS 保持 S3 通用配置

RustFS 1.0.0 支持 bucket 级 CORS：匹配 Origin、方法与请求 headers，返回 expose headers；**bucket 配置存在时具有优先权，即使没有匹配规则也不会回退到全局放行**。无 bucket CORS 时才回退 `RUSTFS_CORS_ALLOWED_ORIGINS`，变量未设置或为空不提供通用 CORS headers。[bucket CORS][cors-bucket]、[CORS 优先级][cors-layer]、[官方 CORS 文档][cors-doc]

建议通过标准 `PutBucketCors` 配置专用私有 bucket，例如：

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "if-none-match", "x-amz-meta-upload-id"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Disposition"],
    "MaxAgeSeconds": 300
  }]
}
```

这是实施示例，Origin 与 headers 必须从本项目最终协议生成；若签名 SHA-256，应允许 `x-amz-checksum-sha256`，如请求同时包含 `x-amz-sdk-checksum-algorithm` 也要精确列入。1.0.0 的实现对 AllowedHeaders 做精确匹配或完整 `*` 匹配，因此不要假定 `x-amz-*` 这样的部分通配符有效。预签名直传使用 `credentials: "omit"`，应用 Cookie 不需要发送到对象端点。CORS 只管浏览器跨源访问，不能替代存储鉴权。[bucket CORS 实现][cors-bucket]

### 内网客户端与公开签名客户端分开配置

官方 RustFS Caddy 指南要求 S3 位于独立 hostname 的根路径，使用 path-style；不要挂到 `/s3/` 后改写路径。示例 `reverse_proxy rustfs:9000` 保留公开 Host、method、URI，签名验证需要这些值。[官方 Caddy 指南][caddy-doc]、[s3s 签名验证][s3s-signature]

**建议：**服务端 Copy/HEAD/Delete 使用 `http://rustfs:9000`；专门用于 presign 的客户端配置 `https://s3.example.com`，两者同 region/credentials/bucket，均 `force_path_style(true)`。先以公开 endpoint 签名，不在签名后替换主机或添加前缀；presign 只构造请求，服务端无须通过公开域名传输对象。Caddy 代理到 HTTP 内网 upstream 时保持原 Host，不设置 `header_up Host rustfs:9000`。本地开发同理区分容器内 endpoint 与浏览器可访问的 `localhost` endpoint。[SDK 配置示例][rust-sdk-doc]、[SDK 签名请求][sdk-presigning]、[Caddy 指南][caddy-doc]

下载调用 `.get_object().response_content_disposition(...)` 后再 presign，默认 `attachment`，建议同时签入 `response-cache-control=no-store`；文件名由应用清洗和正确编码。不要把 response override 追加到已签名 URL。60 秒 TTL 限制新请求接受窗口，撤权只阻止新签发；已经接受的传输不应承诺在 60 秒时强制中断。[SDK GET][sdk-get]、[s3s GET][s3s-get]、[s3s 过期检查][s3s-signature]

## 4. SDK 选择

| 候选 | 已核实的适用性 |
| --- | --- |
| **`aws-sdk-s3` 1.149.0，推荐** | AWS 维护，2026-09-22 发布，crate MSRV 1.94.1，低于仓库当前 Rust 1.96.0；RustFS 官方 Rust 指南使用它，RustFS 1.0.0 自身测试锁定 1.146.1。新版本直接提供目标条件复制、源条件、presign、响应覆盖和 bucket CORS，适合较小的本项目 ObjectStorage adapter。[crate 元数据][sdk-crate]、[RustFS SDK 指南][rust-sdk-doc]、[锁文件][rustfs-lock]、[CopyObject builder][sdk-copy] |
| `object_store` 0.14.2，可选 | Apache 维护，2026-09-15 发布，MSRV 1.85。当前版本的 `signed_url_opts` 已能签 headers 和额外 query；`CopyMode::Create` 配合 `S3CopyIfNotExists::Header("If-None-Match", "*")` 可表达目标条件复制。但是 `CopyOptions` 未提供源 ETag 条件，S3 后端忽略其 extensions；它也不是 bucket 管理 SDK。可以满足一个经过取舍的 adapter，但本次没有完成 RustFS 运行兼容验证，不为减少依赖体积就宣称与 AWS SDK 等价。[crate 元数据][object-crate]、[签名接口][object-sign]、[复制实现][object-copy]、[CopyOptions][object-copy-options] |

建议固定 Cargo.lock，并在本仓库编译验证传递依赖的 MSRV；上述 SDK 比较没有测编译时间、内存或二进制体积。不需要手写 SigV4，也不要直接依赖 RustFS 内部 `rustfs-s3-client` 作为公共客户端合同。第三方 `rust-s3` / MinIO Rust SDK 的全部必要行为未在本次逐一查证。

## 5. 对 T09 与后续清理的具体建议

这些是根据既有规范与上述证据提出的实现建议，并非新架构决议。

1. **申请上传：**服务端生成暂存 key，数据库保存稳定 upload_id、声明大小/MIME、会话到期时间与业务关联。重试只为仍有效的 pending 会话重新签名，TTL 不超过会话剩余时间；重新检查编辑权。
2. **完成前：**重新鉴权、确认 Document 仍存在；在数据库先登记独占且永不复用的 candidate key。可先 HEAD 暂存对象取得 ETag，CopyObject 同时使用 `copy_source_if_match(etag)` 与 `if_none_match("*")`。复制发生在数据库事务外。源变化返回可恢复失败；目标条件失败时不能改为无条件覆盖。
3. **发布前：**HEAD 实际 candidate，核对存在性、实际长度、类型及协议约定的校验信息；最后在数据库事务中重新检查资源、权限、状态与到期时间，条件更新选出唯一 ready 附件并记录 Audit。重复完成返回已发布结果，竞争失败者的 candidate 保留清理记录。发布后任何路径都不再写入该 key；客户端永远只获得暂存 PUT。
4. **不确定结果：**Copy 超时可能已经成功；保留 candidate 记录并验证它，或用另一个已登记的新 candidate 尝试。不要把 HTTP 超时当成「对象一定不存在」，不要重写已经 ready 的 key。RustFS 复制代码明确允许提交任务在请求取消后继续。[复制提交代码][copy-source]
5. **清理与在途请求：**失败、过期、删除、未被采用的 candidate 都必须留下 bucket/key 与重试状态。清理者先通过数据库状态排除 ready 或仍可能发布的 candidate，再删除。不能在暂存 URL 尚有效时删掉对象就认为永久清理完成：同一 URL 可以再次 PUT；即使 URL 过期，也可能存在此前接受的在途写入。保留终态清理记录，结合「最晚签发 URL 到期 + 受控请求完成窗口」及后续重复扫描处理晚到对象。单次 Delete 后立刻遗忘 key 无法处理这种竞态。[预签名校验时点][s3s-signature]、[复制提交代码][copy-source]
6. **删除与导出：**后续删除票先取消数据库可见性并登记 Job，再删除最终/暂存/候选对象；已不存在视为幂等成功。使用未开启版本保留的专用 bucket 简化 v1；如果启用 versioning，清理还要定位版本，普通 Delete 不能被当作所有历史字节已释放。备份和导出只引用已发布不可变对象，清理不能删除仍被 ready 记录采用的 key。[既有规范](../saas-template-architecture-spec.md#103-一致性与清理)、[Delete 实现][delete-source]

## 6. 落地时尚需验证

以固定镜像和所选 SDK 做一次真实 adapter/Router 验证，覆盖：完整字节上传/复制/下载；同时完成只发布一个附件；ready 后重放暂存 PUT；同一目标的并发条件复制失败者不改变字节；HEAD/Copy 之间暂存变化；大小/类型不符；复制成功但响应或 DB 提交丢失；完成前撤权/会话过期。随后在 Caddy 公开 endpoint 做一次浏览器上传/下载与 CORS 拒绝测试，确认签名 headers、Content-Disposition、过期链接及非 ASCII 文件名。日常反馈以这些公开接口测试为主，不要求每次提交重跑完整浏览器旅程。

如采用签名条件或 checksum，还应断言 URL 的 `X-Amz-SignedHeaders` 含相应名称，并验证删除/改写 header、修改 signed-header 列表、重复条件 PUT、checksum 正确但 body 错误的请求均不能改变已有对象；正确请求仍能完成。这能把「AWS 签名器与 RustFS 各自实现支持」落实为所选版本组合的行为证据。

本次未运行以上测试，未证明签名 Content-Length 在本项目浏览器组合中的行为，也未证明部署的 body/commit 超时足以给清理设定某个固定安全等待值。T09 可以先完成对象与候选记录，后续可靠清理票必须验证在途 PUT/Copy 与删除竞争，不能仅测试静态孤立对象。

[ticket]: https://github.com/CaiZongyuan/axum-saas-template/issues/10
[release]: https://github.com/rustfs/rustfs/releases/tag/1.0.0
[release-tag]: https://api.github.com/repos/rustfs/rustfs/git/tags/3d945221863485f76884d6287a2f4bfe984cf650
[image-tag]: https://hub.docker.com/v2/repositories/rustfs/rustfs/tags/1.0.0
[image-manifest]: https://registry-1.docker.io/v2/rustfs/rustfs/manifests/1.0.0
[image-workflow]: https://github.com/rustfs/rustfs/blob/1.0.0/.github/workflows/docker.yml#L68
[matrix]: https://github.com/rustfs/docs.rustfs.com/blob/1757b36c9c68a927483574e31c9f6a6b018a6cb0/content/en/reference/s3-compatibility.md
[compat-tests]: https://github.com/rustfs/rustfs/blob/1.0.0/scripts/s3-tests/implemented_tests.txt
[presigned-tests]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/e2e_test/src/presigned_negative_test.rs
[conditional-race]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/e2e_test/src/cluster_concurrency_test.rs#L41
[put-commit]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/ecstore/src/set_disk/ops/object.rs#L4007
[etag-match]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/ecstore/src/set_disk/mod.rs#L7021
[write-options]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/storage/options.rs#L309
[copy-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/copy.rs
[copy-store]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/ecstore/src/store/object.rs#L4554
[conditional-copy]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/lifecycle_transition_api_test.rs#L597
[head-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/head.rs#L487
[copy-metadata]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/e2e_test/src/copy_object_metadata_test.rs
[rustfs-lock]: https://github.com/rustfs/rustfs/blob/1.0.0/Cargo.lock
[s3s-get]: https://github.com/Nugine/s3s/blob/4f83b149341ebdcd76dc4df76db3821033ae2d47/crates/s3s/src/ops/get_object.rs
[s3s-get-wiring]: https://github.com/Nugine/s3s/blob/4f83b149341ebdcd76dc4df76db3821033ae2d47/crates/s3s/src/ops/generated/get_object.rs#L173
[put-size]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/put.rs#L90
[rustfs-size]: https://github.com/rustfs/rustfs/blob/1.0.0/docs/operations/presigned-size-limits.md
[sdk-copy]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/copy_object/builders.rs#L836
[sdk-put-wire]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/protocol_serde/shape_put_object.rs#L454
[sdk-sign-tests]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/tests/presigning.rs#L114
[sdk-checksum-sign]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/tests/presigning.rs#L213
[sdk-runtime-settings]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/aws-runtime/src/auth.rs#L152
[sdk-runtime-sign]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/aws-runtime/src/auth/sigv4.rs#L235
[sdk-sign-settings]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/aws-sigv4/src/http_request/settings.rs#L112
[sdk-canonical]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/aws-sigv4/src/http_request/canonical_request.rs#L253
[checksum-wire]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/put.rs#L1802
[checksum-reader]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/rio/src/hash_reader.rs#L579
[checksum-tests]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/e2e_test/src/checksum_upload_test.rs#L165
[fetch-forbidden]: https://fetch.spec.whatwg.org/#forbidden-request-header
[sdk-presigning]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/presigning.rs
[sdk-get]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/get_object/builders.rs#L398
[s3s-signature]: https://github.com/Nugine/s3s/blob/4f83b149341ebdcd76dc4df76db3821033ae2d47/crates/s3s/src/ops/signature.rs
[cors-bucket]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/storage/ecfs_extend.rs#L867
[cors-layer]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/server/layer.rs#L2016
[cors-doc]: https://github.com/rustfs/docs.rustfs.com/blob/1757b36c9c68a927483574e31c9f6a6b018a6cb0/content/en/administration/cors/index.md
[caddy-doc]: https://github.com/rustfs/docs.rustfs.com/blob/1757b36c9c68a927483574e31c9f6a6b018a6cb0/content/en/developer/integration/reverse-proxy/caddy.md
[rust-sdk-doc]: https://github.com/rustfs/docs.rustfs.com/blob/1757b36c9c68a927483574e31c9f6a6b018a6cb0/content/en/developer/sdk/rust.md
[sdk-crate]: https://crates.io/api/v1/crates/aws-sdk-s3/1.149.0
[object-crate]: https://crates.io/api/v1/crates/object_store/0.14.2
[object-sign]: https://docs.rs/object_store/0.14.2/src/object_store/signer.rs.html
[object-copy]: https://docs.rs/object_store/0.14.2/src/object_store/aws/mod.rs.html
[object-copy-options]: https://docs.rs/object_store/0.14.2/object_store/struct.CopyOptions.html
[delete-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/delete.rs#L918
