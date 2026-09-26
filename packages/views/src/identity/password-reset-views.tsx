import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  requestPasswordReset,
  completePasswordReset,
  type ApiClient,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@saas/ui/components/card';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { RateLimitHint, useRetryDelay } from '../system/rate-limit';
import { replaceSession } from './session';

function Failure({ error }: { error: unknown }) {
  const code =
    error && typeof error === 'object' && 'error' in error
      ? (error.error as { code?: string }).code
      : undefined;
  const messages: Record<string, string> = {
    'auth.reset_invalid': '重置链接无效或已失效，请重新申请。',
    'auth.invalid_input': '请检查邮箱或 12–128 个字符的新密码。',
  };
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>密码重置未完成</AlertTitle>
      <AlertDescription>
        {messages[code ?? ''] ??
          '暂时无法确认结果，请稍后重试；也可以尝试用新密码登录。'}
        <RateLimitHint error={error} />
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
export function ForgotPasswordView({
  apiClient,
  onLogin,
}: {
  apiClient: ApiClient;
  onLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>();
  const abort = useRef<AbortController | null>(null);
  const cooldown = useRetryDelay();
  useEffect(() => () => abort.current?.abort(), []);
  async function submit() {
    if (abort.current || cooldown.remaining > 0) return;
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError(undefined);
    try {
      await requestPasswordReset({
        client: apiClient,
        body: { email: email.trim() },
        signal: controller.signal,
        throwOnError: true,
      });
      if (!controller.signal.aborted) setSent(true);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error);
        cooldown.start(error);
      }
    } finally {
      abort.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>找回密码</h1>
          </CardTitle>
          <CardDescription>使用注册邮箱申请一次性重置链接。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sent ? (
            <>
              <p role="status">
                如果该账号可用，你会收到重置邮件。请检查收件箱或垃圾邮件。
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSent(false);
                  setError(undefined);
                }}
              >
                重新填写邮箱
              </Button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="reset-email">邮箱</FieldLabel>
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    disabled={pending}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={pending || cooldown.remaining > 0}
                >
                  {pending
                    ? '正在申请…'
                    : cooldown.remaining > 0
                      ? `请等待 ${cooldown.remaining} 秒`
                      : '发送重置邮件'}
                </Button>
              </FieldGroup>
            </form>
          )}
          {error ? <Failure error={error} /> : null}
          <Button variant="link" onClick={onLogin}>
            返回登录
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
export function ResetPasswordView({
  apiClient,
  token,
  onConsumed,
  onLogin,
  onRequest,
}: {
  apiClient: ApiClient;
  token: string | undefined;
  onConsumed: () => void;
  onLogin: () => void;
  onRequest: () => void;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>();
  const [validation, setValidation] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  const cooldown = useRetryDelay();
  useEffect(() => () => abort.current?.abort(), []);
  async function submit(form: HTMLFormElement) {
    if (!token || abort.current || cooldown.remaining > 0) return;
    const values = new FormData(form);
    const password = String(values.get('password'));
    if (password !== String(values.get('confirmation'))) {
      setValidation('两次输入的密码不一致。');
      return;
    }
    setValidation(undefined);
    setError(undefined);
    setPending(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      // The token and password stay in this component's request, never in mutation/query caches.
      await completePasswordReset({
        client: apiClient,
        body: { token, password },
        signal: controller.signal,
        throwOnError: true,
      });
      if (!controller.signal.aborted) {
        await replaceSession(client, apiClient, null);
        if (!controller.signal.aborted) {
          setDone(true);
          onConsumed();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error);
        cooldown.start(error);
      }
    } finally {
      abort.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>设置新密码</h1>
          </CardTitle>
          <CardDescription>成功后，原来的登录会话会失效。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {done ? (
            <p role="status">密码已重置，请重新登录。</p>
          ) : !token ? (
            <Alert variant="destructive">
              <AlertTitle>重置链接不完整</AlertTitle>
              <AlertDescription>
                请重新打开邮件中的链接，或重新申请。
              </AlertDescription>
            </Alert>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit(event.currentTarget);
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-password">新密码</FieldLabel>
                  <Input
                    id="new-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={pending}
                  />
                  <FieldDescription>使用 12–128 个字符。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">确认新密码</FieldLabel>
                  <Input
                    id="confirm-password"
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={pending}
                  />
                </Field>
                {validation ? <p role="alert">{validation}</p> : null}
                <Button
                  type="submit"
                  disabled={pending || cooldown.remaining > 0}
                >
                  {pending
                    ? '正在重置…'
                    : cooldown.remaining > 0
                      ? `请等待 ${cooldown.remaining} 秒`
                      : '设置新密码'}
                </Button>
              </FieldGroup>
            </form>
          )}
          {error ? <Failure error={error} /> : null}
          <div className="flex flex-wrap gap-3">
            <Button variant="link" onClick={onLogin}>
              返回登录
            </Button>
            {!done ? (
              <Button variant="outline" onClick={onRequest}>
                重新申请链接
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
