import { useMutation, useQueryClient } from '@tanstack/react-query';
import { registerUser, type ApiClient, type Registration } from '@saas/sdk';
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { sessionKey } from './session';

function registrationError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'error' in error
      ? (error.error as { code?: string })?.code
      : undefined;
  if (code === 'auth.email_exists')
    return '这个邮箱已注册，请使用已有账号登录。';
  if (code === 'auth.session_unavailable')
    return '账号已创建，但暂时无法登录。请稍后登录，无需重新注册。';
  if (code === 'auth.invalid_input') return '请检查邮箱、密码和显示名后重试。';
  return '暂时无法完成注册，请稍后重试。';
}

export function RegisterView({
  apiClient,
  onRegistered,
}: {
  apiClient: ApiClient;
  onRegistered: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: Registration) =>
      (await registerUser({ client: apiClient, body, throwOnError: true }))
        .data,
    retry: false,
    gcTime: 0,
    onSuccess: (session) => {
      queryClient.removeQueries();
      queryClient.setQueryData(sessionKey(apiClient), session);
      onRegistered();
    },
  });
  const requestId = requestIdFromError(mutation.error);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>创建你的账号</h1>
          </CardTitle>
          <CardDescription>使用邮箱与密码，进入企业空间。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              mutation.mutate({
                email: String(data.get('email')).trim(),
                password: String(data.get('password')),
                display_name: String(data.get('display_name')).trim() || null,
              });
            }}
          >
            <FieldGroup>
              <Field data-disabled={mutation.isPending}>
                <FieldLabel htmlFor="email">邮箱</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  disabled={mutation.isPending}
                />
              </Field>
              <Field data-disabled={mutation.isPending}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  aria-describedby="password-help"
                  disabled={mutation.isPending}
                />
                <FieldDescription id="password-help">
                  使用 12–128 个字符，可以包含空格。
                </FieldDescription>
              </Field>
              <Field data-disabled={mutation.isPending}>
                <FieldLabel htmlFor="display-name">显示名（可选）</FieldLabel>
                <Input
                  id="display-name"
                  name="display_name"
                  autoComplete="nickname"
                  maxLength={80}
                  disabled={mutation.isPending}
                />
              </Field>
              {mutation.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>注册未完成</AlertTitle>
                  <AlertDescription>
                    {registrationError(mutation.error)}
                    {requestId ? <p>请求编号：{requestId}</p> : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? '正在创建账号…' : '创建账号'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <a className="text-sm text-muted-foreground underline" href="/">
            返回首页
          </a>
        </CardFooter>
      </Card>
    </main>
  );
}
