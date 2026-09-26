import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDocumentExport,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { sessionQuery } from '../identity';
import { ExportFailure, exportLabels, exportPending } from './export-feedback';
import { useExportDownload } from './export-download';
import type { FileTransfer } from './file-transfer';

export function DocumentExportView({
  apiClient,
  documentId,
  exportId,
  transfer,
  onBack,
}: {
  apiClient: ApiClient;
  documentId: string;
  exportId: string;
  transfer: FileTransfer;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, client));
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">导出详情</h1>
        <Button variant="link" onClick={onBack}>
          返回通知
        </Button>
      </header>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <ExportFailure error={session.error} />
      ) : !session.data ? (
        <p>请先登录。</p>
      ) : (
        <Result
          key={`${session.data.user.id}:${documentId}:${exportId}`}
          apiClient={apiClient}
          identity={session.data}
          documentId={documentId}
          exportId={exportId}
          transfer={transfer}
        />
      )}
    </main>
  );
}
function Result({
  apiClient,
  identity,
  documentId,
  exportId,
  transfer,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  documentId: string;
  exportId: string;
  transfer: FileTransfer;
}) {
  const result = useQuery({
    queryKey: ['knowledge', 'export', identity.user.id, documentId, exportId],
    queryFn: async ({ signal }) =>
      (
        await getDocumentExport({
          client: apiClient,
          path: { id: documentId, export_id: exportId },
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
    refetchInterval: (query) =>
      !query.state.error && exportPending.has(query.state.data?.status ?? '')
        ? 1500
        : false,
  });
  const { error, clearError, downloading, download } = useExportDownload({
    apiClient,
    documentId,
    transfer,
    onFailure: () => {
      void result.refetch();
    },
  });
  const item = result.data;
  return (
    <>
      <Button
        variant="outline"
        disabled={result.isFetching}
        onClick={() => {
          clearError();
          void result.refetch();
        }}
      >
        刷新导出状态
      </Button>
      {result.isPending ? (
        <p role="status">正在读取导出结果…</p>
      ) : result.isError ? (
        <ExportFailure error={result.error} />
      ) : item ? (
        <Card>
          <CardHeader>
            <CardTitle>版本 {item.document_version}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <Badge
                variant={item.status === 'failed' ? 'destructive' : 'secondary'}
              >
                {exportLabels[item.status] ?? '状态更新中'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              有效期至 {new Date(item.expires_at).toLocaleString()}
            </p>
            {item.status === 'failed' || item.status === 'expired' ? (
              <p>可回到文档重新申请导出。</p>
            ) : null}
            {item.can_download ? (
              <Button
                disabled={!!downloading}
                onClick={() => {
                  void download(exportId);
                }}
              >
                {downloading ? '正在下载…' : '下载 ZIP'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {error ? <ExportFailure error={error} /> : null}
    </>
  );
}
