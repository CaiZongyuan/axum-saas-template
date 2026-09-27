# 跟做：在 Electron 桌面壳中复用同一套页面

本章回答“桌面端从哪里来”。桌面壳不是第二套业务：它把浏览器访问的同源 Web 入口装进 Electron 窗口，业务页面、API 合同和会话 Cookie 全部来自共享代码。没有离线编辑，也没有另一套登录协议。

## 1. 启动组合并打开桌面壳

```bash
just dev
just desktop
```

`just dev` 照常启动 PostgreSQL/RustFS/Redis、API 与 Web；`just desktop` 在 Electron 窗口中加载同一个 Web 入口（默认 http://127.0.0.1:5173，可用 `.env` 的 `SAAS_DESKTOP_ORIGIN` 或 `WEB_PORT` 调整）。在壳中注册、登录、打开“我的文档”并预览 Markdown，行为与浏览器完全一致：页面由同一份 [Web 路由](../../apps/web/src/router.tsx)渲染，请求由同一份生成 SDK 发出。

会话 Cookie 保存在壳的独立持久分区 `persist:saas-desktop` 中，与系统浏览器互不影响；重启壳后登录仍然有效。退出登录会撤销服务端 Session，壳与浏览器中的对应会话同时失效。

## 2. 壳只做平台接线，不做业务

壳的实现只有三个部分：[主进程](../../apps/desktop/src/main.ts)、[preload 桥](../../apps/desktop/src/preload.ts)和一份本地错误页。窗口创建时固定 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，并禁用 `<webview>`。渲染进程接触不到 Node，也接触不到 Session secret——它只是加载同源页面，Cookie 留在 Chromium 的网络栈里，从不进入 IPC。

导航约束在壳层强制：

- 只允许加载应用同源地址；页面里指向外部站点的链接不会把窗口带走，而是通过系统浏览器打开（仅接受 http/https，其他 scheme 直接忽略）。
- `window.open`/`target="_blank"` 弹窗一律拒绝；外链仍走系统浏览器。
- 网站权限请求（摄像头、通知等）默认全部拒绝。
- 证书错误按 Chromium 默认策略拒绝，壳不做任何放行。

preload 通过 [IPC 合同](../../apps/desktop/src/ipc-contract.ts) 只暴露四个能力：读取壳版本/平台、重试加载、打开下载目录，以及订阅下载状态事件。每个载荷在两侧都经过合同校验，格式不对的事件直接丢弃；外链转交系统浏览器的 http/https-only 策略同样是合同的一部分。合同没有秘密字段，也没有文件内容——文件由主进程写盘，不经 IPC 传输。

## 3. 受控的深链与下载入口

深链形如 `saas://open/<应用内路径>`。主进程解析后要求：协议必须是 `saas:`、主机必须是 `open`，路径必须是本应用同源绝对路径（绝对 URL、协议相对路径、反斜杠绕过、原始空白字符都会被拒绝）。合法深链让已存在的窗口聚焦并导航到该页面，例如把 `saas://open/notifications` 发给运行中的壳，窗口会聚焦并打开通知页。无效深链被静默忽略，不导航也不记录目标内容。壳使用单实例锁：第二次启动只聚焦已有窗口并处理深链，不会开第二个窗口。

下载入口监听分区的 `will-download` 事件：只有应用同源页面发起的下载被接受，保存到系统下载目录的 `SaasTemplate` 子目录（可用 `SAAS_DESKTOP_DOWNLOADS_DIR` 覆盖），同名文件自动追加序号，不覆盖已有文件。共享页面中的附件/导出下载正是通过页面内 blob 触发这条路径；跨源页面发起的下载会被直接取消。下载进度与结果通过合同事件通知页面，文件名经过清洗，永远只是一个安全的文件名。

壳的窗口在主文档加载失败时切换到本地错误页，点击“重新连接”回到失败前的应用地址。渲染进程崩溃同样回到错误页，不会留下白窗口。关闭最后一个窗口即退出应用；协议注册失败不影响开发使用（深链仍可通过第二实例参数送达）。

## 4. 测试与 CI 分工

- [IPC 合同测试](../../apps/desktop/src/ipc-contract.test.ts)（Vitest）：校验桥形状、深链路径归一化、文件名清洗与下载事件校验，无需启动 GUI，进入默认 `just check`。
- 壳级 GUI smoke：`just desktop-smoke` 启动真实栈（PostgreSQL/RustFS/Redis/Mailpit/API/Web），用 Playwright 驱动真实 Electron：启动、登录/退出、知识库文档浏览与 Markdown 预览、应用页下载落盘与跨源下载拒绝、外链转交系统浏览器、深链合法/非法目标、断网错误页与重试恢复。业务角色矩阵不在这里重复，沿用后端与共享 View 测试。
- CI 把 GUI smoke 放在独立的 `desktop-smoke` job（无显示环境由 `xvfb-run` 提供 X server）；默认主门禁只包含壳的类型、构建与合同检查。

## 5. 运行本章检查

```bash
pnpm exec vitest run apps/desktop
just desktop-smoke
just check
```

重点是无 secret 的 IPC 合同、同源导航约束、深链拒绝外部目标、下载只来自应用页面且不覆盖文件，以及错误页可恢复。壳依赖 Electron 与桌面环境，属于可选运行时：默认开发与 `just check` 不要求安装桌面工具链之外的组件。

打包分发（安装包、自动更新、多平台签名）不在模板 v1 范围内；`pnpm --filter @saas/desktop build` 产出的 `dist/main.cjs` 可直接交给任何标准 Electron 打包流程。
