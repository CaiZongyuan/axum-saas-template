# 接入一个参考业务

通用应用壳不认识任何具体业务。示例通过一个声明式的贡献对象（页面、导航分组、双语文案、可选默认入口）在显式组装点接入，壳负责校验与装配。本章用仓库自带的便签示例走一遍完整接入，并演示零、单、双示例四种源码组合的运行与验证方式。

## 1. 一个示例拥有什么

每个示例在 `examples/<id>/manifest.json` 登记文件所有权（`ownedPaths`）与注册标记（`registrationMarkers`），删例工具据此整建制移除。运行时代码上，一个示例通过 `ExampleContribution` 贡献：

```ts
{
  id: 'notes',                        // 稳定 id：导航分组、文案命名空间、路由归属都来自它
  routes: [{ path: '/notes', component }],
  navigation: [{ id: 'main', labelKey: 'nav.group', items: [...] }],
  messages: { zh: { ... }, en: { ... } }, // 双语文案；缺任一语言在组装时失败
  defaultEntry: '/notes',             // 可选：登录后的业务默认入口
  scenes: [...],                      // 可选：场景描述声明
  provide,                            // 可选：包住本示例页面，提供示例自己的端口
}
```

类型与 `assembleApp` 校验都在 `packages/views/src/shell/app-contract.ts`。重复贡献 id、路由冲突、占用 Core 保留路由、文案缺翻译，都会在组装时明确失败——不会出现"后来者静默覆盖"。导航项只能指向示例自己贡献的路由，空分组自动消失。

## 2. 便签示例长什么样

`packages/views/src/notes/example.tsx` 是一个完整的最小示例：一个可访问页面（便签示例页）、一个导航分组（便签）、每语言六条文案和一个场景声明。它不依赖任何后端——第二个示例存在的目的就是证明组合接口不包含知识库的任何特例。页面内部用 `useAppMessage('notes')` 解析本示例的文案键；组装后的目录以 `notes.` 为前缀，因此不同示例的文案天然不会冲突。

## 3. 在组装点接入

`apps/web/src/app-examples.tsx` 是接入唯一需要编辑的文件。壳与 Core 代码不 import 具体示例，示例之间也不互相 import——组装点导入一切，并把结果交给壳：

```tsx
// example:notes:assembly:start
import { createNotesExample } from '@saas/views';
// example:notes:assembly:end

export const exampleEntries: ExampleContribution[] = [
  // example:notes:entries:start
  createNotesExample(),
  // example:notes:entries:end
];

export const assembledApp = assembleApp({
  examples: exampleEntries,
  defaultEntry: exampleEntries.find((entry) => entry.defaultEntry !== undefined)
    ?.defaultEntry,
});
```

每个示例拥有两组标记块：`assembly`（导入）与 `entries`（列表项），每个标记名在一个文件中只出现一次，删例工具因此可以机械改写。Router 只存在于应用适配层 `apps/web/src/router.tsx`：它把组装结果变成真实路由，业务页面通过端口（`params`、`navigate`、`apiClient`）获得路由能力，自身不 import 具体 Router。

## 4. 四种源码组合

| 组合               | 怎么得到                                            | 登录后落到哪里                         |
| ------------------ | --------------------------------------------------- | -------------------------------------- |
| 双示例（默认源码） | `just dev` 直接跑                                   | 知识库「我的文档」默认入口             |
| 仅便签             | `node scripts/example-remove.mjs`（默认移除知识库） | 通用首页 `/`（便签示例不声明默认入口） |
| 仅知识库           | `node scripts/example-remove.mjs --example notes`   | 知识库「我的文档」默认入口             |
| 仅 Core            | 同一副本先移除知识库再移除便签                      | 通用首页 `/`                           |

两次移除之间要提交一次副本改动——删例工具只改干净的副本，这份谨慎同样保护你的定制。

默认入口策略在组装处裁决：第一个声明默认入口的示例胜出，组装处也可显式指定覆盖；登录/注册后进入选出的业务默认入口，默认入口所属示例被移除时自然回到通用首页。直接访问 `/` 永远停在通用首页，不会被强制送往业务入口；合法业务深链接优先于默认入口。目标缺失时未知路径回落到首页，没有重定向循环。

每种组合都过同一组前端门禁：`pnpm typecheck`、`pnpm test:frontend`、`pnpm --filter @saas/web build` 与 `pnpm boundaries:check`。应用壳测试读取组装结果做断言（导航分组、默认入口、未知路径、深链接），所以同一份测试在四种组合里都成立；示例自己的行为测试随示例一起移除。CI 的 example-removal 任务会真实跑完四种组合。菜单显示不替代直接路由或后端授权——权限反馈仍由各业务页面与后端合同给出。

## 5. 登记所有权

接入完成后，把新增文件登记进 `examples/<id>/manifest.json`：`ownedPaths` 列出页面、测试与适配文件；`compositionPoints` 与 `registrationMarkers` 登记组装点文件及标记名。此后随时可以按[组合与移除](23-example-removal.md)的流程整建制移除，其余分组与 Core 功能保持稳定。
