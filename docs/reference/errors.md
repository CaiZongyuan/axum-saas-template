# 公开错误与排查

先用 HTTP 状态选择恢复动作，再用稳定 `error.code` 判断分支。错误结构由 [ApiErrorResponse](site:reference/api.md#schema-ApiErrorResponse)和 [ApiError](site:reference/api.md#schema-ApiError)生成；业务不要维护另一套 DTO。`error.message` 是公开说明，不是客户端分支键。当前 `public_error` 的 `details` 为空，不能假定包含数据库异常或表单字段。

## 请求关联

Core [request_context](../../crates/app/src/http.rs)为每个请求生成新 `RequestId`，返回 `x-request-id`；错误 JSON 的 `error.request_id` 使用相同值。不会直接信任客户端传入的 request id。对错误记录方法、路由、状态、稳定码和 request_id，再在 日志与追踪中定位；不要记录 Cookie、Authorization、请求正文或签名 URL。

在运行本地 API 后观察一个安全的失败请求：

```sh
curl -i http://127.0.0.1:18000/api/v1/does-not-exist
```

结果应为 `404`、`http.not_found`，带 `x-request-id` 和匹配的 JSON request_id。如果收到 HTML 或代理错误，先检查代理目标和路径；该响应尚未经过 Core 错误边界。

## HTTP 与认证

| 状态      | 稳定码 / 来源                                                                                                                                                  | 恢复动作                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 400       | [`http.invalid_json`](../../crates/app/src/http.rs)、[`http.invalid_query`](../../crates/app/src/http.rs)、[`http.invalid_path`](../../crates/app/src/http.rs) | 修正 JSON、query 或路径类型；不要原样重试                         |
| 404 / 405 | [`http.not_found`](../../crates/app/src/http.rs)、[`http.method_not_allowed`](../../crates/app/src/http.rs)                                                    | 检查 API 组装、路径和 HTTP 方法，对照当前 OpenAPI                 |
| 408 / 413 | [`http.body_timeout`](../../crates/app/src/http.rs)、[`http.payload_too_large`](../../crates/app/src/http.rs)                                                  | 检查上传速度或减少请求体；文件走 Files 协议，不扩大普通 JSON 预算 |
| 401       | [`auth.unauthorized`](../../crates/app/src/modules/identity/mod.rs)、[`auth.invalid_credentials`](../../crates/app/src/modules/identity/mod.rs)                | 重新登录或使用有效凭据；Bearer 不会退回 Cookie                    |
| 403       | [`auth.origin`](../../crates/app/src/modules/identity/mod.rs)、[`auth.csrf`](../../crates/app/src/modules/identity/mod.rs)                                     | 核对 APP_ORIGIN；刷新 Session，使用当前 csrf_token 发起 mutation  |
| 403       | [`api_keys.scope_forbidden`](../../crates/app/src/modules/api_keys/authentication.rs)                                                                          | 申请需要的 scope；资源访问仍由业务规则检查                        |
| 409       | [`auth.email_exists`](../../crates/app/src/modules/identity/mod.rs)                                                                                            | 使用现有账号或选择其他注册邮箱                                    |
| 429       | [`rate_limit.exceeded`](../../crates/app/src/http.rs)                                                                                                          | 遵循 `Retry-After`，有界退避；不要持续并发重试                    |
| 503       | [`database.unavailable`](../../crates/app/src/lib.rs)、[`auth.unavailable`](../../crates/app/src/modules/identity/mod.rs)                                      | 检查数据库、迁移与连接预算；保留 request_id 供排查，有界重试      |
| 503       | [`auth.session_unavailable`](../../crates/app/src/modules/identity/mod.rs)                                                                                     | 账号事务可能已提交但 Session 创建失败；改用登录，不重复注册       |

## Files 与任务

| 状态      | 稳定码 / 来源                                                                                                                            | 恢复动作                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 400 / 413 | [`files.invalid_input`](../../crates/app/src/modules/files/mod.rs)、[`files.too_large`](../../crates/app/src/modules/files/mod.rs)       | 修正文件名、媒体类型、字节数或 SHA-256；限制来自生成配置     |
| 404 / 410 | [`files.not_found`](../../crates/app/src/modules/files/mod.rs)、[`files.upload_expired`](../../crates/app/src/modules/files/mod.rs)      | 前者核对业务归属；后者创建新上传会话                         |
| 409       | [`files.upload_missing`](../../crates/app/src/modules/files/mod.rs)、[`files.upload_changed`](../../crates/app/src/modules/files/mod.rs) | 先上传实际字节；内容变化时重新核验完成流程                   |
| 422       | [`files.upload_rejected`](../../crates/app/src/modules/files/mod.rs)                                                                     | 创建新上传会话并重新计算大小/摘要                            |
| 503       | [`files.unavailable`](../../crates/app/src/modules/files/mod.rs)                                                                         | 核对 API 与 Worker 存储配置、bucket 和对象服务；只做有界重试 |

任务错误不是一张 HTTP 状态表。Handler 返回 [JobError](../../crates/app/src/modules/jobs/mod.rs)：`Permanent` 结束当前批次，`Transient` 按预算重试，`LostLease` 停止发布。Job 详情与尝试记录提供 last_error；恢复指南说明何时由管理员开始新批次。排查时同时保留 job_id、correlation_id 与最初 request_id。

## 自己的业务错误

Domain 先定义自己的失败类型，HTTP 边界通过 [`public_error`](../../crates/app/src/http.rs)映射到状态和带业务前缀的稳定码。事务内部失败必须回滚；幂等键内容冲突与旧版本写入应返回 `409`，不得静默覆盖或以成功响应掩盖失败。每个分支写至少一个公开失败行为检查，见 [测试反馈循环](../testing/t01-feedback-loop.md)。

服务启动前的 `ConfigError` 不会产生 HTTP 响应；按错误指向的变量检查 [配置来源](configuration-sources.md)。API 就绪失败时先验证迁移，Worker 不领取时先核对 kind 注册与运行状态，再检查租约和任务预算。

<!-- example:knowledge:reference:start -->

参考业务的 [日志与追踪指南](../tutorials/19-observability.md)和 [任务恢复指南](../tutorials/11-job-recovery.md)提供完整请求/任务排查流程；移除知识库后保留 Core 错误参考和公共源码入口。
<!-- example:knowledge:reference:end -->
