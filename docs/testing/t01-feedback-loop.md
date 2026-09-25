# 运行当前测试与反馈循环

T01 的测试对象是第一条公开全栈请求。下面命令是真实检查，不是为尚未实现的 v1 功能放置的空门禁。

## 后端

```bash
just test-backend
```

脚本创建独立 PostgreSQL 容器；SQLx 测试执行真实迁移。开发数据库的数据卷不会被测试清空。测试通过 Router 请求验证 liveness、readiness、公开错误/request_id、OpenAPI，以及真实数据库迁移状态。启动配置测试运行真实 API 可执行文件，检查失败是否发生在监听前且不会泄露凭据。

迁移测试还会持有真实 PostgreSQL 迁移锁，再运行迁移命令，验证它在配置的期限内失败退出；HTTP 测试用数据库锁验证查询不会无限等待。

## 前端

```bash
just test-frontend
```

Vitest / Testing Library 操作真实 View，MSW 只替代 HTTP。测试覆盖从加载到成功、失败信息、request_id 和恢复后重试，以及服务无响应时结束加载并允许重试；每次测试创建新的 QueryClient。

## 开发进程清理

```bash
pnpm test:tooling
```

测试启动真实 HTTP 子进程，并让它忽略 SIGTERM。即使外层启动器先退出，停止开发服务也必须清理仍占用端口的子进程。测试观察服务是否还能响应，不依赖内部信号调用次数。

## 真实浏览器

首次准备 Chromium：

```bash
pnpm exec playwright install chromium
just e2e
```

E2E 创建独立数据库和动态端口，编译并运行真实 API，启动 Web 后通过 Chromium 访问。它检查响应来自实际接口，并暂停自己的数据库容器验证 readiness 失败而 liveness 存活，随后恢复。日志、失败截图和 trace 进入测试产物目录。

## 主检查

```bash
just check
```

包括 Rust fmt/clippy、前端格式/lint/typecheck、合同漂移、边界检查、进程清理与后端/View 测试、文档检查及 Web/文档构建。日常检查不启动浏览器；关键旅程完成后运行 `just e2e`，里程碑完整验收运行 `just check-full`。CI 的手动入口可勾选 `run_e2e`，普通 push/PR 保留快速检查。尚未交付的 Mobile、长测与业务功能不伪装成已通过的检查。

## 实施过程中的 red → green

本票依次先观察到：未注册路由返回 404、错误缺少 request_id、数据库未就绪却缺少 503 合同、未迁移数据库误报 ready、缺少 OpenAPI、错误配置继续监听，以及 View 不具备加载/失败反馈；然后逐条实现相应行为。

后续模块继续在已约定的公开入口上循环，不以内部方法调用次数或文件存在性代替行为。
