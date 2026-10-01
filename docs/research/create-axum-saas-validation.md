# create-axum-saas 验收记录

日期：2026-10-02。需求：[GitHub #122](https://github.com/CaiZongyuan/axum-saas-template/issues/122)。用户明确选择直接实现，跳过额外体验预览。

## 源码与产物

基点 `83f1f71bd166af8b604dd50124abc85242b82177`。实现位于 `feat/create-axum-saas-122`；提交之前用不可变树快照 `767089303cbc7a38dd7370c46995bcd12d0c0215` 完成两轴审查。快照不是分支提交，覆盖本票所有已暂存的实现、测试和双语文档；本记录随后补入。

本地 npm 包：`.scratch/create-package/create-axum-saas-0.1.0.tgz`，SHA-256：

```text
9b08d808a8463358f9d457d87508b6e3dfbda4fdac592e57fc0c50dfe549b402
```

包包含发布入口、许可证、默认源码快照和重建后的 Core 源码快照；不包含工作树的 `.git`、秘密、安装目录、数据卷或构建产物。初次 npm 发布前通过本地 tarball 执行实际 `npx`，不将本地成功描述为 npm 已发布。

## 验证结果

- `just check` 通过：Rust 格式、clippy、整个 workspace 的 HTTP/真实依赖测试，工具测试、类型、合同与模块边界、前端测试、性能预算、Web/Desktop 与文档构建。
- 前端 247 项通过，4 项按既有合同跳过；34 个文件通过、1 个文件跳过。首次默认并发启动 35 个 worker 出现 17 个超时/等待失败；限制并发后失败减少，两个失败文件单 worker 通过，最终默认最多 4 worker 的完整 suite 与 `just check` 均通过。没有增加重试或放宽业务断言。
- 当前文档检查投影 121 个文件，构建检查 120 页、121 个内部目标；双语创建指南与变量来源已更新。
- 初始 Web gzip 216.2 KiB，5 个异步 chunk，预算通过；未调整性能基线。
- CLI 产物测试验证改名、无历史、许可证保留、尚未启动副本的端口互斥、现有目录拒绝、Core 完整剥离，以及包含源标识的项目名/仓库名。模拟 Docker 对所有 TCP 端口的发布，验证即使宿主无监听也不会分配这些端口。

`pnpm scaffold:smoke` 对上述真实 npm 包创建默认应用与 `--no-examples` 应用。两套 `pnpm install --frozen-lockfile` 与 `just dev` 同时运行，真实 PostgreSQL/Redis/RustFS/Mailpit 与宿主 API/Worker/Web 完成以下行为：

1. 通过 `agent-browser` 在各自独立浏览器注册同一邮箱、退出并重新登录；各数据库首个账号均为 Owner。
2. 两个改名应用都创建 API Key，并通过 Bearer 读取 profile，HTTP 200。
3. 第一份存储中的 marker 能取回；第二份存储返回 404。第一份密码恢复邮件由真实 Worker 送入自己的 Mailpit，第二份保持零邮件。
4. 容器、网络、数据卷与端口分离；另一 API 占用端口时启动给出监听者与 PID，未继续迁移。
5. 错误 PostgreSQL 密码使迁移输出真实 `password authentication failed` 原因。
6. Core 副本全部 Rust target 编译、类型、边界、73 个工具测试与 17 个文档投影文件通过。它位于模板仓库内部但没有自己的 Git 历史，生成的源码链接使用 `main`，没有继承父仓库 SHA。
7. 48 字符品牌名称在 1440px 和 390px 窄屏导航中实际测量不溢出。认证旅程不保留截图、trace、动作参数或密钥。

临时栈、卷与浏览器会话在验收后清理；未触及原有开发栈。脱敏摘要保存在 `.scratch/create-package/smoke-report.json`。

## 简化与审查

简化检查覆盖基点以来本票所有变更及生成副本的消费者。复用示例所有权清单、删除实现与教学所有权，按源码标记移除边界检查中的示例部分；用 pnpm 的实际 workspace 列表清理安装产物，替代固定目录清单。保留 Core/参考业务分界、事务、认证与启动防护。

Standards 首轮发现创建目录与 `cd` 不一致，随后发现父仓库版本误认；均已修复。Spec 首轮发现 API Key 固定长度、重复替换用户输入、分配时遗漏 Docker 发布端口；HTTP/CLI 失败已复现并修复。最终两轴对上述不可变快照均无待修复问题。元数据和换行调整后刷新了相关格式、文档、构建、预算和打包浏览器检查。

## 发布边界

当前 npm 未认证，`npm whoami` 返回 `ENEEDAUTH`；`create-axum-saas` 尚未注册。公开 `npx create-axum-saas` 的验收需要完成 npm 登录/双因素认证，并发布已审查的 tarball。此步骤完成前保持 #122 开放，不将 PR 或本地包当作公开发布。

本次实际运行环境为 Linux，未验证 macOS/Windows。可选完整观测栈及 Electron GUI 没有重复跑浏览器长测；其共享构建/类型/协议检查与本票变更相关的端口检查已覆盖。

## 干净 CI 修复

PR #124 的首轮 CI 通过 backend、frontend、documentation、teaching-backend 与 desktop-smoke；tooling 在 Core 快照的离线依赖重解析处失败。本地缓存没有揭示该问题。

Core 打包现改为通过 YAML API 从 importer 中删除已不再声明的依赖，同时保留自动安装的 peer dependencies，再使用 `pnpm install --frozen-lockfile`。输出确认 `resolution step is skipped`，保留已锁定版本和供应链检查。安装错误不再由 `--silent` 隐藏。定向四项真实产物测试与 lint 刷新通过；最终 CI 结果以 PR checks 为准。

第二轮 CI 完成 Core 打包和其余三项产物测试，发现残留标识检查依赖未安装的 `rg`。改用 Node 文件 API 遍历全部文本产物及路径，保留相同的旧标识断言，不为检查引入额外系统工具。

## 合并后 CI 修复

`f202c60` 的主 CI 在桌面知识库预览测试失败：页面标题与 Markdown 的一级标题同名，正文渲染较快时全页 heading 查询产生 strict-mode 重复匹配。断言改为在公开的“正文” region 内查找标题和正文 marker，不改变应用行为或增加重试。实际 Electron 冒烟四项通过。

nightly 在安装 k6 时失败：下载使用 `/tmp/k6.tgz`，checksum 清单要求 `k6-v2.3.0-linux-amd64.tar.gz`。workflow 统一通过 `K6_ARCHIVE` 命名下载、校验和解压。直接运行该安装片段，下载 SHA-256 校验通过，解压后的二进制报告 k6 v2.3.0。
