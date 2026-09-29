# 跟做：外观与语言设置

界面语言和明暗主题是设备级偏好：登录前就能切换，选择保存在当前浏览器或桌面端，不跨设备同步，也不进入账号数据。本章走一遍偏好的完整行为——首访跟随设备、手动选择优先、刷新恢复、无效值回退、存储不可用时仍可切换——以及应用文案的双语归属规则：Core 与各示例各自维护目录，在组装点合并，运行时缺失翻译回退到可理解文案而不是裸 key。

## 1. 先体验：从登录页到设置页

运行 `just dev`，打开 `/login`。右上角有「简体中文 / English」和「跟随系统 / 亮色 / 暗色」两组控件，登录前后行为一致：点击立即生效，页面不重载，正在输入的邮箱/密码原样保留。注册页、忘记/重置密码页使用同一组控件。

登录后侧栏底部进入「设置」（`/settings`）：语言和主题在「外观与语言」分区里，仍是两组原生单选框，与登录页控件写同一个偏好状态。切到 English 后侧栏、页面标题、`html.lang` 同步变为英文；地址栏没有变化，也没有网络请求——切换是纯前端状态。

设置页按分区组织：外观与语言（本设备）、账户、API Keys、设计系统（内嵌同一展厅）与帮助；后三类属于登录后能力，会话解析后出现。`?section=` 查询直达某个分区，例如 `/settings?section=api-keys`；侧栏底部只保留「设置」入口与登录后的高频直达（API Keys、设计系统、系统状态），使用教程在设置的「帮助」分区里。

## 2. 偏好判定顺序

[preferences 模块](../../packages/views/src/shell/preferences.tsx)实现三条规则：

1. **首次使用跟随设备**。读取 `navigator.languages` 按顺序找第一个中文或英文标签：中文（`zh-*`）→ 简体中文；英文（`en-*`）→ English；都没有 → English。`html.lang` 相应写 `zh-CN` 或 `en`。
2. **手动选择优先并保存**。选择写入 `localStorage` 的 `saas.locale` 与 `saas.theme`；下次打开直接采用，不再看设备语言。
3. **无效值回退**。存储里的值不在已知集合内（例如手工改过）时按"未保存"处理，回到第 1 条。

主题默认「跟随系统」：只有该模式监听系统明暗变化并实时切换；「亮色 / 暗色」固定不变。

## 3. 首屏不闪烁：绘制前的内联脚本

React 首帧渲染之前，[index.html](../../apps/web/index.html) 的一段内联脚本读取同样的两个键，直接在 `<html>` 上设置 `lang`、`dark` class 和 `color-scheme`。这样刷新深色偏好时不会先白一帧。脚本逻辑与 `PreferencesProvider` 必须保持一致——两边都读同一个键、同一个回退顺序；改任一侧时同步另一侧。

存储不可用（隐私模式禁用存储等）时两个读取都静默失败：应用照常启动，偏好只在当前会话内有效，切换控件仍然工作。

## 4. 双语文案按归属注册

界面文案分两处维护：

- **Core 目录**：[core-messages.ts](../../packages/views/src/shell/core-messages.ts) 持有壳、首页、身份流程、设置、错误与通用提示的中英文案。发布完整性由对齐测试保证——中英 key 集合一致、无空值、占位符一致。
- **示例目录**：每个示例在自己的 `ExampleContribution.messages` 里提供双语文案，键以示例 id 命名空间开头（如 `notes.page.title`）。

组装时 Core 先注册，示例随后追加；示例占用他人已注册的 key 会在组装时报错，不会静默覆盖。页面通过 `useAppMessage()`（或带命名空间的 `useAppMessage('notes')`）解析：当前语言缺失时回退英文，再缺失时显示"这段界面文字暂不可用。"之类的可理解提示——永不显示裸 key，也不抛错。`{name}` 形式的参数插值由共享解析器完成。

日期与数字用当前语言的 `Intl.DateTimeFormat` / `Intl.NumberFormat` 格式化（`useAppFormat`），时区沿用设备设置。设置页底部的教程链接按当前语言打开本章的对应深链（中文 `/docs/`、英文 `/en/docs/`，站点 base 参与拼路径）。

## 5. 无障碍与窄屏

语言和主题控件是真实按钮（`aria-pressed` 标注当前项），设置页用原生 `fieldset/legend` 单选框，键盘行为跟随平台。切换语言时 `html.lang`、页面 `<title>` 与 meta description、导航的无障碍名称（"主菜单 / Main menu"）一并更新。侧栏在窄屏折叠为抽屉，开合按钮用 `aria-expanded` / `aria-controls` 声明状态，Esc 也会收起；窄屏触控目标保持不小于 44px，桌面行高压至 36px。通知与 API Keys 属于登录后能力，未登录的侧栏不展示。

## 6. 验证

```bash
pnpm exec vitest run packages/views/src/shell/preferences.test.tsx
pnpm exec vitest run packages/views/src/shell/core-messages.test.ts
pnpm exec vitest run apps/web/src/settings.test.tsx
just check
```

偏好测试覆盖设备语言顺序、主题解析、持久化、无效值回退、系统主题联动与存储不可用；Core 目录测试做中英对齐检查；settings 测试在真实 Router 里走切换、持久化与输入不丢失。浏览器验证集中在一次：首屏主题、刷新恢复、系统明暗切换与窄屏抽屉。移除任一示例后本章能力不受影响——偏好与 Core 文案不属于任何示例。
