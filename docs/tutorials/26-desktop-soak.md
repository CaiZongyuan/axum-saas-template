# 验证可选桌面客户端的资源趋势

只有提供 Electron 客户端时才需要 Desktop Soak。后端文档、HTTP 合同和静态文档站点不依赖它。本指南观察真实桌面壳反复使用共享页面时的 RSS、JS 堆、DOM 节点和监听器；增长观察是报告材料，单次长测不能判定泄漏。

前提是[桌面壳](20-electron-shell.md)已能加载自己的 Web 页面、后端业务合同已验证，机器有 Docker、pnpm 和显示环境或 xvfb。命令在仓库根目录运行。

## 先验证采集链路

```bash
DESKTOP_SOAK_DURATION_SECS=25 just perf-desktop-soak
```

当前[运行器](../../scripts/perf/desktop-soak.mjs)创建隔离 PostgreSQL/Redis/RustFS/Mailpit、API/Web 与测试用户目录，通过公开 HTTP 播种知识库数据，再打开真实 Electron。结束删除自己的容器、卷和用户目录；不使用开发数据。

成功生成 `.scratch/perf/desktop-soak-report.json`，包括原始时间序列、聚合、增长观察、git SHA、desktop/Electron 版本和采样配置。短运行只证明接线和采集，不代表长期资源稳定。

## 把循环改为自己的页面

当前[采集场景](../../tests/desktop/soak.spec.ts)执行“列表 → 详情 → 附件刷新/下载/上传 → 删除本轮附件 → 打开并取消弹窗 → 采样 → 返回列表”。迁移到自己的业务时：

1. 用自己的公开 API 播种固定规模数据，通过真实页面登录和导航。
2. 选择最重且可重复的一屏作为采样点，例如详情、文件与任务面板均已加载之后。
3. 清理本轮新增数据，让每轮看到相同规模；否则资源增长可能来自数据集增长。
4. 保留真实下载、网络请求和组件生命周期，只改页面选择器与业务操作。
5. 在业务所有权清单登记场景/采集文件，避免移除业务后留下无效入口。

## 指标的边界

| 指标             | 来源                                                | 限制                                                             |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `rendererRssKiB` | 主进程 `app.getAppMetrics()` 的渲染进程 working set | 包含 Chromium/分配器行为，增长不等于 JS 泄漏                     |
| `heapKiB`        | `performance.memory.usedJSHeapSize`                 | GC 引起波动，缺失时记录 null                                     |
| `domNodes`       | 当前文档元素数量                                    | 必须在可比的页面状态采样                                         |
| `listeners`      | 包裹 EventTarget 的净注册数                         | 只统计 window/document/body/根容器等长命目标，不是全部监听器清册 |

监听器计数按目标、事件类型、捕获阶段和 listener 去重，处理 `once` 与 AbortSignal 的移除。初始化脚本只用于测量，不改变生产业务实现。

## 长跑、复跑与失败处理

```bash
DESKTOP_SOAK_DURATION_SECS=3600 just perf-desktop-soak
```

默认循环 300 秒，预热 `DESKTOP_SOAK_WARMUP_SECS=15`，采样 `DESKTOP_SOAK_SAMPLE_MS=2000`。`PERF_SCALE` 控制当前参考数据规模。预热让初始加载与懒加载先完成，避免把冷启动与稳态混为同一序列。

[报告整形](../../scripts/perf/desktop-report.mjs)比较首末四分位中位数，增长超过 25% 时记录 `growthNotes`，不改变退出码。重复同一版本与规模，区分轮内分配、GC 与跨轮积累；保留原始点和运行环境。页面断言或启动失败仍会让命令失败，应先修复真实失败，再解释曲线。

```bash
node --test tests/tooling/desktop-soak-report.test.mjs
```

这个确定性报告测试进入日常门禁。真实 GUI 冒烟与长测用于客户端里程碑和夜跑，长测不属于普通 PR 的 `just check`。知识库移除时当前场景与运行器随示例删除，原配方会指向已删除的脚本；通用报告整形保留。自己的业务需要重建运行器与采集场景，并更新配方后再运行长测。

下一步：[把自己的页面贡献给应用壳](27-add-example.md)。
