import { RateLimitHint } from '../system/rate-limit';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteAttachment,
  deleteDocument,
  deleteKnowledgeBase,
  type ApiClient,
  type CurrentSession,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@saas/ui/components/alert-dialog';
import { Button } from '@saas/ui/components/button';
import { sessionKey } from '../identity';

type Resource =
  | { kind: 'document'; id: string; name: string }
  | { kind: 'base'; id: string; name: string; personal: boolean }
  | { kind: 'attachment'; id: string; documentId: string; name: string };
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'error' in error
    ? (error.error as { code?: string }).code
    : undefined;
}

export function DeleteResource({
  apiClient,
  identity,
  resource,
  onDeleted,
  disabled = false,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  resource: Resource;
  onDeleted?: () => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentActor = () =>
    queryClient.getQueryData<CurrentSession | null>(sessionKey(apiClient))?.user
      .id === identity.user.id;
  const mutation = useMutation({
    mutationFn: async () => {
      const options = {
        client: apiClient,
        headers: { 'x-csrf-token': identity.csrf_token },
        signal: AbortSignal.timeout(10_000),
        throwOnError: true as const,
      };
      if (resource.kind === 'document')
        await deleteDocument({ ...options, path: { id: resource.id } });
      else if (resource.kind === 'base')
        await deleteKnowledgeBase({ ...options, path: { id: resource.id } });
      else
        await deleteAttachment({
          ...options,
          path: { id: resource.documentId, file_id: resource.id },
        });
    },
    retry: false,
    onSuccess: async () => {
      if (!currentActor()) return;
      if (mounted.current) {
        setOpen(false);
        onDeleted?.();
      }
      if (resource.kind === 'attachment') {
        // Refresh attachment visibility without resetting an unsaved Markdown form.
        await Promise.all(
          ['attachments', 'attachment-preview'].map((kind) =>
            queryClient.resetQueries({
              queryKey: [
                'knowledge',
                kind,
                identity.user.id,
                resource.documentId,
              ],
            }),
          ),
        );
      } else await queryClient.resetQueries({ queryKey: ['knowledge'] });
    },
    onError: (error) => {
      if (!currentActor()) return;
      if (
        [
          'knowledge.not_found',
          'knowledge.forbidden',
          'auth.unauthorized',
        ].includes(code(error) ?? '')
      ) {
        void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
        if (code(error) === 'auth.unauthorized')
          void queryClient.invalidateQueries({
            queryKey: sessionKey(apiClient),
          });
      }
    },
  });
  const label =
    resource.kind === 'document'
      ? '删除文档'
      : resource.kind === 'base'
        ? '删除知识库'
        : `删除附件 ${resource.name}`;
  const messages: Record<string, string> = {
    'knowledge.not_found': '资源不存在，或你已失去访问权限。',
    'knowledge.forbidden': '当前没有删除权限。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const requestId = requestIdFromError(mutation.error);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next, event) => {
        if (!next && mutation.isPending) event.cancel();
        else {
          setOpen(next);
          if (next) mutation.reset();
        }
      }}
    >
      <AlertDialogTrigger
        disabled={disabled}
        render={<Button variant="destructive" />}
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除“{resource.name}”？</AlertDialogTitle>
          <AlertDialogDescription>
            {resource.kind === 'attachment'
              ? '正文中的附件引用将失效。'
              : resource.kind === 'document'
                ? '文档、附件和导出将无法访问。'
                : '整个知识库的文档、附件和导出将无法访问。'}
            {resource.kind === 'base' && resource.personal
              ? '个人知识库删除后不会自动重建。'
              : ''}
            删除后无法恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>删除未完成</AlertTitle>
            <AlertDescription>
              {messages[code(mutation.error) ?? ''] ??
                '暂时无法删除，请重试或刷新查看最新状态。'}
              <RateLimitHint error={mutation.error} />
              {requestId ? <p>请求编号：{requestId}</p> : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending || disabled}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '正在删除…' : '确认删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
