import { RateLimitHint } from '../system/rate-limit';
import { useEffect, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createApiKey,
  revokeApiKey,
  listApiKeys,
  listApiKeyScopes,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@saas/ui/components/empty';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { Switch } from '@saas/ui/components/switch';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import { sessionKey, sessionQuery } from '../identity';

function Failure({
  error,
  creation = false,
}: {
  error: unknown;
  creation?: boolean;
}) {
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>密钥操作未完成</AlertTitle>
      <AlertDescription>
        {creation
          ? '请刷新列表确认是否已创建；若已有记录但未取得密钥，请撤销后重新创建。'
          : '请检查当前会话和输入后重试。'}
        <RateLimitHint error={error} />
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
export function ApiKeysView({
  apiClient,
  onBack,
  copySecret,
}: {
  apiClient: ApiClient;
  onBack: () => void;
  copySecret: (secret: string) => Promise<void>;
}) {
  const client = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, client));
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <Button variant="link" onClick={onBack}>
          返回首页
        </Button>
      </header>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <Failure error={session.error} />
      ) : !session.data ? (
        <p>请先登录。</p>
      ) : (
        <Settings
          key={session.data.user.id}
          apiClient={apiClient}
          identity={session.data}
          copySecret={copySecret}
        />
      )}
    </main>
  );
}
function Settings({
  apiClient,
  identity,
  copySecret,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  copySecret: (secret: string) => Promise<void>;
}) {
  const client = useQueryClient();
  const queryKey = [
    'api-keys',
    apiClient.getConfig().baseUrl,
    identity.user.id,
  ];
  const keys = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) =>
      (
        await listApiKeys({
          client: apiClient,
          query: { limit: 20, cursor: pageParam },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 5,
    retry: false,
  });
  const scopes = useQuery({
    queryKey: [...queryKey, 'scopes'],
    queryFn: async ({ signal }) =>
      (
        await listApiKeyScopes({
          client: apiClient,
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
  });
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState('30');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [secret, setSecret] = useState<string>();
  const [copyStatus, setCopyStatus] = useState('');
  const abort = useRef<AbortController | null>(null);
  const revealedKey = useRef<string | undefined>(undefined);
  useEffect(() => () => abort.current?.abort(), []);
  async function create() {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError(undefined);
    setSecret(undefined);
    setCopyStatus('');
    try {
      // Keep the one-time response out of both Query and Mutation caches.
      const issued = (
        await createApiKey({
          client: apiClient,
          body: {
            name: name.trim(),
            scopes: selected,
            expires_in_days: Number(days),
          },
          headers: { 'x-csrf-token': identity.csrf_token },
          signal: controller.signal,
          throwOnError: true,
        })
      ).data;
      if (!controller.signal.aborted) {
        revealedKey.current = issued.key.id;
        setSecret(issued.secret);
        await client.resetQueries({ queryKey, exact: true });
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error);
    } finally {
      abort.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  async function copy() {
    if (!secret) return;
    try {
      await copySecret(secret);
      setCopyStatus('已复制');
    } catch {
      setCopyStatus('复制失败，请手动保存。');
    }
  }
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await revokeApiKey({
        client: apiClient,
        path: { id },
        headers: { 'x-csrf-token': identity.csrf_token },
        throwOnError: true,
      });
    },
    retry: false,
    onSuccess: async (_, id) => {
      if (revealedKey.current === id) {
        setSecret(undefined);
        setCopyStatus('');
      }
      await client.resetQueries({ queryKey, exact: true });
    },
    onError: (error) => {
      if (
        error &&
        typeof error === 'object' &&
        'error' in error &&
        (error.error as { code?: string }).code === 'auth.unauthorized'
      )
        void client.invalidateQueries({ queryKey: sessionKey(apiClient) });
    },
  });
  const items = keys.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>创建 API Key</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="key-name">名称</FieldLabel>
                <Input
                  id="key-name"
                  maxLength={100}
                  required
                  disabled={pending}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key-expiry">有效期</FieldLabel>
                <NativeSelect
                  id="key-expiry"
                  disabled={pending}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                >
                  {['7', '30', '90', '365'].map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {value} 天
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <FieldSet>
                <FieldLegend>允许的操作</FieldLegend>
                {scopes.isPending ? (
                  <p role="status">正在读取可用权限…</p>
                ) : scopes.isError ? (
                  <Failure error={scopes.error} />
                ) : (
                  scopes.data.data.map((scope) => (
                    <Field key={scope.id} orientation="horizontal">
                      <FieldLabel htmlFor={`scope-${scope.id}`}>
                        {scope.label}
                      </FieldLabel>
                      <Switch
                        id={`scope-${scope.id}`}
                        disabled={pending}
                        checked={selected.includes(scope.id)}
                        onCheckedChange={(checked) =>
                          setSelected((previous) =>
                            checked
                              ? [...previous, scope.id]
                              : previous.filter((id) => id !== scope.id),
                          )
                        }
                      />
                    </Field>
                  ))
                )}
              </FieldSet>
            </FieldGroup>
            <Button
              type="submit"
              disabled={
                pending ||
                !name.trim() ||
                selected.length === 0 ||
                scopes.isError
              }
            >
              {pending ? '正在创建…' : '创建密钥'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error ? <Failure error={error} creation /> : null}
      {revoke.isError ? <Failure error={revoke.error} /> : null}
      {secret ? (
        <Card>
          <CardHeader>
            <CardTitle>请立即保存密钥</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p>关闭后无法再次查看。只授予所需权限，并妥善保管。</p>
            <Field>
              <FieldLabel htmlFor="new-key-secret">
                新密钥（只显示这一次）
              </FieldLabel>
              <Input
                id="new-key-secret"
                value={secret}
                readOnly
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  void copy();
                }}
              >
                复制密钥
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSecret(undefined);
                  setCopyStatus('');
                }}
              >
                我已保存，隐藏密钥
              </Button>
            </div>
            {copyStatus ? <p role="status">{copyStatus}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <div>
        <Button
          variant="outline"
          disabled={keys.isFetching}
          onClick={() => {
            void client.resetQueries({ queryKey, exact: true });
            void scopes.refetch();
          }}
        >
          刷新密钥
        </Button>
      </div>
      {keys.isPending ? (
        <p role="status">正在读取密钥…</p>
      ) : keys.isError ? (
        <Failure error={keys.error} />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有 API Key</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {!keys.isError ? (
        <ul className="flex flex-col gap-3">
          {items.map((key) => (
            <li
              key={key.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <h2 className="font-semibold">{key.name}</h2>
              <span>{key.prefix}</span>
              <p className="text-sm text-muted-foreground">
                {key.scopes.join(' · ')} · 有效期至{' '}
                {new Date(key.expires_at).toLocaleString()}
              </p>
              <div>
                <Badge variant={key.revoked_at ? 'outline' : 'secondary'}>
                  {key.revoked_at
                    ? '已撤销'
                    : new Date(key.expires_at).getTime() <= keys.dataUpdatedAt
                      ? '已到期'
                      : '有效'}
                </Badge>
              </div>
              {!key.revoked_at ? (
                <Button
                  variant="outline"
                  disabled={revoke.isPending}
                  aria-label={`撤销 ${key.name}`}
                  onClick={() => revoke.mutate(key.id)}
                >
                  撤销密钥
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {keys.hasNextPage ? (
        <Button
          variant="outline"
          disabled={keys.isFetching}
          onClick={() => {
            void keys.fetchNextPage();
          }}
        >
          加载更多密钥
        </Button>
      ) : null}
    </>
  );
}
