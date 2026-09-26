# 快速开始

Core 提供邮箱密码注册、登录/退出、成员管理、会话失效与真实服务状态查询，链路为 **Web → 生成 SDK → Axum → PostgreSQL**。

## 准备工具

使用仓库固定的 Rust 1.96.0、Node 24.18.0、pnpm 11.17.0、just 1.58.0，以及能运行 Linux 容器的 Docker / Compose。版本记录在 `rust-toolchain.toml`、`.node-version`、`package.json` 和 `.tool-versions`。

先取得本页对应的源码版本，在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
just dev
```

`just dev` 启动 Docker 中的 PostgreSQL/RustFS，显式运行迁移并初始化私有存储 bucket，再启动宿主机 API、Worker 与 Web。Web 支持 HMR；修改 Rust 源码会重新启动 API 和 Worker。没有 `.env` 时使用 `.env.example` 中的本地开发设置，需要调整时先复制为 `.env`。

打开[注册页面](http://127.0.0.1:5173/register)，填写邮箱、12–128 字符的密码及可选显示名，成功后自动进入已登录首页。首个成功注册的账号成为企业 Owner，后续账号为 Member。部署人员应先注册自己的 Owner 账号，再交给普通使用者；不需要邀请或等待邮件。

[服务状态页](http://127.0.0.1:5173/system)会显示“服务已就绪”“PostgreSQL 已连接”和当前迁移版本；迁移历史必须与当前源码匹配。

已有账号可以打开[登录页面](http://127.0.0.1:5173/login)。首页可退出登录，随后旧会话失效；详见[登录与会话教程](../tutorials/03-sessions.md)。

Owner/Admin 从首页“企业成员”管理角色和启用状态；最后一位有效 Owner 不能被停用或降级。详见[成员管理教程](../tutorials/08-members.md)。后台任务入口提供安全状态、尝试历史和失败任务的有限重试。

<!-- example:knowledge:quickstart:start -->

## 保存第一篇文档

登录后点击“我的文档”→“新建文档”，填写标题和 Markdown，再点击“保存文档”。普通成员也可以直接开始；个人库与 Editor 授权在首次保存时自动准备。刷新详情页后正文仍在，返回列表可以重新打开。

支持新建、安全预览、标题搜索、分页、访问隔离和可靠重试；支持[编辑与冲突处理](../tutorials/06-edit-conflicts.md)，并可[上传附件、下载与插入图片引用](../tutorials/09-attachments.md)。跟做步骤见[第一篇 Markdown 文档](../tutorials/04-personal-documents.md)和[搜索与预览](../tutorials/05-search-preview.md)。

Owner/Admin 可从首页“知识库”创建共享库、修改名称、授予或撤销 Reader/Editor；获授权成员在库内浏览与写作。参见[共享知识库与权限](../tutorials/07-library-grants.md)。

打开已保存文档，点击“导出当前文档”可生成正文与附件的 ZIP；页面展示进度并提供下载。参见[文档导出与后台任务](../tutorials/10-document-exports.md)。

有权编辑时可以确认删除文档或附件；管理员可删除整个库，后台任务负责对象清理。详见[删除与可靠清理](../tutorials/12-deletion-cleanup.md)。

导出完成或最终失败后，从首页“通知”查看结果，标记已读或打开导出详情。详见[导出通知与已读状态](../tutorials/13-export-notifications.md)。

Owner/Admin 可以从“审计记录”按文档 ID、动作和请求 ID 追溯实际操作，参见[管理员审计](../tutorials/14-audit-history.md)。

从“API Keys”创建只读文档凭据，可用脚本读取有权访问的文档；参见 [API Key 教程](../tutorials/15-api-keys.md)。

<!-- example:knowledge:quickstart:end -->

API 默认监听 `127.0.0.1:3000`：

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:3000/api/v1/system/status
```

每个响应都有 `x-request-id`。状态请求实际读取 PostgreSQL 的迁移记录，不是写死的前端展示数据。

## 观察一个失败场景

保持 `just dev` 运行，在另一个终端暂时停止开发数据库：

```bash
just db-down
```

再次点击服务状态页的“重新检查”。页面显示失败提示和请求编号；`/health/ready` 返回 `503`，`/health/live` 仍返回 `200`。

恢复数据库后重新检查即可：

```bash
docker compose up -d --wait postgres
```

`Ctrl+C` 停止开发 API/Worker/Web，数据库、RustFS 与数据卷保留。`just services-down` 停止两项依赖，不删除数据；`just db-down` 可单独停止数据库。

## 文档与下一步

```bash
just docs
```

本地文档入口为 [http://127.0.0.1:5174/axum-saas-template/](http://127.0.0.1:5174/axum-saas-template/)。在线站点和本地站点使用同一组 Markdown 源文件。

复制模板后，按[发布教程站点](publish-docs.md)启用自己的 GitHub Pages；后续合并到 `main` 时由 CI 检查并发布。

继续阅读[第一条全栈请求](../tutorials/01-full-stack-request.md)、[测试反馈循环](../testing/t01-feedback-loop.md)以及 [Core/示例边界](../architecture/module-boundaries.md)。完整后续范围记录在[架构规范](../saas-template-architecture-spec.md)。

## 常见问题

- **数据库能连接但 ready 仍失败**：运行 `just migrate`；API 不自动迁移，已应用的迁移集合、成功状态和 checksum 必须匹配当前源码。
- **端口已占用**：修改 `.env` 中的 `APP_BIND` / `VITE_API_PROXY`；更改数据库端口时同时调整 `POSTGRES_PORT` 与 `DATABASE_URL`，然后重启开发入口。
- **Rust 配置报错**：检查[生成的配置参考](site:reference/config.md)。错误不会打印数据库凭据。
- **浏览器请求失败**：用 request_id 对照 API 的 JSON 日志；页面通过 Vite 同源代理访问 API，数据库 URL 不进入浏览器。
