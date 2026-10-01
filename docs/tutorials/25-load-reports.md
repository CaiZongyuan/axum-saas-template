# 为自己的业务编写负载与容量报告

确定性预算通过后，用受控负载栈观察真实请求的吞吐、延迟、错误、连接池、队列和进程内存。报告用于夜跑与版本发布时比较容量趋势；跨机器墙钟数字不作为普通 PR 门槛。

需要 Docker、Rust release 工具链、pnpm 依赖和 [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)。命令在仓库根目录运行；不连接现有开发或生产数据库。当前场景调用知识库参考 API，新增业务必须替换数据和请求，才能得到自己的容量证据。

## 先运行一个受控场景

```bash
PERF_VUS=2 PERF_DURATION=20 just perf-load
```

[运行器](../../scripts/perf/run-scenario.mjs)调用[受控栈](../../scripts/perf/stack.mjs)：独立 Compose 项目 `saas-perf`、动态空闲端口、项目级卷，宿主机运行 release API/Worker。结束时删除自己的卷；`PERF_STACK_KEEP=1` 可保留用于排错，并输出清理命令。项目名固定，所以同一工作环境不要并行运行两条负载命令。

成功时生成 `.scratch/perf/load-report.json`，其中有环境、fixtures、k6 指标与栈采样。k6 未安装、依赖失败或稳态场景真实业务错误过多时，命令失败；失败报告也应保留分析。

容量栈放宽 Redis 与本地回退限流预算，避免默认限流掩盖应用容量。报告记录实际配置，429/`rate_limit.exceeded` 单列为预期限流；需要评估生产限流策略时，用相应配置单独运行并解释结果。

## 给自己的 API 写一个场景

先新增 `scripts/perf/k6/readiness.js`，验证已经存在的框架健康接口。以下是完整 k6 文件，复用[公共 HTTP helper](../../scripts/perf/k6/lib.js)：

```js
import http from 'k6/http';
import { call, scenarioOptions, writeSummary } from './lib.js';

export const options = scenarioOptions({ vus: 2, duration: '20s' });

export default function () {
  call('readiness', 200, () => http.get(`${__ENV.PERF_BASE_URL}/health/ready`));
}

export const handleSummary = writeSummary({
  description: 'backend readiness under controlled load',
});
```

在运行器 `SCENARIOS` 对象追加文件、默认并发、时长与播种策略：

```js
readiness: { file: 'readiness.js', seed: false, vus: 2, durationSecs: 20 },
```

```bash
node scripts/perf/run-scenario.mjs readiness
```

预期生成 `.scratch/perf/readiness-report.json`，健康请求返回 200，报告没有业务错误。之后仿照 [load.js](../../scripts/perf/k6/load.js)编写自己的业务场景。

文件由运行器传入 `PERF_BASE_URL` 和 `PERF_SUMMARY`，不能把地址硬编码为生产。随后把健康请求替换为自己已实现的热路径：登录后的列表、详情、少量写入、版本冲突恢复与任务结果。复用 Origin、Session Cookie、CSRF 和随机幂等键；预期冲突应显式恢复，不能误记为容量错误或静默忽略。

[fixtures.mjs](../../scripts/perf/fixtures.mjs)当前经公开接口创建账号、文档与附件。为新业务增加相同方式的播种，记录用户数、资源数、文件大小与实际成功数量；不要通过直接 SQL 绕过要测试的业务规则。

## 选择场景与数据规模

| 命令                   | 观察目标                                     | 当前默认                   |
| ---------------------- | -------------------------------------------- | -------------------------- |
| `just perf-load`       | 读多写少的稳态请求                           | 4 VU，60 秒                |
| `just perf-saturation` | 并发阶梯与吞吐转折                           | 1/4/8/16/32 VU，每档 20 秒 |
| `just perf-trajectory` | 注册、读写、冲突、文件、任务与通知的完整轨迹 | 2 VU，60 秒                |
| `just perf-soak`       | 低并发长期队列和内存走势                     | 2 VU，600 秒               |

`PERF_SCALE=sm|md|lg` 选择数据档，`PERF_USERS`、`PERF_DOCS_PER_USER` 覆盖当前参考数据数量；`PERF_VUS`、`PERF_DURATION`（数字秒）调稳态场景。`PERF_STEPS`、`PERF_STEP_SECS` 调饱和阶梯；`PERF_SAMPLE_MS` 默认 2000 毫秒。新增业务应同步自己的规模变量与报告元数据。

## 读报告并处理失败

先检查 `business_errors`、4xx/5xx 与预期限流，再比较吞吐和 P50/P95/P99。稳态场景有业务错误计数上限，超限是故障运行；饱和场景故意越过容量，不以顶部档错误判失败。`plateauFromVUs` 只是吞吐达到最佳档 90% 的阅读提示，不能当作 SLA。

栈每两秒采样数据库连接、按 Job 状态分组的队列深度和 API/Worker RSS。保留原始时间序列，区分短暂积压与持续增长，并在相同源码、数据规模和机器上复跑。一次短长测没有增长不能证明没有泄漏。

夜跑配置在 [perf-nightly.yml](../../.github/workflows/perf-nightly.yml)，报告作为 artifact 保存；普通 `just check` 不运行这些场景。示例移除后，现有负载命令在启动前说明并退出；受控栈、采样和[报告整形](../../scripts/perf/report.mjs)保留，运行器的示例前置条件也应随新业务接入更新。

下一步：后端交付回到[部署指南](21-single-machine-production.md)；提供 Electron 客户端时再读[桌面资源长测](26-desktop-soak.md)。
