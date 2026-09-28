import { lazy, Suspense } from 'react';
import {
  AttachmentContext,
  type AttachmentContextValue,
} from './attachment-markdown';
import { useAppMessage } from '../shell/messages';

const MarkdownContent = lazy(() => import('./markdown-content'));

export function MarkdownPreview({
  markdown,
  attachments,
}: {
  markdown: string;
  attachments?: AttachmentContextValue;
}) {
  const message = useAppMessage('knowledge');
  return (
    <Suspense fallback={<p role="status">{message('reader.preparing')}</p>}>
      <AttachmentContext.Provider value={attachments ?? null}>
        <MarkdownContent markdown={markdown} />
      </AttachmentContext.Provider>
    </Suspense>
  );
}
