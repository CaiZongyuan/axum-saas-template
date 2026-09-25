import { lazy, Suspense } from 'react';

const MarkdownContent = lazy(() => import('./markdown-content'));

export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <Suspense fallback={<p role="status">正在准备预览…</p>}>
      <MarkdownContent markdown={markdown} />
    </Suspense>
  );
}
