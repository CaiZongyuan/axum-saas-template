# 创建自己的 SaaS 项目

用 Dougong 的脚手架生成完成改名的项目副本，选择是否保留参考应用，并为同机开发分配独立端口。

## 1. 创建副本

准备 Node 24.18.0。运行应用还需要 Rust 1.96.0、pnpm 11.17.0、just 1.58.0 和 Docker Compose。

发布到 npm 后，创建入口是：

```bash
npx create-axum-saas my-app
```

省略目录参数时会询问项目名。目录末级名称需为小写字母开头的 kebab-case，最长 48 字符；已有目录会被拒绝，文件不会覆盖。默认保留知识库参考应用、便签示例与教学源码。

首次 npm 发布前，从模板仓库根目录构建并使用同一个真实包：

```bash
pnpm scaffold:pack
npx --yes --package ./.scratch/create-package/create-axum-saas-0.1.0.tgz create-axum-saas my-app
```

打包包含源码快照，创建过程不下载可变的 Git 分支，也不执行依赖安装。生成的副本不带 `.git`、本机秘密、数据卷或构建目录。

## 2. 启动并验证

```bash
cd my-app
pnpm install --frozen-lockfile
just dev
```

脚手架把探测可用的端口写入 `.env`。开发脚本从端口派生连接串、监听地址、代理和浏览器 origin，启动日志显示本副本的 Web、API、Worker 与 Mailpit 地址。打开 Web 的 `/register`，创建账号后退出，再从 `/login` 登录。首个账号为 Owner；密码需为 12–128 字符。

保持开发进程运行，在另一个终端从项目根目录验证：

```bash
project_api=$(node --input-type=module -e \
  'import { developmentEnv } from "./scripts/lib/process.mjs"; console.log(developmentEnv().APP_BIND)')
curl -i "http://$project_api/health/ready"
```

预期 HTTP 200，带 `x-request-id`。`Ctrl+C` 停止宿主进程；`just services-down` 停止依赖并保留卷。

## 3. 只保留 Core

```bash
npx create-axum-saas plain-app --no-examples
```

`--no-examples` 去掉全部参考业务与工单教学 fixture，以及示例增删工具、相关编译引用、专属迁移、测试与 CI job；合同和锁文件在打包时已重建。保留身份、企业成员、授权、审计、Jobs、文件、通知与其他共享能力。注册登录后进入通用首页，文档站保留最小双语开发入口和 Core API/配置参考。

项目名同时用于 npm scope、Rust crates、SQL schema、指标、cookie、浏览器存储键、Electron 桥与本地凭据。可用 `--repository owner/repo` 设置自己的仓库链接；未设置时生成 `your-org/<项目名>` 占位，发布文档前应改为真实仓库。许可证归属保持原样。

## 4. 同机多副本与失败恢复

创建两份不同目录的副本后，分别安装并运行 `just dev`。端口预留记录位于用户缓存目录的 `create-axum-saas/ports.json`，尚未启动的副本也不会被重复分配端口。记录只包含路径和端口，已删除目录的记录会在下次创建时清理。

开发入口按目录名称和完整路径派生 Compose namespace；同名目录位于不同父目录时也拥有不同容器、卷和网络。旧开发卷保留，不会自动接管。需要显式沿用旧 namespace 时可在进程环境设置 `COMPOSE_PROJECT_NAME`，并保持端口和凭据一致。

创建与启动之间端口仍可能被其他进程占用，因此每次启动都重新检查。遇到冲突会列出宿主监听的 PID 或 Docker 容器与项目名，提示停止占用者或修改 `.env` 中对应的 `*_PORT`。容器 healthy 但实际绑定缺失时，启动在迁移之前失败。迁移错误会保留 SQLx 的真实原因。

不要为端口冲突删除卷。下一步阅读[项目结构](../architecture/project-structure.md)，再[新增业务模块](../guides/develop-module.md)。已生成的 Core 副本可从 `crates/app/src/modules` 开始自己的业务。
