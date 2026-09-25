import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { useQuery } from '@tanstack/react-query';
import { getSystemStatus, type ApiClient } from '@saas/sdk';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { Skeleton } from '@saas/ui/components/skeleton';

export function StatusView({
  apiClient,
  docsUrl,
}: {
  apiClient: ApiClient;
  docsUrl: string;
}) {
  const query = useQuery({
    queryKey: ['system-status', apiClient.getConfig().baseUrl],
    queryFn: async ({ signal }) =>
      (await getSystemStatus({ client: apiClient, signal, throwOnError: true }))
        .data,
    retry: false,
    staleTime: 15_000,
  });
  const data = query.data;
  const requestId = requestIdFromError(query.error);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <a
            href="/"
            className="flex items-center gap-3 font-semibold tracking-tight"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-mono text-primary-foreground">
              A
            </span>
            SaaS Template
          </a>
          <nav aria-label="主导航" className="flex items-center gap-6 text-sm">
            <a href="/system" aria-current="page">
              服务状态
            </a>
            <a
              href={docsUrl}
              className="text-muted-foreground hover:text-foreground"
            >
              在线文档 ↗
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:py-16">
        <section className="flex flex-col items-start gap-4">
          <Badge variant="outline">T01 · 第一条全栈链路</Badge>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            {query.isPending
              ? '正在连接服务'
              : query.isError
                ? '连接暂不可用'
                : '服务已就绪'}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            从一条真实请求开始。页面通过生成的 SDK 访问 Rust API，再检查
            PostgreSQL 的连接与迁移状态。
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              重新检查
            </Button>
            <Button
              variant="outline"
              role="link"
              nativeButton={false}
              render={<a href={docsUrl} />}
            >
              阅读入门教程
            </Button>
          </div>
        </section>

        {query.isPending ? (
          <Card>
            <CardHeader>
              <CardTitle>连接检查</CardTitle>
              <CardDescription>等待 API 返回当前状态</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p role="status">正在检查服务连接</p>
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-5 w-40" />
            </CardContent>
            <CardFooter>检查包含真实数据库查询。</CardFooter>
          </Card>
        ) : null}

        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>暂时无法连接服务</AlertTitle>
            <AlertDescription>
              <p>请确认 API 与 PostgreSQL 已启动并完成迁移，然后重新检查。</p>
              {requestId ? (
                <p>
                  请求编号：<code>{requestId}</code>
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {data && !query.isError ? (
          <div className="grid gap-5 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>API</CardTitle>
                <CardDescription>Axum 应用服务</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                <Badge>已连接</Badge>
                <p className="font-mono">{data.service}</p>
              </CardContent>
              <CardFooter>版本 {data.version}</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>数据库</CardTitle>
                <CardDescription>持久化基础设施</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                <Badge>已连接</Badge>
                <p>PostgreSQL 已连接</p>
              </CardContent>
              <CardFooter>迁移版本 {data.schema_version}</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>API 合同</CardTitle>
                <CardDescription>Rust → OpenAPI → TypeScript</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                <Badge variant="secondary">类型同步</Badge>
                <p>使用生成的客户端</p>
              </CardContent>
              <CardFooter>
                <a
                  href="/api/openapi.json"
                  className="underline underline-offset-4"
                >
                  查看 OpenAPI JSON ↗
                </a>
              </CardFooter>
            </Card>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>沿着这条链路，开始自己的业务</CardTitle>
            <CardDescription>每一步都有源码、测试与对应教程。</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-6 md:grid-cols-3">
              <li className="flex flex-col gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  01 / 运行
                </span>
                <p>启动 API 和 Web，验证数据库已准备好。</p>
              </li>
              <li className="flex flex-col gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  02 / 理解
                </span>
                <p>跟随 HTTP 请求，理解合同、页面与测试如何协作。</p>
              </li>
              <li className="flex flex-col gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  03 / 扩展
                </span>
                <p>后续用简单知识库示例学习注册、Markdown 和附件。</p>
              </li>
            </ol>
          </CardContent>
          <CardFooter>
            当前阶段提供服务连接与入门文档；业务功能按 GitHub 实施票逐步交付。
          </CardFooter>
        </Card>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-border px-6 py-6 text-sm text-muted-foreground">
        模块化单体 · 可运行教程 · 可替换业务
      </footer>
    </div>
  );
}
