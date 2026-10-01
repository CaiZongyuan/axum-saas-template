# 把自己的业务页面接入应用壳

后端模块与 OpenAPI 已接入后，通过 ExampleContribution 为 Universal App Shell 提供 Web 页面、导航和双语文案。前端贡献对象不注册后端 Router，也不能授予资源权限；这两件事分别由 API 组装点和业务授权负责。

前提是熟悉[项目结构](../architecture/project-structure.md)、已安装 pnpm 依赖。以下改动在自己的开发副本进行，命令从仓库根目录运行。

## 创建最小完整贡献

新建 `packages/views/src/billing/example.tsx`。本阶段只接入一个页面，后续由 `AppPageProps.apiClient` 调用自己的生成 SDK：

```tsx
import type { ExampleContribution } from '../shell/app-contract';
import { useAppMessage } from '../shell/messages';

function BillingPage() {
  const message = useAppMessage('billing');
  return <h1>{message('page.title')}</h1>;
}

export function createBillingExample(): ExampleContribution {
  return {
    id: 'billing',
    routes: [{ path: '/billing', component: () => <BillingPage /> }],
    navigation: [
      {
        id: 'main',
        labelKey: 'nav.group',
        items: [{ id: 'billing', labelKey: 'page.title', path: '/billing' }],
      },
    ],
    messages: {
      zh: { 'nav.group': '账务', 'page.title': '账务' },
      en: { 'nav.group': 'Billing', 'page.title': 'Billing' },
    },
    defaultEntry: '/billing',
  };
}
```

在 [Views 出口](../../packages/views/src/index.ts)追加：

```ts
export { createBillingExample } from './billing/example';
```

小页面先保持简单；需要参数、导航或客户端时使用[公开页面端口](../../packages/views/src/shell/app-contract.ts)的 `params`、`navigate`、`apiClient`。共享页面不 import Web Router。

## 在显式组装点注册

[app-examples.tsx](../../apps/web/src/app-examples.tsx)是唯一导入业务贡献的 Web 组装点。追加导入和列表项，放在已有业务 marker 外：

```tsx
// example:billing:assembly:start
import { createBillingExample } from '@saas/views';
// example:billing:assembly:end
```

```tsx
  // example:billing:entries:start
  createBillingExample(),
  // example:billing:entries:end
```

第二段位于现有 `exampleEntries` 数组内。通用壳、设置和通知读取 `assembledApp`，无需认识 Billing。Router 在 [apps/web/src/router.tsx](../../apps/web/src/router.tsx)把贡献转换为真实路由。

```bash
pnpm typecheck
pnpm test:frontend
pnpm --filter @saas/web build
pnpm boundaries:check
```

启动 `just dev`，登录后访问 `/billing`，中英切换均应显示标题。临时把路由改成 Core 保留的 `/settings`，组装应明确报错；恢复后再次验证。

## 默认入口与授权

第一个声明 `defaultEntry` 的贡献决定登录/注册后落点，组装处可显式覆盖。已有默认业务仍排在前面时，追加 Billing 不会自动改变落点；直接访问 `/` 永远是通用首页。合法业务深链优先，目标被移除后回到通用首页。

`assembleApp` 会拒绝重复 id、路由冲突、Core 保留路由、缺失中英 key 或导航指向未贡献的路由。隐藏导航不是授权；用户直达页面和 API 时仍执行后端身份、有效成员与资源规则。

## 登记所有权与可选贡献

为自己的可移除参考业务创建 `examples/billing/manifest.json`，登记稳定 id/markerPrefix、模块和页面路径、双语教程、迁移、测试、独占依赖，以及这些组装区块。共享能力不登记为业务独占；业务之间不互相 import。完整规则见[移除指南](23-example-removal.md)。

可按真实需要追加 `provide`（页面自己的端口环境）、`resolveNotificationTarget`（通知目标）、`describeNotification`（本地化通知）、`scenes`（演示场景）与 `moduleIcons`（业务路由图标）。未知通知目标仍可读，目标 API 每次重新授权。未添加的字段不需要占位。

仓库的纯 UI 便签可通过 `node scripts/example-add.mjs --example notes` 在干净副本注册；它验证组合合同，不是后端便签产品。工具读取 `examples/<id>/registration.mjs` 并在所有锚点通过后写入，拒绝脏副本、重复添加和歧义锚点。全新业务仍需自己实现贡献与登记，工具不会生成领域规则。

下一步：[复用语言和外观偏好](28-appearance-language.md)，再[注册隔离演示场景](29-design-system.md)。
