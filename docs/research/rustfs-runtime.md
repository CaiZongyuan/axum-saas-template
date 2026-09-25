# RustFS 运行配置：T09 实施查证

查证日期：2026-09-26。范围为 **RustFS 1.0.0 + `aws-sdk-s3` 1.149.0** 的启动、SDK、bucket 初始化与超时；上传状态机见[既有协议查证](rustfs-upload-protocol.md)。以下「源码结论」来自固定版本官方源码；配置片段是实施建议，**未编译片段、下载容器镜像、启动服务或运行本项目兼容性测试**。

## 1. 镜像启动与健康检查

**源码结论：**1.0.0 的 Dockerfile 使用 `/entrypoint.sh`，默认 `CMD ["rustfs"]`；entrypoint 补入 `/usr/bin/rustfs` 和数据目录，二进制兼容 `rustfs /data` 与 `rustfs server /data`。无需套用其他对象存储产品的启动参数。[Dockerfile][dockerfile]、[entrypoint][entrypoint]、[CLI][cli]

本地开发 Compose 可从以下配置开始；固定 digest 已在[协议查证](rustfs-upload-protocol.md#1-可固定的版本)核对。凭据由本项目配置提供，下面没有真实 secret：

```yaml
services:
  rustfs:
    image: rustfs/rustfs:1.0.0@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff
    command: ['rustfs', '/data']
    environment:
      RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:?set RUSTFS_ACCESS_KEY}
      RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:?set RUSTFS_SECRET_KEY}
      RUSTFS_VOLUMES: /data
      RUSTFS_ADDRESS: 0.0.0.0:9000
      RUSTFS_REGION: us-east-1
      RUSTFS_CONSOLE_ENABLE: 'false'
    ports:
      - '127.0.0.1:9000:9000'
    volumes:
      - rustfs-data:/data
      - rustfs-logs:/logs
    healthcheck:
      test:
        [
          'CMD',
          'curl',
          '--fail',
          '--silent',
          '--head',
          'http://127.0.0.1:9000/health/ready',
        ]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 30s
volumes:
  rustfs-data:
  rustfs-logs:
```

| 项目           | 固定版本源码结论与配置含义                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 凭据           | `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`，或分别使用 `_FILE`；同一凭据不能同时设置直接值和文件。空值、不可读文件会失败；未配置仅警告并允许退回内置默认。因此示例用 Compose 必填插值主动拒绝缺失凭据。[entrypoint][entrypoint]                                                                                                                                         |
| 数据、日志权限 | 镜像以 `rustfs` 用户运行，UID/GID 均为 **10001**；镜像创建 `/data`、`/logs`，owner 为 `10001:10001`，权限 `0750`。默认日志目录 `/logs`。已有 volume 或 bind mount 必须允许该身份写入；entrypoint 不会递归修复既有目录 owner，设置 `RUSTFS_UID` 也不会切换进程用户。新命名卷的实际 owner 仍应在本项目首次启动时验证。[Dockerfile][dockerfile]、[entrypoint][entrypoint] |
| 网络、region   | S3 默认 `:9000`，region 默认 `us-east-1`；console 默认启用且监听 `:9001`。上面显式关闭 console；需要时另外启用并限制管理端口访问。未设置 `RUSTFS_SERVER_DOMAINS` 时应使用 path style。[默认值][app-config]、[CLI][cli]                                                                                                                                                 |
| Liveness       | `GET` / `HEAD /health`；依赖未 ready 时仍可成功，不能据此启动 bucket bootstrap。[health handler 与测试][health]                                                                                                                                                                                                                                                        |
| Readiness      | `GET` / `HEAD /health/ready`；依赖满足时 `200`，不可服务时 `503`，覆盖 storage、IAM、锁等状态。端点公开且默认启用；`RUSTFS_HEALTH_ENDPOINT_ENABLE=false` 会禁用这两个原生路径。就绪缓存默认 1000 ms，所以它不是每次请求成功的保证。[health][health]、[配置][health-config]、[公开路由][health-routes]                                                                  |

建议 bootstrap 等待 readiness 后，再用配置的凭据执行 S3 操作；HTTP 健康检查不验证应用凭据或目标 bucket 权限。无需为此启用 console 或全局 `RUSTFS_CORS_ALLOWED_ORIGINS=*`。

## 2. 直接构造 SDK client

**源码结论：**SDK 的 `Config::builder()` 能直接接收 `Credentials`、`Region`、endpoint 与 path-style 设置。`Credentials` 实现的 provider 立即返回已有值；此构造路径没有调用 `aws-config` 的默认凭据发现链，因此不需要 IMDS。`BehaviorVersion` 必须设置；1.149.0 发布包所锁定的 runtime 中，`latest()` 为 `v2026_01_12()`。[SDK builder][sdk-config]、[静态 provider][credentials]、[behavior version][behavior]

以下示例保留 SDK 的 checksum 默认策略，并把请求预算作为应用配置传入。使用 `aws-sdk-s3 = "=1.149.0"` 的默认 Cargo features，包含 Tokio runtime 和默认 HTTPS client；无需额外依赖 `aws-config` 或 `aws-credential-types`。SDK crate 已重新导出所用类型。[features][sdk-cargo]、[导出与配置][sdk-config]

```rust
use std::time::Duration;
use aws_sdk_s3::{
    Client, Config,
    config::{
        BehaviorVersion, Credentials, Region,
        RequestChecksumCalculation, ResponseChecksumValidation,
        retry::RetryConfig, timeout::TimeoutConfig,
    },
};

fn s3_client(
    endpoint: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    operation_budget: Duration,
) -> Client {
    Client::from_conf(
        Config::builder()
            .behavior_version(BehaviorVersion::v2026_01_12())
            .credentials_provider(Credentials::new(
                access_key, secret_key, None, None, "application-config",
            ))
            .region(Region::new(region.to_owned()))
            .endpoint_url(endpoint)
            .force_path_style(true)
            .request_checksum_calculation(RequestChecksumCalculation::WhenSupported)
            .response_checksum_validation(ResponseChecksumValidation::WhenSupported)
            .retry_config(RetryConfig::standard().with_max_attempts(1))
            .timeout_config(
                TimeoutConfig::builder()
                    .connect_timeout(Duration::from_secs(3))
                    .operation_timeout(operation_budget)
                    .build(),
            )
            .build(),
    )
}
```

**建议而非上游要求：**示例关闭 SDK 自动重试，让调用方明确处理 Copy 的不确定结果；以后可按操作选择重试边界。`v2026_01_12` 自身会默认启用 AWS client 重试和 3.1 秒 connect timeout，所以不要假定「没有显式配置就是没有重试」。`operation_timeout` 包括操作的重试时间，`read_timeout` 则是请求开始到响应首字节的预算；都不能证明远端写入已取消。[behavior][behavior]、[timeout 类型][sdk-timeout]

创建两个长期复用的 client：内部操作用 `http://rustfs:9000`，浏览器 presign 用可访问的 `http://localhost:9000` 或生产 `https://s3.example.com`，其余设置一致；禁止签名后改 hostname/path。所锁定 `aws-smithy-http-client` 1.4.2 的 rustls connector 使用 `https_or_http()`，默认传输可接受本地 HTTP，不需要为了 HTTP 关闭证书校验。RustFS 自身测试选择了显式 `build_http()`，那是可选传输构造。[connector][http-client]、[RustFS 测试 client][upstream-client]。默认 behavior 支持代理环境变量；容器内地址需要合适的 `NO_PROXY` 配置。[behavior][behavior]

## 3. Bucket bootstrap 与 checksum/CORS

**建议的初始化顺序：**仅对本应用拥有的专用私有 bucket 执行；不把管理操作放进每次业务请求。

1. 调用 `client.head_bucket().bucket(bucket).send().await`。成功则继续；只有确认 `404` 才尝试创建，不能把 `403`、签名失败或超时视为不存在。
2. 缺失时调用 `client.create_bucket().bucket(bucket).send().await`。本例使用 `us-east-1`，不设置 `CreateBucketConfiguration`，与 RustFS 上游测试相同。并发初始化时，接受成功或类型化 `is_bucket_already_owned_by_you()`，随后重新 HEAD；不要吞掉 `BucketAlreadyExists`。RustFS 1.0.0 对 owner 重复创建返回成功，对非 owner 返回 `BucketAlreadyExists`。[上游创建测试][upstream-client]、[创建逻辑][create-bucket]、[SDK 错误类型][sdk-create]
3. 用 `CorsRule::builder()` / `CorsConfiguration::builder()` 构造规则（两个 `.build()` 均返回 `Result`），经 `client.put_bucket_cors().bucket(bucket).cors_configuration(cors).send().await` 写入，并以 `get_bucket_cors()` 核对。它替换 bucket 的整份 CORS 配置，应只管理专用 bucket。[SDK CORS 类型][sdk-cors-rule]、[configuration][sdk-cors-config]、[PutBucketCors][sdk-cors]

沿用[既有协议的 bucket CORS](rustfs-upload-protocol.md#用-bucket-cors-保持-s3-通用配置)：精确应用 Origin，方法 `PUT/GET/HEAD`，允许 `content-type` 与实际签名元数据 header；只在协议使用时加入 `if-none-match`。如需读取 ETag 或 Content-Disposition，加入对应 expose headers。RustFS 对请求 header 仅支持精确匹配或整个 `*`，不支持把 `x-amz-*` 当作前缀通配符。[RustFS CORS][cors-source]

| 请求方式                                              | 1.149.0 的实际 checksum 行为                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 普通 SDK `put_object().send()`                        | 默认 `WhenSupported`，未指定 checksum 时计算 **CRC32**，可能使用 aws-chunked/trailer；需在真实 RustFS 上覆盖该传输组合。[PUT 生成代码][sdk-put]、[checksum interceptor][sdk-checksum]                                                                                                                                                            |
| `put_object().presigned(...)`，未传 checksum          | 明确跳过自动 checksum 计算和默认 algorithm header，并禁用 aws-chunked；SDK 上游测试断言没有 `x-amz-sdk-checksum-algorithm` / `x-amz-checksum-crc32`。无需因为 SDK 默认 CRC32 就让浏览器自动加这两个 header。[checksum interceptor][sdk-checksum]、[签名测试][sdk-presign]                                                                        |
| 显式 `.checksum_sha256(base64_digest).presigned(...)` | 保留并签名调用方提供的 checksum 值；浏览器返回该 header，CORS 允许 `x-amz-checksum-sha256`。仅设置值不会自动补 algorithm header；若应用显式设置 `.checksum_algorithm(...)`，则也必须交付并允许 `x-amz-sdk-checksum-algorithm`。不能只设置 algorithm 而假定 presign 会计算浏览器尚未发送的 body。[PUT 生成代码][sdk-put]、[签名测试][sdk-presign] |
| `WhenRequired` 替代策略                               | 可显式关闭普通 PUT 的可选自动 checksum；它不是“禁止所有 checksum”，也不移除调用方显式提供的值。`PutBucketCors` 被标为 checksum required，仍计算默认 CRC32。不要把该策略当作绕过 bootstrap checksum 兼容测试的开关。[PUT][sdk-put]、[PutBucketCors][sdk-cors]、[interceptor][sdk-checksum]                                                        |

`ResponseChecksumValidation` 默认也是 `WhenSupported`；普通 GET 可自动请求并验证响应 checksum，presigned GET 不自动增加 checksum mode。验证流式 GET 时仍应完整读取响应 body，不能只检查收到响应头。[GET 生成代码][sdk-get]、[response checksum][sdk-response-checksum]。本次没有发现必须关闭 checksum 才能使用 RustFS 的证据。

## 4. 大小、超时与后续清理边界

| 控制                                    | 已证实的范围；不能据此推导的保证                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RustFS 单次上传大小                     | `MAX_SINGLE_PUT_OBJECT_SIZE` 固定 **5 GiB**，超出声明长度返回 `EntityTooLarge`；不是本项目 20 MiB 业务限制，也不是上传总时长。[大小常量][body-limits]、[PUT 检查][put-source]                                                                                                                                                        |
| `RUSTFS_HTTP_REQUEST_BODY_READ_TIMEOUT` | 默认 **300 秒**，`0` 禁用；每个 body chunk 重置计时，仅限制等待下一块数据的停顿。持续发送数据的上传可超过 300 秒，不能作为总上传期限。[HTTP 配置][http-timeouts]、[PUT timeout wrapper][put-source]                                                                                                                                  |
| `RUSTFS_HTTP1_HEADER_READ_TIMEOUT`      | 默认 **75 秒**，也用于 TLS handshake；没有给完整上传或 Copy commit 设置总期限。[HTTP 配置][http-timeouts]、[listener 接线][http-server]                                                                                                                                                                                              |
| RustFS 专有签名大小参数                 | `x-rustfs-max-content-length` 可约束单请求 decoded bytes；它不限制总时间，且既有规范要求通用 S3 Port，本项目不应据此增加专有依赖。[专有参数文档][size-doc]                                                                                                                                                                           |
| Caddy 入口限制                          | 官方文档提供 `request_body { max_size 20971520 }`，超过读取大小返回 413；全局 `servers { timeouts { read_body … } }` 可限制客户端上传读取，默认没有 body timeout。这是可配置的入口防护，仍须在实际版本、HTTP 协议、代理链与直连入口上验证；不能约束已进入 RustFS 的后台提交。[body 文档][caddy-body]、[timeout 文档][caddy-timeouts] |
| 客户端超时、连接取消                    | SDK 操作超时只终止调用方等待。RustFS Copy 显式使用独立 commit owner；PUT 的 eager path 在取消后有清理机制，但不是所有写路径统一的发布截止时间。[Copy][copy-source]、[PUT][put-source]、[SDK timeout][sdk-timeout]                                                                                                                    |

**结论：本次没有找到可证明「最晚 URL 到期 + 固定秒数之后绝无晚到对象」的端到端保证。**入口大小和 body deadline 可缩小在途窗口，但还需验证存储提交与取消的交互。后续清理不能仅依据 presign 过期、一次 Delete 或 SDK timeout 就永久遗忘 key；保留终态清理记录和重复检查的要求沿用既有协议，本文不规定未经验证的安全等待常数。

## 5. 实施时补足的运行证据

以下是待执行的 conformance 检查，不是本次已通过的结果：

- 固定镜像首次启动及重启：以默认非 root 身份写入命名卷，验证 `/health/ready`，创建 bucket 后重复 bootstrap，确认对象持久化；错误凭据应使 bootstrap 失败。
- 固定 SDK 做普通 PUT 与 presigned 浏览器 PUT，分别验证默认 checksum 传输、真实字节、HEAD 和完整 GET；bootstrap 的 PutBucketCors 也走默认 checksum。显式 SHA-256 时测试正确摘要、错误 body、缺失或改写签名 header。
- 浏览器通过公开 endpoint 完成 OPTIONS、PUT、GET，核对返回的实际 headers；未知 Origin/header 被拒绝。原始 `File`/`Blob` 直传，禁止手动设置浏览器控制的 Content-Length。继续执行[既有上传协议的并发与不可变性测试](rustfs-upload-protocol.md#6-落地时尚需验证)。
- 清理票增加慢速分块上传、停顿上传、超过 20 MiB、在到期前开始但到期后结束、代理断开以及 Copy 超时场景；观察第一次删除之后是否出现对象。只有这些部署路径的证据才能支撑缩短清理记录保留期。

[dockerfile]: https://github.com/rustfs/rustfs/blob/1.0.0/Dockerfile#L110
[entrypoint]: https://github.com/rustfs/rustfs/blob/1.0.0/entrypoint.sh
[cli]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/config/cli.rs#L1419
[app-config]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/config/src/constants/app.rs
[health]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/admin/handlers/health.rs
[health-config]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/config/src/constants/health.rs
[health-routes]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/admin/route_policy.rs#L150
[sdk-config]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/config.rs
[credentials]: https://docs.rs/aws-credential-types/1.3.0/src/aws_credential_types/provider/credentials.rs.html#106
[behavior]: https://docs.rs/aws-smithy-runtime-api/1.17.0/src/aws_smithy_runtime_api/client/behavior_version.rs.html#38
[sdk-cargo]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/Cargo.toml
[sdk-timeout]: https://docs.rs/aws-smithy-types/1.8.0/src/aws_smithy_types/timeout.rs.html
[http-client]: https://docs.rs/aws-smithy-http-client/1.4.2/src/aws_smithy_http_client/client/tls/rustls_provider.rs.html#311
[upstream-client]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/e2e_test/src/common.rs#L211
[create-bucket]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/bucket_usecase.rs#L1136
[sdk-create]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/create_bucket.rs#L363
[sdk-cors-rule]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/types/_cors_rule.rs
[sdk-cors-config]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/types/_cors_configuration.rs
[sdk-cors]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/put_bucket_cors.rs#L138
[cors-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/storage/ecfs_extend.rs#L867
[sdk-put]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/put_object.rs#L139
[sdk-checksum]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/http_request_checksum.rs#L168
[sdk-presign]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/tests/presigning.rs
[sdk-get]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/operation/get_object.rs#L153
[sdk-response-checksum]: https://github.com/awslabs/aws-sdk-rust/blob/dd4d62780ee72db9adae16134e5dac47a9b6393e/sdk/s3/src/http_response_checksum.rs
[body-limits]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/config/src/constants/body_limits.rs#L67
[http-timeouts]: https://github.com/rustfs/rustfs/blob/1.0.0/crates/config/src/constants/tls.rs#L130
[http-server]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/server/http.rs#L1517
[put-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/put.rs
[size-doc]: https://github.com/rustfs/rustfs/blob/1.0.0/docs/operations/presigned-size-limits.md
[caddy-body]: https://caddyserver.com/docs/caddyfile/directives/request_body
[caddy-timeouts]: https://caddyserver.com/docs/caddyfile/options#timeouts
[copy-source]: https://github.com/rustfs/rustfs/blob/1.0.0/rustfs/src/app/object/copy.rs#L482
