import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  queryOptions,
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
  updateDocument,
  type Document,
  type ApiClient,
  type CurrentSession,
  type CreateDocument,
} from '@saas/sdk';
import { errorCodeOf } from '@saas/core';
import { RequestErrorAlert } from './request-error';
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
import { useAppMessage } from '../shell/messages';
import { useAppFormat } from '../shell/format';
import { MarkdownPreview } from './markdown-preview';
import { knowledgeBaseQuery } from './knowledge-base-query';
import { AttachmentsPanel } from './attachments-panel';
import { DeleteResource } from './delete-resource';
import { ExportsPanel } from './exports-panel';
import type { FileTransfer } from './file-transfer';

function permissionDenied(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === 'knowledge.forbidden' || code === 'knowledge.not_found';
}

// Server error codes carry no display text (the API's message field is a
// debug string), so the example maps each code to its own catalog key.
const ERROR_KEYS: Record<string, string> = {
  'knowledge.forbidden': 'errors.writeForbidden',
  'knowledge.not_found': 'errors.docNotFound',
  'knowledge.invalid_search': 'errors.invalidSearch',
  'knowledge.invalid_page': 'errors.invalidPage',
  'knowledge.invalid_title': 'errors.invalidTitle',
  'knowledge.too_large': 'errors.tooLarge',
  'knowledge.invalid_text': 'errors.invalidText',
  'document.version_conflict': 'errors.versionConflict',
  'idempotency.conflict': 'errors.idempotencyConflict',
  'auth.unauthorized': 'errors.unauthorized',
  'auth.csrf': 'errors.csrf',
};

function Failure({ error }: { error: unknown }) {
  const message = useAppMessage('knowledge');
  return (
    <RequestErrorAlert
      title={message('errors.actionIncomplete')}
      text={message(ERROR_KEYS[errorCodeOf(error) ?? ''] ?? 'errors.fallback')}
      error={error}
    />
  );
}

function IdentityGate({
  session,
  children,
}: {
  session: UseQueryResult<CurrentSession | null>;
  children: ReactNode;
}) {
  const message = useAppMessage('knowledge');
  if (session.isPending)
    return <p role="status">{message('common.readingSession')}</p>;
  if (session.isError && !session.data)
    return <Failure error={session.error} />;
  if (!session.data)
    return (
      <p>
        {message('documents.signInPrompt')}
        <a href="/login" className="underline">
          {message('documents.signInAction')}
        </a>
        {message('documents.signInSuffix')}
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
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
  const message = useAppMessage('knowledge');
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <Page title={message('documents.title')}>
      <IdentityGate session={session}>
        {session.data ? (
          <DocumentList
            key={session.data.user.id}
            apiClient={apiClient}
            identity={session.data}
            onOpen={onOpen}
            onNew={onNew}
          />
        ) : null}
      </IdentityGate>
    </Page>
  );
}

