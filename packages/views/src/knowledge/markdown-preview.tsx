import { lazy, Suspense } from 'react';
import {
  AttachmentContext,
  type AttachmentContextValue,
} from './attachment-markdown';

const MarkdownContent = lazy(() => import('./markdown-content'));

export function MarkdownPreview({
  markdown,
  attachments,
}: {
  markdown: string;
  attachments?: AttachmentContextValue;
}) {
  return (
    <Suspense fallback={<p role="status">正在准备预览…</p>}>
      <AttachmentContext.Provider value={attachments ?? null}>
        <MarkdownContent markdown={markdown} />
      </AttachmentContext.Provider>
    </Suspense>
  );
}
