import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logoutUser, type ApiClient } from '@saas/sdk';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button, buttonVariants } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { replaceSession, sessionQuery } from './session';

export function HomeView({
  apiClient,
  docsUrl,
}: {
  apiClient: ApiClient;
  docsUrl: string;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const logout = useMutation({
    mutationFn: async () => {
      if (!session.data) return;
      const result = await logoutUser({
        client: apiClient,
        headers: { 'x-csrf-token': session.data.csrf_token },
      });
      if (result.response?.status === 401) return;
      if (result.error) throw result.error;
    },
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      await replaceSession(queryClient, apiClient, null);
    },
  });
  if (session.isPending)
    return (
      <main className="p-8" role="status">
        正在读取会话…
      </main>
    );
  if (session.isError)
    return (
      <main className="mx-auto max-w-lg p-8">
        <Alert variant="destructive">
          <AlertTitle>无法读取会话</AlertTitle>
          <AlertDescription>请检查网络后重试。</AlertDescription>
        </Alert>
        <Button
          className="mt-4"
          onClick={() => {
            void session.refetch();
          }}
        >
          重试
        </Button>
      </main>
    );
  const user = session.data?.user;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>
              {user
                ? `你好，${user.display_name || user.email}`
                : '欢迎使用企业空间'}
            </h1>
          </CardTitle>
          <CardDescription>
            {user
              ? '你已登录，可以开始使用企业空间。'
              : '当前没有有效会话，请登录或创建账号。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {user ? (
            <>
              <p>{user.email}</p>
              <Badge variant="secondary">
                {
                  { owner: '企业所有者', admin: '管理员', member: '成员' }[
                    user.role
                  ]
                }
              </Badge>
              {logout.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>退出失败</AlertTitle>
                  <AlertDescription>请检查网络后重试。</AlertDescription>
                </Alert>
              ) : null}
              <Button
                variant="outline"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                {logout.isPending ? '正在退出…' : '退出登录'}
              </Button>
            </>
          ) : (
            <>
              <a href="/login" className={buttonVariants()}>
                登录
              </a>
              <a
                href="/register"
                className={buttonVariants({ variant: 'outline' })}
              >
                创建账号
              </a>
            </>
          )}
        </CardContent>
        <CardFooter className="flex gap-6">
          <a className="text-sm underline" href={docsUrl}>
            使用教程
          </a>
          <a className="text-sm underline" href="/system">
            查看服务状态
          </a>
        </CardFooter>
      </Card>
    </main>
  );
}
