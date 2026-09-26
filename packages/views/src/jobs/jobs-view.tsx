import { useRef, useState, type ReactNode } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getJob,
  listJobs,
  retryJob,
  type ApiClient,
  type CurrentSession,
  type JobInfo,
  type ListJobsData,
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
import { Field, FieldLabel } from '@saas/ui/components/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import { sessionKey, sessionQuery } from '../identity';

type StatusFilter = NonNullable<NonNullable<ListJobsData['query']>['status']>;
const names: Record<string, string> = {
  queued: '等待处理',
  running: '执行中',
  retry_wait: '等待重试',
  succeeded: '已完成',
  failed: '已失败',
  lease_expired: '租约已过期',
};
const active = new Set(['queued', 'running', 'retry_wait']);
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'error' in error
    ? (error.error as { code?: string }).code
    : undefined;
}
function Failure({ error }: { error: unknown }) {
  const messages: Record<string, string> = {
    'jobs.forbidden': '仅企业所有者或管理员可以管理后台任务。',
    'jobs.not_failed': '任务状态已改变，请重新读取；只有失败任务可以重试。',
    'jobs.not_found': '任务不存在。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>任务操作未完成</AlertTitle>
      <AlertDescription>
        {messages[code(error) ?? ''] ?? '暂时无法完成，请重试。'}
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
function Frame({
  apiClient,
  title,
  onBack,
  children,
}: {
  apiClient: ApiClient;
  title: string;
  onBack: () => void;
  children: (identity: CurrentSession) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Button variant="link" onClick={onBack}>
          返回
        </Button>
      </header>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <Failure error={session.error} />
      ) : !session.data ? (
        <p>请先登录。</p>
      ) : session.data.user.role === 'member' ? (
        <p>仅企业所有者或管理员可以管理后台任务。</p>
      ) : (
        children(session.data)
      )}
    </main>
  );
}
export function JobsView({
  apiClient,
  onBack,
  onOpenJob,
}: {
  apiClient: ApiClient;
  onBack: () => void;
  onOpenJob: (id: string) => void;
}) {
  return (
    <Frame apiClient={apiClient} title="后台任务" onBack={onBack}>
      {(identity) => (
        <JobList
          key={identity.user.id}
          apiClient={apiClient}
          identity={identity}
          onOpenJob={onOpenJob}
        />
      )}
    </Frame>
  );
}
function JobList({
  apiClient,
  identity,
  onOpenJob,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onOpenJob: (id: string) => void;
}) {
  const [filter, setFilter] = useState<StatusFilter | ''>('failed');
  const queryClient = useQueryClient();
  const queryKey = ['jobs', 'list', identity.user.id, filter];
  const jobs = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listJobs({
          client: apiClient,
          query: { status: filter || undefined, limit: 20, cursor: pageParam },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 5,
    retry: false,
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.pages.some((page) =>
        page.data.some((job) => active.has(job.status)),
      )
        ? 2000
        : false,
  });
  return (
    <>
      <p>查看执行状态、错误摘要和尝试历史，再决定是否重新执行失败任务。</p>
      <Field>
        <FieldLabel htmlFor="job-status">任务状态</FieldLabel>
        <NativeSelect
          id="job-status"
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as StatusFilter | '')
          }
        >
          <NativeSelectOption value="">全部状态</NativeSelectOption>
          {['failed', 'queued', 'running', 'retry_wait', 'succeeded'].map(
            (status) => (
              <NativeSelectOption key={status} value={status}>
                {names[status]}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      </Field>
      <Button
        variant="outline"
        disabled={jobs.isFetching}
        onClick={() => {
          void queryClient.resetQueries({ queryKey, exact: true });
        }}
      >
        刷新任务列表
      </Button>
      {jobs.isPending ? <p role="status">正在读取任务…</p> : null}
      {jobs.isError ? <Failure error={jobs.error} /> : null}
      {!jobs.isPending &&
      !jobs.isError &&
      jobs.data.pages.every((page) => page.data.length === 0) ? (
        <p>当前没有符合条件的任务。</p>
      ) : null}
      {!jobs.isError
        ? jobs.data?.pages.flatMap((page) =>
            page.data.map((job) => (
              <Card key={job.id}>
                <CardHeader>
                  <CardTitle>{job.kind}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Badge
                    variant={
                      job.status === 'failed' ? 'destructive' : 'secondary'
                    }
                  >
                    {names[job.status] ?? job.status}
                  </Badge>
                  <p className="break-all text-sm">任务编号：{job.id}</p>
                  <p>
                    第 {job.batch} 批 · 已尝试 {job.attempts} /{' '}
                    {job.max_attempts} 次
                  </p>
                  {job.last_error ? (
                    <p className="break-all text-sm">
                      错误摘要：{job.last_error}
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    aria-label={`查看任务 ${job.id}`}
                    onClick={() => onOpenJob(job.id)}
                  >
                    查看记录
                  </Button>
                </CardContent>
              </Card>
            )),
          )
        : null}
      {jobs.hasNextPage ? (
        <Button
          variant="outline"
          disabled={jobs.isFetching}
          onClick={() => {
            void jobs.fetchNextPage();
          }}
        >
          加载更多任务
        </Button>
      ) : null}
    </>
  );
}
export function JobView({
  apiClient,
  jobId,
  onBack,
}: {
  apiClient: ApiClient;
  jobId: string;
  onBack: () => void;
}) {
  return (
    <Frame apiClient={apiClient} title="任务详情" onBack={onBack}>
      {(identity) => (
        <JobRecord
          key={`${identity.user.id}:${jobId}`}
          apiClient={apiClient}
          identity={identity}
          jobId={jobId}
        />
      )}
    </Frame>
  );
}
function JobRecord({
  apiClient,
  identity,
  jobId,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  jobId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['jobs', 'detail', identity.user.id, jobId];
  const requestKey = useRef(crypto.randomUUID());
  const details = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await getJob({
          client: apiClient,
          path: { id: jobId },
          query: { before_batch: pageParam },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_before_batch ?? undefined,
    maxPages: 5,
    retry: false,
    refetchInterval: (query) =>
      !query.state.error &&
      active.has(query.state.data?.pages[0]?.job.status ?? '')
        ? 2000
        : false,
  });
  const retry = useMutation({
    mutationFn: async () =>
      (
        await retryJob({
          client: apiClient,
          path: { id: jobId },
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': requestKey.current,
          },
          signal: AbortSignal.timeout(10_000),
          throwOnError: true,
        })
      ).data,
    retry: false,
    onSuccess: async () => {
      requestKey.current = crypto.randomUUID();
      await queryClient.resetQueries({ queryKey, exact: true });
      void queryClient.invalidateQueries({
        queryKey: ['jobs', 'list', identity.user.id],
      });
    },
    onError: (error) => {
      if (
        [
          'jobs.forbidden',
          'jobs.not_found',
          'jobs.not_failed',
          'auth.unauthorized',
        ].includes(code(error) ?? '')
      ) {
        void queryClient.invalidateQueries({ queryKey: ['jobs'] });
        void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
      }
    },
  });
  const job = details.data?.pages[0]?.job;
  return (
    <>
      <Button
        variant="outline"
        disabled={details.isFetching}
        onClick={() => {
          void queryClient.resetQueries({ queryKey, exact: true });
        }}
      >
        刷新任务记录
      </Button>
      {details.isPending ? <p role="status">正在读取执行记录…</p> : null}
      {details.isError ? <Failure error={details.error} /> : null}
      {retry.isError ? <Failure error={retry.error} /> : null}
      {job && !details.isError ? (
        <>
          <JobSummary job={job} />
          {job.can_retry ? (
            <section className="flex flex-col gap-3">
              <p>
                保持原任务和业务请求，开启最多 {job.max_attempts}{' '}
                次尝试的新批次。仍会检查原请求者的权限和源资源。
              </p>
              <Button
                disabled={retry.isPending || details.isFetching}
                onClick={() => retry.mutate()}
              >
                {retry.isPending ? '正在提交…' : '重试失败任务'}
              </Button>
            </section>
          ) : null}
          <h2 className="text-xl font-semibold">执行历史</h2>
          {details.data?.pages.flatMap((page) =>
            page.batches.map((batch) => (
              <Card key={batch.number}>
                <CardHeader>
                  <CardTitle>第 {batch.number} 批</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p>
                    {names[batch.status] ?? batch.status} · {batch.attempts} /{' '}
                    {batch.max_attempts} 次
                  </p>
                  {batch.legacy_attempts > 0 ? (
                    <p>升级前 {batch.legacy_attempts} 次尝试仅保留汇总。</p>
                  ) : null}
                  <ul className="flex flex-col gap-2">
                    {page.attempts
                      .filter((attempt) => attempt.batch === batch.number)
                      .map((attempt) => (
                        <li
                          key={attempt.number}
                          className="rounded-lg border p-3"
                        >
                          <p>
                            第 {attempt.number} 次 ·{' '}
                            {names[attempt.status] ?? attempt.status}
                          </p>
                          <p className="text-sm">
                            {new Date(attempt.started_at).toLocaleString()}
                          </p>
                          {attempt.last_error ? (
                            <p className="break-all text-sm">
                              {attempt.last_error}
                            </p>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </CardContent>
              </Card>
            )),
          )}
        </>
      ) : null}
      {details.hasNextPage ? (
        <Button
          variant="outline"
          disabled={details.isFetching}
          onClick={() => {
            void details.fetchNextPage();
          }}
        >
          读取更早批次
        </Button>
      ) : null}
    </>
  );
}
function JobSummary({ job }: { job: JobInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{job.kind}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>
          {names[job.status] ?? job.status}
        </Badge>
        <p className="break-all text-sm">任务编号：{job.id}</p>
        <p>
          当前第 {job.batch} 批 · 已尝试 {job.attempts} / {job.max_attempts} 次
        </p>
        <p className="break-all text-sm">关联请求：{job.correlation_id}</p>
        {job.last_error ? (
          <p className="break-all text-sm">当前错误摘要：{job.last_error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
