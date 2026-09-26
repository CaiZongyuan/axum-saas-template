import { useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  listNotifications,
  readNotification,
  type ApiClient,
  type CurrentSession,
  type Notification,
  type NotificationTarget,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import { Empty, EmptyHeader, EmptyTitle } from '@saas/ui/components/empty';
import { sessionKey, sessionQuery } from '../identity';

function Failure({ error }: { error: unknown }) {
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>通知操作未完成</AlertTitle>
      <AlertDescription>
        暂时无法读取或更新通知，请刷新重试。{id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
export type NotificationTargetResolver = (
  target: NotificationTarget,
) => (() => void) | undefined;
export function NotificationsView({
  apiClient,
  onBack,
  resolveTarget,
}: {
  apiClient: ApiClient;
  onBack: () => void;
  resolveTarget?: NotificationTargetResolver;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">通知</h1>
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
        <Inbox
          key={session.data.user.id}
          apiClient={apiClient}
          identity={session.data}
          resolveTarget={resolveTarget}
        />
      )}
    </main>
  );
}
function Inbox({
  apiClient,
  identity,
  resolveTarget,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  resolveTarget?: NotificationTargetResolver;
}) {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inboxKey = [
    'notifications',
    apiClient.getConfig().baseUrl,
    identity.user.id,
  ];
  const queryKey = [...inboxKey, unreadOnly];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) =>
      (
        await listNotifications({
          client: apiClient,
          query: { limit: 20, cursor: pageParam, unread_only: unreadOnly },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 5,
    retry: false,
  });
  const read = useMutation({
    mutationFn: async ({ notice }: { notice: Notification }) =>
      (
        await readNotification({
          client: apiClient,
          path: { id: notice.id },
          headers: { 'x-csrf-token': identity.csrf_token },
          throwOnError: true,
        })
      ).data,
    retry: false,
    onError: (error) => {
      if (
        error &&
        typeof error === 'object' &&
        'error' in error &&
        (error.error as { code?: string }).code === 'auth.unauthorized'
      ) {
        void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
      }
    },
    onSuccess: async () => {
      await queryClient.resetQueries({ queryKey: inboxKey });
    },
  });
  const items = query.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p>{query.data?.pages.at(-1)?.unread_count ?? 0} 条未读</p>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            read.reset();
            void queryClient.resetQueries({ queryKey, exact: true });
          }}
        >
          刷新通知
        </Button>
        <Button
          variant={unreadOnly ? 'secondary' : 'outline'}
          aria-pressed={unreadOnly}
          onClick={() => {
            read.reset();
            setUnreadOnly((value) => !value);
          }}
        >
          只看未读
        </Button>
      </div>
      {query.isPending ? (
        <p role="status">正在读取通知…</p>
      ) : query.isError ? (
        <Failure error={query.error} />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{unreadOnly ? '暂无未读通知' : '暂无通知'}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {read.isError ? <Failure error={read.error} /> : null}
      {!query.isError ? (
        <ul className="flex flex-col gap-3">
          {items.map((notice) => {
            const open = resolveTarget?.(notice.target);
            return (
              <li
                key={notice.id}
                className="flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-semibold">
                    {notice.subject}
                    {notice.outcome === 'succeeded' ? '完成' : '失败'}
                  </h2>
                  <Badge variant={notice.read_at ? 'outline' : 'secondary'}>
                    {notice.read_at ? '已读' : '未读'}
                  </Badge>
                </div>
                <time
                  className="text-sm text-muted-foreground"
                  dateTime={notice.created_at}
                >
                  {new Date(notice.created_at).toLocaleString()}
                </time>
                <div className="flex flex-wrap items-center gap-3">
                  {open ? (
                    <Button
                      disabled={read.isPending}
                      onClick={() => {
                        // Observer callbacks stop on unmount; a late read must not override navigation.
                        read.mutate({ notice }, { onSuccess: open });
                      }}
                    >
                      查看结果
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      此通知的功能当前不可用。
                    </p>
                  )}
                  {!notice.read_at ? (
                    <Button
                      variant="outline"
                      disabled={read.isPending}
                      onClick={() => {
                        read.mutate({ notice });
                      }}
                    >
                      标记已读
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          加载更多通知
        </Button>
      ) : null}
    </>
  );
}
