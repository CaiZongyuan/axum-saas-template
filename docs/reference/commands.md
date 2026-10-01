# 命令索引

先安装 [后端开发环境](../getting-started/quickstart.md)中的工具链。`just --list` 查看当前 recipe；下表与发布版本的 [justfile](../../justfile)及 [package.json](../../package.json)保持一致。

## 选择验证入口

开发自己的后端时，优先运行对应 Rust HTTP/任务测试，再运行合同和文档检查。`just e2e-docs` 验证静态文档网站的导航、搜索和部署路径，不启动应用服务；`just desktop-smoke` 验证 Electron 应用壳，适用于桌面接入改动。文档编辑本身不要求 Electron 测试。

`just check` 是完整仓库门禁，涉及真实服务、前端、性能合同和文档构建。`just check-full` 在其后运行真实应用浏览器旅程。性能负载和 Desktop Soak 属于独立报告任务，见 性能指南。

## 持久数据与恢复

`just dev` 会启动本地依赖、执行迁移并初始化存储，退出时保留数据；`services-down` 和 `db-down` 停止容器。`production-migrate` 会修改部署数据库 schema；`production-up` 包含显式迁移步骤。备份、恢复和维护窗口的前提见 [生产部署](../tutorials/21-single-machine-production.md)与 [备份恢复](../tutorials/22-backup-restore.md)，执行前确认 `ENV_FILE` 和归档路径属于目标环境。

<!-- generated:task-runner -->

<!-- example:knowledge:reference:start -->

知识库参考业务的 [性能指南](../tutorials/24-perf-gates.md)解释其确定性预算；移除示例时对应阅读入口随之移除。
<!-- example:knowledge:reference:end -->
