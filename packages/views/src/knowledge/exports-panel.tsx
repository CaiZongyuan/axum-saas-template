import { useRef } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  listDocumentExports,
  requestDocumentExport,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import type { FileTransfer } from './file-transfer';
import { useExportDownload } from './export-download';
import {
  ExportFailure,
  exportLabels,
  exportPending,
  exportErrorCode,
} from './export-feedback';
import { sessionKey } from '../identity/session';

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
        page.data.some((item) => exportPending.has(item.status)),
      )
        ? 1500
        : false,
  });
  function refreshAccess(error: unknown) {
    const code = exportErrorCode(error);
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
  const { error, clearError, downloading, download } = useExportDownload({
    apiClient,
    documentId,
    transfer,
    onFailure: (error) => {
      refreshAccess(error);
      void exports.refetch();
    },
  });
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
            clearError();
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
      {exports.isError ? <ExportFailure error={exports.error} /> : null}
      {create.isError ? <ExportFailure error={create.error} /> : null}
      {error ? <ExportFailure error={error} /> : null}
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
                {exportLabels[item.status] ?? '状态更新中'}
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