export function DocumentList({
  apiClient,
  identity,
  onOpen,
  knowledgeBaseId,
  canCreate = true,
  onNew,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onOpen: (id: string) => void;
  knowledgeBaseId?: string;
  canCreate?: boolean;
  onNew?: () => void;
}) {
  const queryClient = useQueryClient();
  const message = useAppMessage('knowledge');
  const { formatDateTime } = useAppFormat();
  const [keyword, setKeyword] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const queryKey = [
    'knowledge',
    'documents',
    identity.user.id,
    { scope: knowledgeBaseId ?? 'personal', q: keyword },
  ];
  const documents = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listPersonalDocuments({
          client: apiClient,
          query: {
            cursor: pageParam,
            limit: 50,
            q: keyword,
            knowledge_base_id: knowledgeBaseId,
          },
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
          { scope: knowledgeBaseId ?? 'personal', q: next },
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
      {onNew && documents.data?.pages[0]?.can_create ? (
        <Button onClick={onNew}>{message('common.newDocument')}</Button>
      ) : null}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          search(searchInput.current?.value.trim() ?? '');
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="document-search">
              {message('documents.searchLabel')}
            </FieldLabel>
            <Input
              ref={searchInput}
              id="document-search"
              name="q"
              maxLength={200}
            />
            <FieldDescription>
              {message('documents.searchHint')}
            </FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={documents.isFetching}>
              {message('documents.search')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (searchInput.current) searchInput.current.value = '';
                search('');
              }}
            >
              {message('documents.clearSearch')}
            </Button>
          </div>
        </FieldGroup>
      </form>
      {documents.isFetching && !documents.isFetchingNextPage ? (
        <p role="status">{message('documents.loading')}</p>
      ) : null}
      {documents.isError ? <Failure error={documents.error} /> : null}
      {documents.isError && !documents.isFetchNextPageError ? (
        <Button variant="outline" onClick={() => search(keyword)}>
          {message('documents.retrySearch')}
        </Button>
      ) : null}
      {!documents.isPending && canShowResults ? (
        items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>
                {keyword
                  ? message('documents.emptyNoMatch')
                  : message('documents.emptyNone')}
              </EmptyTitle>
              <EmptyDescription>
                {keyword
                  ? message('documents.emptyNoMatchHint')
                  : message('documents.emptyNoneHint')}
              </EmptyDescription>
            </EmptyHeader>
            {!keyword && canCreate ? (
              <EmptyContent>{message('documents.emptyHowTo')}</EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <>
            <p role="status">
              {keyword
                ? message('documents.shownWithKeyword', {
                    count: items.length,
                    keyword,
                  })
                : message('documents.shownCount', { count: items.length })}
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
                        {message('documents.updated', {
                          date: formatDateTime(document.updated_at),
                        })}
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
            ? message('documents.loadingMore')
            : documents.isFetchNextPageError
              ? message('documents.retryLoadMore')
              : message('documents.loadMore')}
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

function DocumentForm({
  apiClient,
  identity,
  onSaved,
  document,
  onReadLatest,
  latestPending,
  onDirtyChange,
  readOnly = false,
  knowledgeBaseId,
  onRefreshPermission,
  fileTransfer,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onSaved: (id: string) => void;
  document?: Document;
  onReadLatest?: () => Promise<number | undefined>;
  latestPending?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  readOnly?: boolean;
  knowledgeBaseId?: string;
  onRefreshPermission: () => Promise<boolean>;
  fileTransfer?: FileTransfer;
}) {
  const queryClient = useQueryClient();
  const message = useAppMessage('knowledge');
  const attachmentContext =
    document && fileTransfer
      ? {
          apiClient,
          userId: identity.user.id,
          documentId: document.id,
          transfer: fileTransfer,
        }
      : undefined;
  const titleInput = useRef<HTMLInputElement>(null);
  const markdownInput = useRef<HTMLTextAreaElement>(null);
  const [baseline, setBaseline] = useState(() => ({
    title: document?.title ?? '',
    markdown: document?.markdown ?? '',
    version: document?.version,
  }));
  const [latestRead, setLatestRead] = useState<number>();
  const [dirty, setDirty] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const [preview, setPreview] = useState('');
  const [inputError, setInputError] = useState<string>();
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({
      body,
      key,
    }: {
      body: CreateDocument;
      key: string;
    }) => {
      if (document && baseline.version !== undefined) {
        return (
          await updateDocument({
            client: apiClient,
            path: { id: document.id },
            body: { ...body, version: baseline.version },
            headers: { 'x-csrf-token': identity.csrf_token },
            throwOnError: true,
          })
        ).data;
      }
      return (
        await createDocument({
          client: apiClient,
          body,
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': key,
          },
          throwOnError: true,
        })
      ).data;
    },
    retry: false,
    gcTime: 0,
    onError: (error) => {
      if (permissionDenied(error))
        void onRefreshPermission().catch(() => undefined);
    },
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({
        queryKey: ['knowledge', 'documents', identity.user.id],
      });
      await queryClient.cancelQueries({
        queryKey: ['knowledge', 'document', identity.user.id, document.id],
        exact: true,
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
      queryClient.setQueryData<Document>(
        ['knowledge', 'document', identity.user.id, document.id],
        (cached) =>
          cached && cached.version > document.version ? cached : document,
      );
      if (active.current) {
        setDirty(false);
        onSaved(document.id);
      }
    },
  });
  const denied = permissionDenied(mutation.error);
  const cannotEdit = readOnly || document?.can_edit === false || denied;
  const conflict =
    !!mutation.error &&
    typeof mutation.error === 'object' &&
    'error' in mutation.error &&
    (mutation.error.error as { code?: string }).code ===
      'document.version_conflict';
  const latest = latestRead === document?.version ? document : undefined;
  function reconcile(replace: boolean) {
    if (!latest) return;
    if (replace) {
      if (titleInput.current) titleInput.current.value = latest.title;
      if (markdownInput.current) markdownInput.current.value = latest.markdown;
      setPreview(latest.markdown);
    }
    setBaseline({
      title: latest.title,
      markdown: latest.markdown,
      version: latest.version,
    });
    setDirty(
      !replace &&
        (titleInput.current?.value !== latest.title ||
          markdownInput.current?.value !== latest.markdown),
    );
    mutation.reset();
    setLatestRead(undefined);
  }
  return (
    <form
      onChange={() =>
        setDirty(
          titleInput.current?.value !== baseline.title ||
            markdownInput.current?.value !== baseline.markdown,
        )
      }
      onSubmit={(event) => {
        event.preventDefault();
        if (mutation.isPending || conflict || cannotEdit) return;
        const form = new FormData(event.currentTarget);
        const body = {
          title: String(form.get('title')).trim(),
          markdown: String(form.get('markdown')),
          ...(knowledgeBaseId ? { knowledge_base_id: knowledgeBaseId } : {}),
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
        {cannotEdit ? (
          <p role="status">
            {denied
              ? message('documents.saveDenied')
              : message('documents.readOnly')}
          </p>
        ) : null}
        {cannotEdit ? (
          <Button
            variant="outline"
            disabled={latestPending}
            onClick={() => {
              void onRefreshPermission()
                .then((allowed) => {
                  if (allowed) mutation.reset();
                })
                .catch(() => undefined);
            }}
          >
            {message('documents.retryPermissions')}
          </Button>
        ) : null}
        <Field
          data-disabled={mutation.isPending || cannotEdit}
          data-invalid={inputError === 'knowledge.invalid_title'}
        >
          <FieldLabel htmlFor="document-title">
            {message('documents.titleLabel')}
          </FieldLabel>
          <Input
            ref={titleInput}
            defaultValue={baseline.title}
            id="document-title"
            name="title"
            required
            maxLength={200}
            aria-invalid={inputError === 'knowledge.invalid_title'}
            disabled={mutation.isPending || cannotEdit}
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
          <TabsList aria-label={message('documents.markdownMode')}>
            <TabsTrigger value="edit">
              {message('documents.tabEdit')}
            </TabsTrigger>
            <TabsTrigger value="preview">
              {message('documents.tabPreview')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="edit" keepMounted>
            <Field
              data-disabled={mutation.isPending || cannotEdit}
              data-invalid={
                inputError === 'knowledge.too_large' ||
                inputError === 'knowledge.invalid_text'
              }
            >
              <FieldLabel htmlFor="document-markdown">
                {message('documents.bodyLabel')}
              </FieldLabel>
              <Textarea
                ref={markdownInput}
                defaultValue={baseline.markdown}
                id="document-markdown"
                name="markdown"
                rows={16}
                aria-invalid={
                  inputError === 'knowledge.too_large' ||
                  inputError === 'knowledge.invalid_text'
                }
                disabled={mutation.isPending || cannotEdit}
              />
              <FieldDescription>
                {message('documents.bodyHint')}
              </FieldDescription>
            </Field>
          </TabsContent>
          <TabsContent value="preview">
            <MarkdownPreview
              markdown={preview}
              attachments={attachmentContext}
            />
          </TabsContent>
        </Tabs>
        {inputError ? (
          <Failure error={{ error: { code: inputError } }} />
        ) : mutation.isError ? (
          <Failure error={mutation.error} />
        ) : null}
        {conflict && onReadLatest ? (
          <section
            aria-label={message('documents.conflictSection')}
            className="flex flex-col gap-3"
          >
            <Button
              variant="outline"
              disabled={latestPending}
              onClick={() => {
                void onReadLatest().then(setLatestRead);
              }}
            >
              {latestPending
                ? message('documents.readingLatest')
                : message('documents.readLatest')}
            </Button>
            {latest ? (
              <>
                <h2 className="text-lg font-semibold">
                  {message('documents.latestVersion', {
                    version: latest.version,
                    title: latest.title,
                  })}
                </h2>
                <MarkdownPreview
                  markdown={latest.markdown}
                  attachments={attachmentContext}
                />
                <p>{message('documents.conflictHint')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => reconcile(false)}>
                    {message('documents.keepDraft')}
                  </Button>
                  <Button variant="outline" onClick={() => reconcile(true)}>
                    {message('documents.takeLatest')}
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {baseline.version !== undefined ? (
          <p className="text-sm text-muted-foreground">
            {message('documents.baseline', { version: baseline.version })}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={mutation.isPending || conflict || cannotEdit}
        >
          {mutation.isPending
            ? message('common.saving')
            : message('documents.save')}
        </Button>
      </FieldGroup>
      {document && fileTransfer ? (
        <AttachmentsPanel
          apiClient={apiClient}
          identity={identity}
          documentId={document.id}
          canEdit={!cannotEdit && !mutation.isPending}
          transfer={fileTransfer}
          onInsert={(reference) => {
            if (!markdownInput.current) return;
            markdownInput.current.value += `\n\n${reference}`;
            setPreview(markdownInput.current.value);
            setDirty(true);
          }}
        />
      ) : null}
    </form>
  );
}

export function NewDocumentView({
  apiClient,
  onCreated,
  onBack,
  onDirtyChange,
  knowledgeBaseId,
}: {
  apiClient: ApiClient;
  onCreated: (id: string) => void;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  knowledgeBaseId?: string;
}) {
  const queryClient = useQueryClient();
  const message = useAppMessage('knowledge');
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const base = useQuery(
    knowledgeBaseQuery(apiClient, session.data?.user.id, knowledgeBaseId),
  );
  const personal = useQuery({
    queryKey: [
      'knowledge',
      'write-permission',
      session.data?.user.id,
      'personal',
    ],
    enabled: !!session.data && !knowledgeBaseId,
    queryFn: async ({ signal }) =>
      (
        await listPersonalDocuments({
          client: apiClient,
          query: { limit: 1 },
          signal,
          throwOnError: true,
        })
      ).data,
    retry: false,
  });
  const permission = knowledgeBaseId ? base : personal;
  const canCreate = knowledgeBaseId
    ? !!base.data?.can_edit
    : !!personal.data?.can_create;
  return (
    <Page
      title={message('common.newDocument')}
      actions={
        <Button variant="outline" onClick={onBack}>
          {knowledgeBaseId
            ? message('documents.backToBase')
            : message('documents.title')}
        </Button>
      }
    >
      <IdentityGate session={session}>
        {permission.isPending ? (
          <p role="status">{message('documents.readingBasePerms')}</p>
        ) : permission.isError ? (
          <Failure error={permission.error} />
        ) : null}
        {session.data && permission.data ? (
          <DocumentForm
            key={`${session.data.user.id}:${knowledgeBaseId ?? 'personal'}`}
            apiClient={apiClient}
            identity={session.data}
            onSaved={onCreated}
            knowledgeBaseId={knowledgeBaseId}
            readOnly={permission.isError || !canCreate}
            latestPending={permission.isFetching}
            onRefreshPermission={async () => {
              if (knowledgeBaseId) {
                const refreshed = await base.refetch();
                return refreshed.isSuccess && refreshed.data.can_edit;
              }
              const refreshed = await personal.refetch();
              return refreshed.isSuccess && refreshed.data.can_create;
            }}
            onDirtyChange={onDirtyChange}
          />
        ) : null}
      </IdentityGate>
    </Page>
  );
}

function documentQuery(
  apiClient: ApiClient,
  userId: string | undefined,
  documentId: string,
) {
  return queryOptions({
    queryKey: ['knowledge', 'document', userId, documentId],
    enabled: !!userId,
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
}

export function DocumentView({
  apiClient,
  documentId,
  onBack,
  onEdit,
  onLibrary,
  fileTransfer,
}: {
  apiClient: ApiClient;
  documentId: string;
  onEdit: () => void;
  onLibrary: (id: string) => void;
  onBack: () => void;
  fileTransfer: FileTransfer;
}) {
  const queryClient = useQueryClient();
  const message = useAppMessage('knowledge');
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const document = useQuery(
    documentQuery(apiClient, session.data?.user.id, documentId),
  );
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <Button variant="outline" onClick={onBack}>
        {message('documents.title')}
      </Button>
      <IdentityGate session={session}>
        {document.isPending ? (
          <p role="status">{message('documents.readingDocument')}</p>
        ) : document.isError ? (
          <Failure error={document.error} />
        ) : (
          <article className="flex flex-col gap-6">
            <h1 className="text-3xl font-semibold">{document.data.title}</h1>
            <Button
              variant="outline"
              onClick={() => onLibrary(document.data.knowledge_base_id)}
            >
              {message('documents.openBase')}
            </Button>
            {document.data.can_edit ? (
              <Button onClick={onEdit}>{message('documents.edit')}</Button>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {message('common.version', { version: document.data.version })}
            </p>
            {document.data.can_edit && session.data ? (
              <DeleteResource
                key={`delete:${session.data.user.id}:${documentId}`}
                apiClient={apiClient}
                identity={session.data}
                resource={{
                  kind: 'document',
                  id: documentId,
                  name: document.data.title,
                }}
                onDeleted={onBack}
              />
            ) : null}
            <MarkdownPreview
              markdown={document.data.markdown}
              attachments={
                session.data
                  ? {
                      apiClient,
                      userId: session.data.user.id,
                      documentId,
                      transfer: fileTransfer,
                    }
                  : undefined
              }
            />
            {session.data ? (
              <ExportsPanel
                key={`exports:${session.data.user.id}:${documentId}`}
                apiClient={apiClient}
                identity={session.data}
                documentId={documentId}
                transfer={fileTransfer}
              />
            ) : null}
            {session.data ? (
              <AttachmentsPanel
                key={`${session.data.user.id}:${documentId}`}
                apiClient={apiClient}
                identity={session.data}
                documentId={documentId}
                canEdit={document.data.can_edit}
                transfer={fileTransfer}
              />
            ) : null}
          </article>
        )}
      </IdentityGate>
    </div>
  );
}

export function EditDocumentView({
  apiClient,
  documentId,
  onSaved,
  onBack,
  onDirtyChange,
  fileTransfer,
}: {
  apiClient: ApiClient;
  documentId: string;
  onSaved: (id: string) => void;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  fileTransfer: FileTransfer;
}) {
  const queryClient = useQueryClient();
  const message = useAppMessage('knowledge');
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const document = useQuery(
    documentQuery(apiClient, session.data?.user.id, documentId),
  );
  return (
    <Page
      title={message('documents.edit')}
      actions={
        <Button variant="outline" onClick={onBack}>
          {message('documents.backToDocument')}
        </Button>
      }
    >
      <IdentityGate session={session}>
        {document.isPending ? (
          <p role="status">{message('documents.readingDocument')}</p>
        ) : null}
        {document.isError ? <Failure error={document.error} /> : null}
        {document.data && session.data ? (
          <DocumentForm
            key={`${session.data.user.id}:${documentId}`}
            apiClient={apiClient}
            identity={session.data}
            document={document.data}
            fileTransfer={fileTransfer}
            readOnly={document.isError}
            onSaved={onSaved}
            onDirtyChange={onDirtyChange}
            latestPending={document.isFetching}
            onRefreshPermission={async () => {
              const refreshed = await document.refetch();
              return refreshed.isSuccess && refreshed.data.can_edit;
            }}
            onReadLatest={async () => {
              const result = await document.refetch();
              return result.isSuccess ? result.data.version : undefined;
            }}
          />
        ) : null}
      </IdentityGate>
    </Page>
  );
}
