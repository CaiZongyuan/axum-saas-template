import { useRef, useState, type ReactNode } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  createDocument,
  getDocument,
  listPersonalDocuments,
  type ApiClient,
  type CurrentSession,
  type CreateDocument,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas/ui/components/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@saas/ui/components/field';
import { Input } from '@saas/ui/components/input';
import { Textarea } from '@saas/ui/components/textarea';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@saas/ui/components/tabs';
import { sessionKey, sessionQuery } from '../identity';
import { MarkdownPreview } from './markdown-preview';

function Failure({ error }: { error: unknown }) {
  const code =
    error && typeof error === 'object' && 'error' in error
      ? (error.error as { code?: string })?.code
      : undefined;
  const messages: Record<string, string> = {
    'knowledge.forbidden': '没有写入权限，请联系企业管理员。',
    'knowledge.not_found': '文档不存在，或你已失去访问权限。',
    'knowledge.invalid_search': '搜索词最多 200 个字符，且不能包含无效字符。',
    'knowledge.invalid_page': '分页已失效，请重新查询。',
    'knowledge.invalid_title': '请填写不超过 200 个字符的标题。',
    'knowledge.too_large': '正文超过大小上限，请缩减后重试。',
    'knowledge.invalid_text': '粘贴的内容包含无效字符，请清理后重试。',
    'idempotency.conflict': '这次保存的请求已用于其他内容，请重新保存。',
    'auth.unauthorized': '会话已失效，请重新登录。',
    'auth.csrf': '会话已变化，请刷新会话后重试。',
  };
  const requestId = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>
        {messages[code ?? ''] ?? '服务暂时不可用，请稍后重试。'}
        {requestId ? <p>请求编号：{requestId}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

function IdentityGate({
  session,
  children,
}: {
  session: UseQueryResult<CurrentSession | null>;
  children: ReactNode;
}) {
  if (session.isPending) return <p role="status">正在读取会话…</p>;
  if (session.isError && !session.data)
    return <Failure error={session.error} />;
  if (!session.data)
    return (
      <p>
        请先
        <a href="/login" className="underline">
          登录
        </a>
        ，再访问文档。
      </p>
    );
  return (
    <>
      {session.isError ? <Failure error={session.error} /> : null}
      <div hidden={session.isError}>{children}</div>
    </>
  );
}

function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function DocumentsView({
  apiClient,
  onNew,
  onOpen,
}: {
  apiClient: ApiClient;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <Page
      title="我的文档"
      actions={session.data ? <Button onClick={onNew}>新建文档</Button> : null}
    >
      <IdentityGate session={session}>
        {session.data ? (
          <PersonalDocumentsList
            key={session.data.user.id}
            apiClient={apiClient}
            identity={session.data}
            onOpen={onOpen}
          />
        ) : null}
      </IdentityGate>
    </Page>
  );
}

function PersonalDocumentsList({
  apiClient,
  identity,
  onOpen,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const queryKey = [
    'knowledge',
    'documents',
    identity.user.id,
    { scope: 'personal', q: keyword },
  ];
  const documents = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listPersonalDocuments({
          client: apiClient,
          query: { cursor: pageParam, limit: 50, q: keyword },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 10,
    retry: false,
  });
  function search(next: string) {
    if (next === keyword) {
      void queryClient.resetQueries({ queryKey, exact: true });
    } else {
      queryClient.removeQueries({
        queryKey: [
          'knowledge',
          'documents',
          identity.user.id,
          { scope: 'personal', q: next },
        ],
        exact: true,
      });
      setKeyword(next);
    }
  }
  const items = documents.data?.pages.flatMap((page) => page.data) ?? [];
  const canShowResults = !documents.isError || documents.isFetchNextPageError;
  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          search(searchInput.current?.value.trim() ?? '');
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="document-search">标题关键词</FieldLabel>
            <Input
              ref={searchInput}
              id="document-search"
              name="q"
              maxLength={200}
            />
            <FieldDescription>
              最多 200 个字符，按标题字面查找。留空显示全部个人文档。
            </FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={documents.isFetching}>
              搜索
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (searchInput.current) searchInput.current.value = '';
                search('');
              }}
            >
              清除搜索
            </Button>
          </div>
        </FieldGroup>
      </form>
      {documents.isFetching && !documents.isFetchingNextPage ? (
        <p role="status">正在查询文档…</p>
      ) : null}
      {documents.isError ? <Failure error={documents.error} /> : null}
      {documents.isError && !documents.isFetchNextPageError ? (
        <Button variant="outline" onClick={() => search(keyword)}>
          重新查询
        </Button>
      ) : null}
      {!documents.isPending && canShowResults ? (
        items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>
                {keyword ? '没有匹配的文档' : '暂无可访问的文档'}
              </EmptyTitle>
              <EmptyDescription>
                {keyword
                  ? '换一个标题关键词，或清除搜索后重试。'
                  : '从一篇 Markdown 开始，记录你的知识。'}
              </EmptyDescription>
            </EmptyHeader>
            {!keyword ? (
              <EmptyContent>
                点击“新建文档”，填写标题和正文后保存。
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <>
            <p role="status">
              已显示 {items.length} 篇文档
              {keyword ? `，关键词：${keyword}` : ''}。
            </p>
            <ul className="flex flex-col gap-3">
              {items.map((document) => (
                <li key={document.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <Button
                          variant="link"
                          onClick={() => onOpen(document.id)}
                        >
                          {document.title}
                        </Button>
                      </CardTitle>
                      <CardDescription>
                        更新于 {new Date(document.updated_at).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
      {documents.hasNextPage && canShowResults ? (
        <Button
          variant="outline"
          disabled={documents.isFetching}
          onClick={() => {
            void documents.fetchNextPage();
          }}
        >
          {documents.isFetchingNextPage
            ? '正在加载…'
            : documents.isFetchNextPageError
              ? '重试加载更多'
              : '加载更多'}
        </Button>
      ) : null}
    </div>
  );
}

function markdownError(markdown: string): string | undefined {
  if (markdown.includes('\0')) return 'knowledge.invalid_text';
  if (new TextEncoder().encode(markdown).length > 1024 * 1024)
    return 'knowledge.too_large';
}

function NewDocumentForm({
  apiClient,
  identity,
  onCreated,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const markdownInput = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState('');
  const [inputError, setInputError] = useState<string>();
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ body, key }: { body: CreateDocument; key: string }) =>
      (
        await createDocument({
          client: apiClient,
          body,
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': key,
          },
          throwOnError: true,
        })
      ).data,
    retry: false,
    gcTime: 0,
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({
        queryKey: ['knowledge', 'documents', identity.user.id],
      });
      if (
        queryClient.getQueryState(sessionKey(apiClient))?.fetchStatus ===
        'fetching'
      ) {
        try {
          await queryClient.fetchQuery(sessionQuery(apiClient, queryClient));
        } catch {
          return;
        }
      }
      // Check after every await: a session refresh may have changed the identity.
      if (
        queryClient.getQueryData<CurrentSession>(sessionKey(apiClient))?.user
          .id !== identity.user.id
      )
        return;
      queryClient.setQueryData(
        ['knowledge', 'document', identity.user.id, document.id],
        document,
      );
      onCreated(document.id);
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = {
          title: String(form.get('title')).trim(),
          markdown: String(form.get('markdown')),
        };
        const error =
          !body.title || [...body.title].length > 200
            ? 'knowledge.invalid_title'
            : body.title.includes('\0')
              ? 'knowledge.invalid_text'
              : markdownError(body.markdown);
        setInputError(error);
        if (error) return;
        const fingerprint = JSON.stringify(body);
        if (attempt.current?.fingerprint !== fingerprint)
          attempt.current = { fingerprint, key: crypto.randomUUID() };
        mutation.mutate({ body, key: attempt.current.key });
      }}
    >
      <FieldGroup>
        <Field
          data-disabled={mutation.isPending}
          data-invalid={inputError === 'knowledge.invalid_title'}
        >
          <FieldLabel htmlFor="document-title">标题</FieldLabel>
          <Input
            id="document-title"
            name="title"
            required
            maxLength={200}
            aria-invalid={inputError === 'knowledge.invalid_title'}
            disabled={mutation.isPending}
          />
        </Field>
        <Tabs
          defaultValue="edit"
          onValueChange={(value, event) => {
            if (value === 'preview') {
              const markdown = markdownInput.current?.value ?? '';
              const error = markdownError(markdown);
              setInputError(error);
              if (error) event.cancel();
              else setPreview(markdown);
            }
          }}
        >
          <TabsList aria-label="Markdown 模式">
            <TabsTrigger value="edit">编辑</TabsTrigger>
            <TabsTrigger value="preview">预览</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" keepMounted>
            <Field
              data-disabled={mutation.isPending}
              data-invalid={
                inputError === 'knowledge.too_large' ||
                inputError === 'knowledge.invalid_text'
              }
            >
              <FieldLabel htmlFor="document-markdown">Markdown 正文</FieldLabel>
              <Textarea
                ref={markdownInput}
                id="document-markdown"
                name="markdown"
                rows={16}
                aria-invalid={
                  inputError === 'knowledge.too_large' ||
                  inputError === 'knowledge.invalid_text'
                }
                disabled={mutation.isPending}
              />
              <FieldDescription>
                显式保存，正文最多 1 MiB。切换到预览查看排版。
              </FieldDescription>
            </Field>
          </TabsContent>
          <TabsContent value="preview">
            <MarkdownPreview markdown={preview} />
          </TabsContent>
        </Tabs>
        {inputError ? (
          <Failure error={{ error: { code: inputError } }} />
        ) : mutation.isError ? (
          <Failure error={mutation.error} />
        ) : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '正在保存…' : '保存文档'}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function NewDocumentView({
  apiClient,
  onCreated,
  onBack,
}: {
  apiClient: ApiClient;
  onCreated: (id: string) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <Page
      title="新建文档"
      actions={
        <Button variant="outline" onClick={onBack}>
          我的文档
        </Button>
      }
    >
      <IdentityGate session={session}>
        {session.data ? (
          <NewDocumentForm
            key={session.data.user.id}
            apiClient={apiClient}
            identity={session.data}
            onCreated={onCreated}
          />
        ) : null}
      </IdentityGate>
    </Page>
  );
}

export function DocumentView({
  apiClient,
  documentId,
  onBack,
}: {
  apiClient: ApiClient;
  documentId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const document = useQuery({
    queryKey: ['knowledge', 'document', session.data?.user.id, documentId],
    enabled: !!session.data,
    queryFn: async ({ signal }) =>
      (
        await getDocument({
          client: apiClient,
          path: { id: documentId },
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
  });
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <Button variant="outline" onClick={onBack}>
        我的文档
      </Button>
      <IdentityGate session={session}>
        {document.isPending ? (
          <p role="status">正在读取文档…</p>
        ) : document.isError ? (
          <Failure error={document.error} />
        ) : (
          <article className="flex flex-col gap-6">
            <h1 className="text-3xl font-semibold">{document.data.title}</h1>
            <p className="text-sm text-muted-foreground">
              版本 {document.data.version}
            </p>
            <MarkdownPreview markdown={document.data.markdown} />
          </article>
        )}
      </IdentityGate>
    </main>
  );
}
