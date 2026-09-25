import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginUser, type ApiClient, type Login } from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { replaceSession } from './session';

export function LoginView({
  apiClient,
  onLoggedIn,
}: {
  apiClient: ApiClient;
  onLoggedIn: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: Login) =>
      (await loginUser({ client: apiClient, body, throwOnError: true })).data,
    retry: false,
    gcTime: 0,
    onSuccess: async (session) => {
      await replaceSession(queryClient, apiClient, session);
      onLoggedIn();
    },
  });
  const errorCode =
    mutation.error &&
    typeof mutation.error === 'object' &&
    'error' in mutation.error
      ? (mutation.error.error as { code?: string })?.code
      : undefined;
  const requestId = requestIdFromError(mutation.error);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>登录企业空间</h1>
          </CardTitle>
          <CardDescription>使用你的邮箱和密码继续。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              mutation.mutate({
                email: String(data.get('email')).trim(),
                password: String(data.get('password')),
              });
            }}
          >
            <FieldGroup>
              <Field data-disabled={mutation.isPending}>
                <FieldLabel htmlFor="login-email">邮箱</FieldLabel>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  disabled={mutation.isPending}
                />
              </Field>
              <Field data-disabled={mutation.isPending}>
                <FieldLabel htmlFor="login-password">密码</FieldLabel>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  disabled={mutation.isPending}
                />
              </Field>
              {mutation.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>登录未完成</AlertTitle>
                  <AlertDescription>
                    {errorCode === 'auth.invalid_credentials'
                      ? '邮箱或密码不正确，请重新输入。'
                      : '暂时无法登录，请稍后重试。'}
                    {requestId ? <p>请求编号：{requestId}</p> : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? '正在登录…' : '登录'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <a className="text-sm underline" href="/register">
            还没有账号？创建账号
          </a>
        </CardFooter>
      </Card>
    </main>
  );
}
