# 使用生产组件并注册业务演示场景

Web 客户端通过 `@saas/ui` 复用组件与语义 tokens，自己的业务通过 ExampleContribution.scenes 提供隔离演示。设计系统页面读取同一份生产组件，不额外维护一套颜色表或组件副本。

前提是自己的页面已完成[应用壳接入](27-add-example.md)与[双语文案](28-appearance-language.md)。后端合同不依赖设计系统，场景也不调用生产 API。

## 在业务中选择组件

从 [UI 组件目录](../../packages/ui/src/components/)按公开出口引入，例如：

```tsx
import { Button } from '@saas/ui/components/button';
```

使用 [styles.css](../../packages/ui/src/styles.css) 的 `primary`、`destructive`、`success`、`warning`、`ring` 等语义 tokens。按钮、输入、对话框与状态组件保持相同的焦点、禁用、错误和加载语义；错误还要给文字和 `aria-invalid`，不能只改变颜色。

运行 `just dev`，登录后访问 `/design-system` 或设置中的设计系统。基础展示实时读取 `getComputedStyle`；组件展示可操作真实按钮、输入与对话框。它用于开发者选择和核对组件，不向用户授予任何业务权限。

## 给 Billing 添加一个完整场景

在 `packages/views/src/billing/example.tsx` 添加组件：

```tsx
import { useState } from 'react';
import { Button } from '@saas/ui/components/button';

function BillingDemo() {
  const message = useAppMessage('billing');
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <Button onClick={() => setSaved(true)}>{message('demo.save')}</Button>
      <p role="status">{saved ? message('demo.saved') : ''}</p>
    </div>
  );
}
```

`useAppMessage` 沿用上一章该文件中的导入。在已有贡献的双语 `messages` 添加：

```ts
// messages.zh
'demo.title': '账务保存反馈',
'demo.save': '保存',
'demo.saved': '已保存',

// messages.en
'demo.title': 'Billing save feedback',
'demo.save': 'Save',
'demo.saved': 'Saved',
```

在 `createBillingExample()` 返回的贡献对象添加：

```tsx
scenes: [
  {
    id: 'save-feedback',
    titleKey: 'demo.title',
    render: () => <BillingDemo />,
  },
],
```

场景只用 React 局部状态和演示数据。点击保存只更新反馈，不查询或修改真实资源。完整合同与组装验证见 [AppScene](../../packages/views/src/shell/app-contract.ts)；[场景渲染器](../../packages/views/src/design-system/scenes-section.tsx)统一添加来源和本地化标题。

## 保持加载与所有权边界

设计系统是独立异步块，图标目录在其内部再次懒加载。不要从正常业务入口同步 import [icon-catalog.tsx](../../packages/views/src/design-system/icon-catalog.tsx)来取得某个图标；需要操作图标时直接按需引入 Lucide。业务路由的 ModuleIcon 通过 `moduleIcons` 贡献，文件图标来自已署名的 Material Icon Theme 子集，许可证见[第三方声明](../../THIRD-PARTY-NOTICES.md)。

把演示组件和测试登记为自己的业务所有权。移除贡献时场景与路由图标一起消失；Core-only 组合仍保留基础、组件和通用场景，不能让展厅反向 import 某个业务。

## 验证与失败检查

```bash
pnpm exec vitest run apps/web/src/design-system.test.tsx apps/web/src/app-shell.test.tsx
pnpm typecheck
node scripts/perf-bundle.mjs
```

在两种语言、两种主题下打开 Billing 场景，点击保存确认 `role="status"` 反馈；检查真实业务数据没有变化。临时移除 `demo.title` 的英文翻译，组装必须失败；恢复后复查。对话框等交互场景还需要用键盘检查焦点和 Esc。

包体检查确认设计系统和图标目录不进入首包。[懒加载基线](../../scripts/perf/baselines.json)有现成约束，注册一个新场景不应通过放宽阈值解决静态导入回归。

下一步：自己的产品文档按[维护开发者文档](../guides/maintain-docs.md)编写；公开站维护见[站点指南](30-public-site.md)。
