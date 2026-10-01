# 用 Electron 接入已有 Web 客户端

自己的后端 API 和 Web 页面完成后，可以让 Electron 加载同一套页面、生成 SDK 与 Session 协议。桌面壳只负责平台接线，不增加另一套业务或授权规则；它没有离线编辑能力。

前提是完成[快速开始](../getting-started/quickstart.md)、客户端能调用自己的后端，且机器具有 Electron 所需的桌面依赖与显示环境。以下命令在仓库根目录运行。

## 加载已有应用

在一个终端启动应用，另一个终端打开壳：

```bash
just dev
```

```bash
just desktop
```

默认 Web 地址是 `http://127.0.0.1:15400`，通过 `.env` 的 `SAAS_DESKTOP_ORIGIN` 或 `WEB_PORT` 调整。[主进程](../../apps/desktop/src/main.ts)加载这个同源入口；[Web Router](../../apps/web/src/router.tsx)和共享页面负责业务。先验证登录、自己的资源读取和一个写入请求，重启壳后再读同一资源。

Cookie 保存在独立持久分区 `persist:saas-desktop`，不与系统浏览器共享登录。退出登录撤销当前服务端 Session；只有使用同一 Session 的客户端会一起失效，另一个独立登录的浏览器 Session 不会因此被撤销。

## 保持 IPC 的能力边界

[preload](../../apps/desktop/src/preload.ts)与 [IPC 合同](../../apps/desktop/src/ipc-contract.ts)提供壳版本/平台、重试加载、下载目录、下载事件和语言/主题偏好。两端都校验载荷；业务对象、凭据、Session secret 和文件字节不通过 IPC。

窗口固定开启 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，禁用 webview。导航只允许应用同源，外部 http/https 链接交给系统浏览器；弹窗、网站权限请求与其他 scheme 被拒绝，证书错误不放行。增加本地平台能力时先定义窄的 IPC 类型与校验，而不是暴露任意 Node 调用。

[desktop-preferences.tsx](../../apps/web/src/desktop-preferences.tsx)只在壳中镜像语言和主题两个枚举，以便 `file://` 错误页延续偏好。它不承载账号或业务数据，浏览器中为空操作。

## 接入深链与下载

深链形如 `saas://open/notifications`；把 `/notifications` 换成自己的已注册绝对路径即可。解析器拒绝外部 URL、协议相对路径、反斜杠和原始空白；单实例锁把合法目标送到现有窗口。导航后仍由目标 API 重新鉴权，深链不是访问凭据。

应用同源页面发起的下载进入系统下载目录的 `SaasTemplate` 子目录，可通过 `SAAS_DESKTOP_DOWNLOADS_DIR` 覆盖。主进程清洗文件名，并对重名追加序号；跨源页面下载被取消。自己的 Files 客户端先经后端授权取得字节，再由页面触发下载，文件内容不进入 IPC。

## 失败与检查

断网或渲染进程崩溃会显示本地错误页；“重新连接”回到失败前的应用地址。错误页使用壳保存的语言与主题。实际检查应包含加载失败、重试、非法深链和跨源下载拒绝：

```bash
pnpm exec vitest run apps/desktop/src/ipc-contract.test.ts
pnpm --filter @saas/desktop build
just desktop-smoke
```

合同测试不需要 GUI。`desktop-smoke` 创建真实隔离应用栈，用 Playwright 驱动 Electron，检查会话、导航、下载与错误恢复；需要显示环境或 xvfb。自己的业务页面应补一条定向旅程，完整角色矩阵由后端测试承担。

纯后端或文档正文修改无需运行 Electron。只有修改平台接线或交付桌面旅程时选择这些检查。安装包、自动更新与平台签名尚未提供，构建出的 `dist/main.cjs` 需要另接 Electron 打包流程。

下一步：[应用壳贡献合同](27-add-example.md)；长期客户端资源观察使用独立的长测，而非文档检查。
