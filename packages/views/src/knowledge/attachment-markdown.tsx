import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAttachmentDownload, type ApiClient } from '@saas/sdk';
import { Button } from '@saas/ui/components/button';
import type { FileTransfer } from './file-transfer';

export type AttachmentContextValue = {
  apiClient: ApiClient;
  userId: string;
  documentId: string;
  transfer: FileTransfer;
};
export const AttachmentContext = createContext<AttachmentContextValue | null>(
  null,
);
export function attachmentId(url: string | undefined): string | undefined {
  return /^attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    url ?? '',
  )?.[1];
}

export function AttachmentImage({ id, alt }: { id: string; alt: string }) {
  const context = useContext(AttachmentContext);
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === 'undefined',
  );
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (visible || !element.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [visible]);
  const download = useQuery({
    queryKey: [
      'knowledge',
      'attachment-preview',
      context?.userId,
      context?.documentId,
      id,
    ],
    enabled: !!context && visible,
    queryFn: async ({ signal }) =>
      (
        await getAttachmentDownload({
          client: context!.apiClient,
          path: { id: context!.documentId, file_id: id },
          query: { inline: true },
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
  });
  return (
    <span ref={element}>
      {!context ? (
        `附件图片：${alt}`
      ) : download.isError || imageFailed ? (
        <Button
          variant="link"
          disabled={download.isFetching}
          onClick={async () => {
            const refreshed = await download.refetch();
            if (refreshed.isSuccess) setImageFailed(false);
          }}
        >
          重新读取图片：{alt}
        </Button>
      ) : download.data?.file.previewable ? (
        <img
          src={download.data.url}
          alt={alt}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="max-w-full rounded-md"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>附件图片：{alt}</span>
      )}
    </span>
  );
}

export function AttachmentLink({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const context = useContext(AttachmentContext);
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (!context || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setFailed(false);
    try {
      const capability = (
        await getAttachmentDownload({
          client: context.apiClient,
          path: { id: context.documentId, file_id: id },
          signal: request.signal,
          throwOnError: true,
        })
      ).data;
      await context.transfer.download(
        capability,
        capability.file,
        request.signal,
      );
    } catch {
      if (!request.signal.aborted) setFailed(true);
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }
  if (!context) return <span>{children}</span>;
  return (
    <span>
      <Button
        variant="link"
        disabled={pending}
        onClick={() => {
          void download();
        }}
      >
        {children}
        {pending ? '（正在下载）' : ''}
      </Button>
      {failed ? <span role="status"> 下载失败，请重试。</span> : null}
    </span>
  );
}
