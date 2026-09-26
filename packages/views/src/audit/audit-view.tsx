import { RateLimitHint } from '../system/rate-limit';
import { useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  listAuditEvents,
  type ApiClient,
  type CurrentSession,
  type AuditEvent,
  type ListAuditEventsData,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import { Empty, EmptyHeader, EmptyTitle } from '@saas/ui/components/empty';
import { Field, FieldGroup, FieldLabel } from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { sessionQuery } from '../identity';

function Failure({ error }: { error: unknown }) {
  const code =
    error && typeof error === 'object' && 'error' in error
      ? (error.error as { code?: string }).code
      : undefined;
  const messages: Record<string, string> = {
    'audit.forbidden': '当前权限已失效，仅企业所有者或管理员可以查看审计记录。',
    'audit.invalid_page': '筛选条件或分页已失效，请重新筛选。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>无法读取审计记录</AlertTitle>
      <AlertDescription>
        {messages[code ?? ''] ?? '暂时无法读取，请刷新重试。'}
        <RateLimitHint error={error} />
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
export function AuditView({
  apiClient,
  onBack,
}: {
  apiClient: ApiClient;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, client));
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">审计记录</h1>
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
      ) : session.data.user.role === 'member' ? (
        <p>仅企业所有者或管理员可以查看审计记录。</p>
      ) : (
        <History
          key={session.data.user.id}
          apiClient={apiClient}
          identity={session.data}
        />
      )}
    </main>
  );
}
type Filters = Omit<
  NonNullable<ListAuditEventsData['query']>,
  'cursor' | 'limit'
>;
const fields = [
  ['action', '动作'],
  ['resource_id', '资源 ID'],
  ['resource_type', '资源类型'],
  ['actor_id', '操作者 ID'],
  ['request_id', '请求 ID'],
  ['correlation_id', '关联 ID'],
  ['job_id', '任务 ID'],
] as const;
function History({
  apiClient,
  identity,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const historyKey = ['audit', apiClient.getConfig().baseUrl, identity.user.id];
  const queryKey = [...historyKey, filters];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) =>
      (
        await listAuditEvents({
          client: apiClient,
          query: { ...filters, cursor: pageParam, limit: 20 },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 5,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.data) ?? [];
  function applyFilters() {
    const next: Filters = {};
    for (const [key] of fields) {
      const value = draft[key]?.trim();
      if (value) next[key] = value;
    }
    setFilters(next);
    // Start at recent records even if the same filter has older cached pages.
    void queryClient.resetQueries({
      queryKey: [...historyKey, next],
      exact: true,
    });
  }
  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {fields.map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`audit-${key}`}>{label}</FieldLabel>
              <Input
                id={`audit-${key}`}
                value={draft[key] ?? ''}
                maxLength={200}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    [key]: event.target.value,
                  }))
                }
              />
            </Field>
          ))}
        </FieldGroup>
        <div className="flex gap-3">
          <Button type="submit">筛选记录</Button>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              void queryClient.resetQueries({ queryKey, exact: true });
            }}
          >
            刷新审计
          </Button>
        </div>
      </form>
      {query.isPending ? (
        <p role="status">正在读取审计记录…</p>
      ) : query.isError ? (
        <Failure error={query.error} />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有匹配的审计记录</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {!query.isError ? (
        <ol className="flex flex-col gap-4">
          {items.map((event) => (
            <li key={event.id}>
              <Entry event={event} />
            </li>
          ))}
        </ol>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          加载更多审计
        </Button>
      ) : null}
    </>
  );
}
function Entry({ event }: { event: AuditEvent }) {
  const context = [
    ['操作者', event.actor_id ?? '系统'],
    ['资源类型', event.resource_type],
    ['资源', event.resource_id],
    ['请求 ID', event.request_id],
    ['关联 ID', event.correlation_id],
    ['任务 ID', event.job_id],
    ['Trace ID', event.trace_id],
    ['受影响用户', event.metadata.subject_user_id],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{event.action}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <time
          dateTime={event.created_at}
          className="text-sm text-muted-foreground"
        >
          {new Date(event.created_at).toLocaleString()}
        </time>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {context
            .filter(([, value]) => !!value)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
        </dl>
      </CardContent>
    </Card>
  );
}
