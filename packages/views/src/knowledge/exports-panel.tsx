import { useEffect, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  downloadDocumentExport,
  listDocumentExports,
  requestDocumentExport,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import type { FileTransfer } from './file-transfer';
import { sessionKey } from '../identity/session';

const pending = new Set(['queued', 'running', 'retry_wait']);
const labels: Record<string, string> = {
  queued: '等待处理',
  running: '正在生成',
  retry_wait: '等待重试',
  succeeded: '导出完成',
  failed: '导出失败',
  expired: '已过期',
};
function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'error' in error
    ? (error.error as { code?: string }).code
    : undefined;
}
function Failure({ error }: { error: unknown }) {
  const code = errorCode(error);
  const messages: Record<string, string> = {
    'knowledge.export_too_large': '文档和附件超过导出上限。',
    'knowledge.export_expired': '导出已过期，请重新申请。',
    'knowledge.export_not_ready': '导出尚未完成，请刷新进度。',
    'knowledge.not_found': '文档不存在或访问权限已失效。',
    'knowledge.forbidden': '当前无权操作这份文档。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>导出操作未完成</AlertTitle>
      <AlertDescription>
        {messages[code ?? ''] ?? '暂时无法处理，请重试。'}
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

export function ExportsPanel({
  apiClient,
  identity,
  documentId,
  transfer,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  documentId: string;
  transfer: FileTransfer;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['knowledge', 'exports', identity.user.id, documentId];
  const exports = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listDocumentExports({
          client: apiClient,
          path: { id: documentId },
          query: { cursor: pageParam, limit: 20 },
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
        page.data.some((item) => pending.has(item.status)),
      )
        ? 1500
        : false,
  });
  function refreshAccess(error: unknown) {
    const code = errorCode(error);
    if (
      [
        'knowledge.forbidden',
        'knowledge.not_found',
        'auth.unauthorized',
      ].includes(code ?? '')
    ) {
      for (const resource of ['document', 'attachments', 'exports']) {
        void queryClient.invalidateQueries({
          queryKey: ['knowledge', resource, identity.user.id, documentId],
        });
      }
      if (code === 'auth.unauthorized')
        void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
    }
  }
  const key = useRef(crypto.randomUUID());
  const create = useMutation({
    mutationFn: async () =>
      (
        await requestDocumentExport({
          client: apiClient,
          path: { id: documentId },
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': key.current,
          },
          signal: AbortSignal.timeout(10_000),
          throwOnError: true,
        })
      ).data,
    retry: false,
    onError: refreshAccess,
    onSuccess: async () => {
      key.current = crypto.randomUUID();
      await queryClient.resetQueries({ queryKey, exact: true });
    },
  });
  const [error, setError] = useState<unknown>();
  const [downloading, setDownloading] = useState<string>();
  const downloadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => downloadAbort.current?.abort(), []);
  async function download(exportId: string) {
    if (downloadAbort.current) return;
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(exportId);
    setError(undefined);
    try {
      const capability = (
        await downloadDocumentExport({
          client: apiClient,
          path: { id: documentId, export_id: exportId },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
          throwOnError: true,
        })
      ).data;
      await transfer.download(capability, capability.file, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error);
        refreshAccess(error);
        void exports.refetch();
      }
    } finally {
      downloadAbort.current = null;
      if (!controller.signal.aborted) setDownloading(undefined);
    }
  }
  const items = exports.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section aria-label="文档导出" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">导出文档</h2>
      <p className="text-sm text-muted-foreground">
        保存申请时的正文和附件为 ZIP。之后编辑文档不会改变这份导出。
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={create.isPending || exports.isPending || exports.isError}
          onClick={() => {
            setError(undefined);
            create.mutate();
          }}
        >
          {create.isPending
            ? '正在申请…'
            : create.isError
              ? '重试申请导出'
              : '导出当前文档'}
        </Button>
        <Button
          variant="outline"
          disabled={exports.isFetching}
          onClick={() => {
            void exports.refetch();
          }}
        >
          刷新导出状态
        </Button>
      </div>
      {exports.isPending ? <p role="status">正在读取导出记录…</p> : null}
      {exports.isError ? <Failure error={exports.error} /> : null}
      {create.isError ? <Failure error={create.error} /> : null}
      {error ? <Failure error={error} /> : null}
      {!exports.isPending && !exports.isError && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无导出记录。</p>
      ) : null}
      {!exports.isError ? (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-4"
            >
              <span>版本 {item.document_version}</span>
              <Badge
                variant={item.status === 'failed' ? 'destructive' : 'secondary'}
              >
                {labels[item.status] ?? '状态更新中'}
              </Badge>
              {item.status === 'failed' ? (
                <span className="text-sm">本次导出未完成，可重新申请。</span>
              ) : null}
              <span className="text-sm text-muted-foreground">
                有效期至 {new Date(item.expires_at).toLocaleString()}
              </span>
              {item.can_download ? (
                <Button
                  variant="outline"
                  disabled={!!downloading}
                  onClick={() => {
                    void download(item.id);
                  }}
                >
                  {downloading === item.id ? '正在下载…' : '下载 ZIP'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {exports.hasNextPage ? (
        <Button
          variant="outline"
          disabled={exports.isFetching}
          onClick={() => {
            void exports.fetchNextPage();
          }}
        >
          加载更多导出
        </Button>
      ) : null}
    </section>
  );
}
