# 在业务客户端复用语言与外观偏好

自己的页面使用壳提供的 Preferences 和 Messages，避免另建一份语言状态或主题表。它们是当前设备的客户端偏好，不修改 User、Membership 或后端授权。后端业务完成后再接入这些可选界面能力。

前提是页面已按[贡献指南](27-add-example.md)进入应用壳，Provider 由 Web 入口挂载。以下代码位于自己的业务 View，命令在仓库根目录运行。

## 为同一个页面添加双语内容

沿用 Billing 贡献中的 `messages.zh` / `messages.en`，每个 key 都提供两种语言。新建 `packages/views/src/billing/summary.tsx`，页面通过命名空间解析，不在组件里判断设备语言：

```tsx
import { useAppFormat } from '../shell/format';
import { useAppMessage } from '../shell/messages';

export function BillingSummary() {
  const message = useAppMessage('billing');
  const format = useAppFormat();
  return (
    <section>
      <h1>{message('page.title')}</h1>
      <output>{format.formatNumber(1200)}</output>
    </section>
  );
}
```

在上一章的 `billing/example.tsx` 导入并替换已有 `routes` 字段：

```tsx
import { BillingSummary } from './summary';
```

```tsx
routes: [{ path: '/billing', component: () => <BillingSummary /> }],
```

原来的 `BillingPage` 可以删除。`page.title` 使用上一章已有 key，示例数字只演示格式化，不表示货币金额。日期使用 `formatDateTime`，时区沿用当前设备。

业务目录只声明自己的 key，例如 `page.title`；组装后成为 `billing.page.title`。Core 文案由 [core-messages.ts](../../packages/views/src/shell/core-messages.ts)拥有，业务不得覆盖。`assembleApp` 检查中英 key、导航和场景标题是否完整，不能靠运行时回退掩盖缺失翻译。

## 使用已有偏好，不重复 Provider

[preferences.tsx](../../packages/views/src/shell/preferences.tsx)公开 `usePreferences()`：

| 字段/操作              | 合同            |
| ---------------------- | --------------- |
| `locale` / `setLocale` | `zh             | en`，显式选择立即生效 |
| `theme` / `setTheme`   | `system         | light                 | dark` |
| `resolvedTheme`        | 当前实际 `light | dark`                 |

壳的登录页与设置页已提供控件，业务页面一般只消费状态。手动选择保存在 `saas.locale` 和 `saas.theme`，不跨设备同步。首次语言按 `navigator.languages` 顺序选第一个中文或英文，均不匹配时回退英文；主题默认跟随系统。

无效存储值按未保存处理；存储不可用时应用照常启动，选择只保留在当前会话。系统明暗变化只影响 `system`。密码重置链接可暂时覆盖流程语言，首次手动选择结束覆盖，原保存值不会被链接暗中改写。

## 保持首屏与生产主题一致

[apps/web/index.html](../../apps/web/index.html)在 React 绘制前读取同一存储键，设置 `html.lang`、`dark` 和 `color-scheme`。改偏好键或回退规则时同步首绘脚本，否则刷新深色页面会先闪浅色。

业务 UI 使用 [生产 tokens](../../packages/ui/src/styles.css)的 `text-foreground`、`bg-background`、`text-muted-foreground` 等语义类，跟随壳主题。不要在自己的组件另加整页颜色状态。文案、`html.lang`、页面标题与可访问名称应随语言变化，输入内容不丢失。

Electron 由[平台适配器](../../apps/web/src/desktop-preferences.tsx)镜像两个偏好枚举到本地错误页；浏览器与桌面存储互相独立。

## 验证与失败检查

```bash
pnpm exec vitest run packages/views/src/shell/preferences.test.tsx packages/views/src/shell/core-messages.test.ts apps/web/src/settings.test.tsx
pnpm typecheck
```

启动 `just dev`，在已有设置控件切换语言与主题：自己的标题、数字格式和表面应同步，刷新仍保留选择。临时删掉 Billing 的英文 `page.title`，组装应失败；补回后重跑。自己新增的复杂表单还应检查语言切换不丢草稿。

运行时 [messages.tsx](../../packages/views/src/shell/messages.tsx)依次尝试当前语言、英文、可理解的通用提示，不向用户显示裸 key；这用于异常容错，发布检查仍要求目录完整。上述能力是 Core，不随参考业务删除。

下一步：[使用生产组件并注册隔离演示场景](29-design-system.md)。
