# UI 系列交接：第一轮 UI01–UI16 与风格对齐轮 UI-R1–R5 完成

交接日期：2026-09-29。仓库：CaiZongyuan/axum-saas-template。设计入口：[docs/ui/design.md](../ui/design.md)；上一份交接：[2026-09-26 v1 after T19](./2026-09-26-v1-after-t19.md)。

## 当前停止边界

UI 风格对齐轮的最后一票 UI-R5（[#103](https://github.com/CaiZongyuan/axum-saas-template/issues/103)）按批准的整改计划完成交付后收尾。此前：v1 的 T01–T28 已全部完成（见上一份交接后的恢复执行），父票 [#57](https://github.com/CaiZongyuan/axum-saas-template/issues/57) 的 16 张实现票 UI01–UI16 全部交付并整体验收，随后按用户「交付物与参考项目相距甚远」的核对结论完成第二轮五票整改（#99–#103）。

#57 按仓库约定是规格票，不随实现票关闭而关闭，实时状态以 GitHub 为准。截至交接时仓库仍开放的议题与本系列无关：[#98](https://github.com/CaiZongyuan/axum-saas-template/issues/98)（perf nightly 的 k6 安装校验和失败）、[#96](https://github.com/CaiZongyuan/axum-saas-template/issues/96)（教程 16 英文翻译）、[#89](https://github.com/CaiZongyuan/axum-saas-template/issues/89)（cached_documents 测试在 CI 负载下的抖动）。这些不是 UI 系列遗留，不在本报告范围。

## 本次交付与版本

### 第一轮（UI01–UI16，#57）

应用壳与导航、全量双语（含系统邮件与桌面错误页）、亮暗偏好（含首绘脚本与桌面镜像）、组件展厅（基础/组件/场景/图标）、Landing 与公开站四入口、示例装配合同（重复 id/路由冲突/中英不配对在组装期失败）、删例组合的 CI 真实构建。整体验收记录见 [v1 覆盖账本 §UI 与多示例系列验收](../architecture/v1-coverage.md)；视觉证据：[ui-r1](./assets/ui-r1-home.jpg)。

### 风格对齐轮（UI-R1–R5，#99–#103）

用户核对第一轮交付物后判定观感与结构与参考相距甚远，查明六类缺口（视觉几何未收敛、图标体系未进应用、设置页无分组、壳无插槽、`--popover` 缺失致弹窗透明、文档与验证漂移），整改计划获批准后按依赖序交付：

| 票            | 内容                                                                                                                                                                                                                                                                                                     | PR                                                                 | 视觉证据                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-R1（#99）  | 语义 token 全表按参考值重写；组件几何（4–6px 控件圆角、8px 容器封顶、2px 焦点环、xs/sm/default 尺寸档）；`--popover` 缺失修复                                                                                                                                                                            | [#104](https://github.com/CaiZongyuan/axum-saas-template/pull/104) | [ui-r1-home](./assets/ui-r1-home.jpg) · [documents](./assets/ui-r1-documents.jpg) · [settings](./assets/ui-r1-settings.jpg) · [login](./assets/ui-r1-login.jpg) |
| UI-R2（#100） | ModuleIcon 分类色图标（10 色 OKLCH × bare/flat/soft/glossy × 三尺寸，显式模块注册表）；Lucide 进壳（`Menu`/`X` 与动作位）；Material 文件图标子集 vendored 并登记许可                                                                                                                                     | [#105](https://github.com/CaiZongyuan/axum-saas-template/pull/105) | [ui-r2-icons](./assets/ui-r2-icons.jpg) · [shell](./assets/ui-r2-shell.jpg)                                                                                     |
| UI-R3（#101） | 设置套件（Tab/Section 深链锚点/Row/Card/Tabs + 范围徽章）；`/settings` 重组五分区；设计系统内嵌 + 独立路由两处复用                                                                                                                                                                                       | [#106](https://github.com/CaiZongyuan/axum-saas-template/pull/106) | [ui-r3-settings](./assets/ui-r3-settings.jpg)                                                                                                                   |
| UI-R4（#102） | 无路径 `_shell` 布局路由，壳恰好挂载一次；`topbarActions`/`loadingIndicator`/`extra` 三插槽；顺带修复 dev/preview 代理吞 `/api-keys` 深链                                                                                                                                                                | [#107](https://github.com/CaiZongyuan/axum-saas-template/pull/107) | [ui-r4-shell](./assets/ui-r4-shell.jpg)                                                                                                                         |
| UI-R5（#103） | 默认装配收敛为仅知识库（`unregisteredMarkers` 合同 + `scripts/example-add.mjs` 装回工具，CI 补「显式装回便签」场景）；应用内主题真浏览器 e2e（首绘、显式选择压过 OS 并耐刷新、跟随系统实时）；公开站色板单源化（`generate-docs-palette.mjs` 从 `styles.css` 生成 `--vp-*` 映射）；design.md 修订与本报告 | 本次交付                                                           | [ui-r5-landing](./assets/ui-r5-landing.jpg)                                                                                                                     |

每票均走仓库开发流程：公开接口 TDD → reduce-complexity → Standards + Spec 两轴评审 → PR → CI 全绿后合并。R1–R4 的像素级前后对比（代表页面 × 中英 × 明暗）记录于各 PR 描述。

## 已验证内容

- **门禁**：每票 `just check` 全绿（Rust 测试、View/前端测试、工具测试、格式/lint/typecheck、合同漂移、边界、文档检查、构建、性能预算）；`just e2e-docs` 在 R5 色板单源化后通过（公开站中英 × 明暗 × 窄屏 × base 路径）。CI 的 verify、desktop-smoke、example-removal 三 job 在每个 PR 上完整运行。
- **装配矩阵（R5 扩充后）**：默认（仅知识库）→ 装回便签（双示例）→ 移除知识库（仅便签）→ 移除便签（仅 Core）→ 独立副本先注册再移除（仅知识库），五种组合在本地与 CI 的 example-removal job 真实构建验证；`unregisteredMarkers` 的漂移守卫（整对缺席合法、半出现拒绝）有工具测试固定。
- **主题 e2e（R5 新增）**：`tests/e2e/theme.spec.ts`——首绘脚本在应用启动前应用存储主题；设置页显式选择「暗色」立即生效、压过 OS 暗色偏好（先存「亮色」）并在刷新后保持；「跟随系统」随 OS 实时切换不重载。测试全程 UI 驱动（locale 用 radio 固定），不播种 localStorage——`addInitScript` 在每次导航重放，播种值会在刷新时覆盖点击结果。
- **色板单源（R5）**：工具测试固定派生合同（两张表逐值拷贝、映射只允许 `var()`/`color-mix()`、被映射 token 在两表缺席即报错——该守卫真实拦截过暗表继承亮表模块色值的缺陷）；生成的 `palette.css` 是派生内容（gitignored），在文档 dev/build 前再生成，因此没有可漂移的已提交副本，`docs:check` 有意不检查它。
- **视觉验收**：R1–R5 代表页面前后对比见上表证据；R5 后公开站 Landing 的亮暗色随应用 token（链接蓝 `#176bc0`/`#79b5f0`、主导作黑白、炭黑暗面），与登录后的应用一致。

## 运行与定位入口

```bash
pnpm install --frozen-lockfile
just dev          # 应用栈（API、Worker、Web、PostgreSQL、Redis、RustFS、Mailpit）
just check        # 日常门禁
just docs         # 文档站开发（先投影页面与色板再启动 VitePress）
just e2e-docs     # 公开站浏览器旅程
node scripts/e2e.mjs tests/e2e/theme.spec.ts --reporter=line   # 主题旅程单跑
node scripts/example-add.mjs --example notes                   # 装回默认未注册的便签示例
```

- 应用内展厅：登录后 `/design-system` 或 设置 → 设计系统。
- 装配合同：[docs/ui/design.md §4.1](../ui/design.md)；教程 [组合与移除参考业务](../tutorials/23-example-removal.md) 与 [添加第二个示例](../tutorials/27-add-example.md)。
- 色板单一来源：`packages/ui/src/styles.css`；派生脚本 `scripts/generate-docs-palette.mjs`；公开站特有样式（字体栈、landing 布局）仍在 `apps/docs/.vitepress/theme/custom.css`。

## 需要保留的实现约束

- **壳单实例**：`_shell` 是无路径布局路由，任何新页面都不得再自行包 `AppShellLayout`；页面组件只渲染内容。Router 类型只存在于应用适配层。
- **装配默认**：便签示例默认未注册但 `status: active`；它的 `app-examples.tsx` 标记整对缺席是合法状态。给该文件新增其他示例的注册块时，锚点不得落在别的示例的标记块内部（`example-add` 的装配锚点选在 `assembly:end` 之后正是为此）。移除工具只编辑干净副本；先注册后移除必须先 commit。
- **apps/web 测试禁止硬编码具体示例入口**：example-removal CI 会剥离示例，断言须从 `assembledApp.navigation` 推导（R4 的教训）。
- **主题解析规则有三份镜像**（`index.html` 首绘脚本、`PreferencesProvider`、桌面错误页），各自以注释互指；改默认值或 system 语义时三处同步。`saas.locale` 存的是 `'zh'`/`'en'`，不是 BCP 47 标签——写 `'zh-CN'` 会被偏好存储拒绝并静默回退英文。
- **色板**：任何新颜色先进 `packages/ui/src/styles.css` 的两张表，公开站通过再生成跟随；不得在 `custom.css` 或组件里引入新的裸 hex。映射增删只能改 `scripts/lib/docs-palette.mjs` 并同步工具测试。
- **性能预算**：展厅、图标目录、markdown 分块仍在 `scripts/perf/baselines.json` 的懒加载边界之外，`perf-ci` 天花板未放宽。
- **双语成对**：新教程/新文案中英同步交付（`docs:check` 强制登记与配对）；教程 16 英文翻译仍登记于 [#96](https://github.com/CaiZongyuan/axum-saas-template/issues/96)。

## 剩余票与恢复顺序

本系列无剩余票。仓库当前开放议题即上文「当前停止边界」所列三项（#98、#96、#89），均为独立小修，无相互依赖；恢复时先重新查询 GitHub 实际状态。新功能开发应回到 [目标规范](../saas-template-architecture-spec.md) 的覆盖矩阵查找未落能力，并先检查代码再假定命令存在。
