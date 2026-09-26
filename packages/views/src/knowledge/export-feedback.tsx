import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';

export const exportPending = new Set(['queued', 'running', 'retry_wait']);
export const exportLabels: Record<string, string> = {
  queued: '等待处理',
  running: '正在生成',
  retry_wait: '等待重试',
  succeeded: '导出完成',
  failed: '导出失败',
  expired: '已过期',
};
export function exportErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'error' in error
    ? (error.error as { code?: string }).code
    : undefined;
}
export function ExportFailure({ error }: { error: unknown }) {
  const code = exportErrorCode(error);
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
