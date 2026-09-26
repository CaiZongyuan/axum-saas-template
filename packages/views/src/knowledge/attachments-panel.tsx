import { RateLimitHint } from '../system/rate-limit';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  completeAttachmentUpload,
  getAttachmentDownload,
  listAttachments,
  startAttachmentUpload,
  type ApiClient,
  type CurrentSession,
  type FileInfo,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertTitle, AlertDescription } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import { Empty, EmptyHeader, EmptyTitle } from '@saas/ui/components/empty';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { Progress } from '@saas/ui/components/progress';
import type { FileTransfer } from './file-transfer';
import { DeleteResource } from './delete-resource';
import { sessionKey } from '../identity';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type Phase =
  'idle' | 'hashing' | 'uploading' | 'completing' | 'done' | 'failed';
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'error' in error
    ? (error.error as { code?: string }).code
    : undefined;
}
function Failure({ error }: { error: unknown }) {
  const messages: Record<string, string> = {
    'files.too_large': '文件超过上传上限，请选择较小的文件。',
    'files.upload_expired': '上传已过期，请重新上传。',
    'files.upload_rejected': '文件校验失败，请重新选择文件或重新上传。',
    'files.invalid_input': '文件名、类型或校验信息无效，请重新选择。',
    'knowledge.forbidden': '上传权限已失效，无法继续完成附件。',
    'knowledge.not_found': '文档不存在或访问权限已失效。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>附件操作未完成</AlertTitle>
      <AlertDescription>
        {messages[code(error) ?? ''] ?? '上传失败或下载暂时不可用，请重试。'}
        <RateLimitHint error={error} />
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

export function AttachmentsPanel({
  apiClient,
  identity,
  documentId,
  canEdit,
  transfer,
  onInsert,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  documentId: string;
  canEdit: boolean;
  transfer: FileTransfer;
  onInsert?: (markdown: string) => void;
}) {
  const queryClient = useQueryClient();
  const attachments = useInfiniteQuery({
    queryKey: ['knowledge', 'attachments', identity.user.id, documentId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listAttachments({
          client: apiClient,
          path: { id: documentId },
          query: { cursor: pageParam, limit: 50 },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 10,
    retry: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>();
  const [denied, setDenied] = useState(false);
  const [downloading, setDownloading] = useState<string>();
  const attempt = useRef<{ file: File; key: string; sha256?: string } | null>(
    null,
  );
  const uploadAbort = useRef<AbortController | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadAbort.current?.abort();
      downloadAbort.current?.abort();
    };
  }, []);
  const busy =
    phase === 'hashing' || phase === 'uploading' || phase === 'completing';
  const canUpload =
    canEdit &&
    !!attachments.data?.pages[0]?.can_upload &&
    !attachments.isError &&
    !denied;
  const serverCanDelete = attachments.data?.pages[0]?.can_delete;
  const canDelete =
    canEdit && serverCanDelete === true && !attachments.isError && !denied;
  const accessError = code(attachments.error);
  useEffect(() => {
    if (
      (canEdit && serverCanDelete === false) ||
      [
        'knowledge.not_found',
        'knowledge.forbidden',
        'auth.unauthorized',
      ].includes(accessError ?? '')
    ) {
      void queryClient.invalidateQueries({
        queryKey: ['knowledge', 'document', identity.user.id, documentId],
      });
      if (accessError === 'auth.unauthorized')
        void queryClient.invalidateQueries({ queryKey: sessionKey(apiClient) });
    }
  }, [
    canEdit,
    serverCanDelete,
    accessError,
    queryClient,
    identity.user.id,
    documentId,
    apiClient,
  ]);
  const maxBytes = attachments.data?.pages[0]?.max_upload_bytes ?? 0;
  const items = attachments.data?.pages.flatMap((page) => page.data) ?? [];

  function reject(error: unknown) {
    if (!mounted.current) return;
    setError(error);
    if (
      [
        'knowledge.forbidden',
        'knowledge.not_found',
        'auth.unauthorized',
      ].includes(code(error) ?? '')
    ) {
      setDenied(true);
      void queryClient.invalidateQueries({
        queryKey: ['knowledge', 'document', identity.user.id, documentId],
      });
      void attachments.refetch();
    }
  }
  async function upload() {
    if (!file || busy || !canUpload) return;
    if (file.size > maxBytes) {
      setError({ error: { code: 'files.too_large' } });
      return;
    }
    if (attempt.current?.file !== file)
      attempt.current = { file, key: crypto.randomUUID() };
    const active = attempt.current;
    const controller = new AbortController();
    uploadAbort.current = controller;
    setError(undefined);
    setPhase('hashing');
    setProgress(0);
    try {
      active.sha256 ??= await transfer.hash(file, controller.signal);
      const upload = (
        await startAttachmentUpload({
          client: apiClient,
          path: { id: documentId },
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': active.key,
          },
          body: {
            file_name: file.name,
            content_type: file.type || 'application/octet-stream',
            size: file.size,
            sha256: active.sha256,
          },
          signal: controller.signal,
          throwOnError: true,
        })
      ).data;
      if (upload.upload) {
        setPhase('uploading');
        await transfer.upload(
          upload.upload,
          file,
          (value) => {
            if (mounted.current) setProgress(value);
          },
          controller.signal,
        );
      }
      controller.signal.throwIfAborted();
      setPhase('completing');
      setProgress(100);
      await completeAttachmentUpload({
        client: apiClient,
        path: { id: documentId, upload_id: upload.upload_id },
        headers: { 'x-csrf-token': identity.csrf_token },
        signal: controller.signal,
        throwOnError: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ['knowledge', 'attachments', identity.user.id, documentId],
      });
      if (mounted.current) {
        setPhase('done');
        setFile(null);
        attempt.current = null;
        if (input.current) input.current.value = '';
      }
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (
        ['files.upload_expired', 'files.upload_rejected'].includes(
          code(error) ?? '',
        )
      )
        attempt.current = null;
      setPhase('failed');
      reject(error);
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
    }
  }
  async function download(file: FileInfo) {
    if (downloadAbort.current) return;
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(file.id);
    setError(undefined);
    try {
      const capability = (
        await getAttachmentDownload({
          client: apiClient,
          path: { id: documentId, file_id: file.id },
          signal: controller.signal,
          throwOnError: true,
        })
      ).data;
      await transfer.download(capability, file, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) reject(error);
    } finally {
      downloadAbort.current = null;
      if (mounted.current) setDownloading(undefined);
    }
  }

  return (
    <section aria-label="文档附件" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">附件</h2>
      <Button
        variant="outline"
        disabled={attachments.isFetching}
        onClick={async () => {
          const refreshed = await attachments.refetch();
          if (refreshed.isSuccess)
            setDenied(!refreshed.data.pages[0]?.can_delete);
        }}
      >
        重新查询附件
      </Button>
      {attachments.isPending ? <p role="status">正在读取附件…</p> : null}
      {attachments.isError ? <Failure error={attachments.error} /> : null}
      {canEdit ? (
        <FieldGroup>
          <Field data-disabled={busy || !canUpload}>
            <FieldLabel htmlFor="attachment-file">选择附件</FieldLabel>
            <Input
              ref={input}
              id="attachment-file"
              type="file"
              disabled={busy || !canUpload}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
                attempt.current = null;
                setPhase('idle');
                setError(undefined);
              }}
            />
            <FieldDescription>
              上传后完成校验才会出现在附件列表。单文件上限{' '}
              {formatBytes(maxBytes)}。
            </FieldDescription>
          </Field>
          <Button
            disabled={!file || busy || !canUpload}
            onClick={() => {
              void upload();
            }}
          >
            {phase === 'failed' ? '重试上传' : '上传附件'}
          </Button>
        </FieldGroup>
      ) : null}
      {busy ? (
        <>
          <Progress aria-label="附件上传进度" value={progress} />
          <p role="status">
            {phase === 'hashing'
              ? '正在准备文件…'
              : phase === 'completing'
                ? '正在校验附件…'
                : `正在上传 ${progress}%`}
          </p>
        </>
      ) : null}
      {phase === 'done' ? <p role="status">上传完成</p> : null}
      {error ? <Failure error={error} /> : null}
      {!attachments.isPending && !attachments.isError && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无附件</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {!attachments.isError ? (
        <ul className="flex flex-col gap-3">
          {items.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3">
              <span>
                {file.file_name} · {formatBytes(file.size)}
              </span>
              <Button
                variant="outline"
                disabled={!!downloading}
                aria-label={`下载 ${file.file_name}`}
                onClick={() => {
                  void download(file);
                }}
              >
                {downloading === file.id ? '正在下载…' : '下载'}
              </Button>
              {canDelete ? (
                <DeleteResource
                  apiClient={apiClient}
                  identity={identity}
                  resource={{
                    kind: 'attachment',
                    id: file.id,
                    documentId,
                    name: file.file_name,
                  }}
                  disabled={busy || !!downloading}
                />
              ) : null}
              {onInsert && canUpload ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    const label = file.file_name.replace(/[\\[\]]/g, '\\$&');
                    onInsert(
                      `${file.previewable ? '!' : ''}[${label}](attachment:${file.id})`,
                    );
                  }}
                >
                  插入引用
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.hasNextPage ? (
        <Button
          variant="outline"
          disabled={attachments.isFetching}
          onClick={() => {
            void attachments.fetchNextPage();
          }}
        >
          加载更多附件
        </Button>
      ) : null}
    </section>
  );
}
