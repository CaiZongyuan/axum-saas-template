import { useEffect, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  renameKnowledgeBase,
  listKnowledgeBases,
  createKnowledgeBase,
  listMembers,
  listKnowledgeBaseGrants,
  setKnowledgeBaseGrant,
  revokeKnowledgeBaseGrant,
  type ApiClient,
  type CurrentSession,
  type GrantAccess,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Button } from '@saas/ui/components/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@saas/ui/components/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import { sessionKey, sessionQuery } from '../identity';
import { Input } from '@saas/ui/components/input';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@saas/ui/components/empty';
import { DocumentList } from './documents-view';
import { knowledgeBaseQuery } from './knowledge-base-query';

function Failure({ error }: { error: unknown }) {
  const id = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>
        知识库不存在、权限已变化或服务暂时不可用，请重新查询。
        {id ? <p>请求编号：{id}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

function BaseNameForm({
  initialName = '',
  pending,
  error,
  action,
  onSave,
}: {
  initialName?: string;
  pending: boolean;
  error: unknown;
  action: string;
  onSave: (name: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(
          new FormData(event.currentTarget).get('name'),
        ).trim();
        const invalid = !name || [...name].length > 120 || name.includes('\0');
        setInvalid(invalid);
        if (!invalid && !pending) onSave(name);
      }}
    >
      <FieldGroup>
        <Field data-disabled={pending} data-invalid={invalid}>
          <FieldLabel htmlFor="base-name">知识库名称</FieldLabel>
          <Input
            id="base-name"
            name="name"
            defaultValue={initialName}
            required
            maxLength={120}
            disabled={pending}
            aria-invalid={invalid}
          />
          <FieldDescription>
            {invalid
              ? '请填写 1–120 个字符的有效名称。'
              : '管理员可修改名称与成员授权。'}
          </FieldDescription>
        </Field>
        {error ? <Failure error={error} /> : null}
        <Button type="submit" disabled={pending}>
          {pending ? '正在保存…' : action}
        </Button>
      </FieldGroup>
    </form>
  );
}

function RenameBase({
  apiClient,
  identity,
  baseId,
  name,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  baseId: string;
  name: string;
}) {
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: async (name: string) =>
      (
        await renameKnowledgeBase({
          client: apiClient,
          path: { id: baseId },
          body: { name },
          headers: { 'x-csrf-token': identity.csrf_token },
          throwOnError: true,
        })
      ).data,
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  return (
    <BaseNameForm
      initialName={name}
      pending={rename.isPending}
      error={rename.error}
      action="保存库名"
      onSave={(name) => rename.mutate(name)}
    />
  );
}

export function KnowledgeBasesView({
  apiClient,
  onBack,
  onLogin,
  onOpen,
}: {
  apiClient: ApiClient;
  onBack: () => void;
  onLogin: () => void;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">知识库</h1>
        <Button variant="outline" onClick={onBack}>
          返回首页
        </Button>
      </header>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <Failure error={session.error} />
      ) : session.data ? (
        <BaseList
          key={session.data.user.id}
          apiClient={apiClient}
          identity={session.data}
          onOpen={onOpen}
        />
      ) : (
        <Button onClick={onLogin}>登录后访问知识库</Button>
      )}
    </main>
  );
}

function BaseList({
  apiClient,
  identity,
  onOpen,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const attempt = useRef<{ name: string; key: string } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const bases = useInfiniteQuery({
    queryKey: ['knowledge', 'bases', identity.user.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listKnowledgeBases({
          client: apiClient,
          query: { cursor: pageParam, limit: 50 },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 10,
    retry: false,
  });
  const creation = useMutation({
    mutationFn: async ({ name, key }: { name: string; key: string }) =>
      (
        await createKnowledgeBase({
          client: apiClient,
          body: { name },
          headers: {
            'x-csrf-token': identity.csrf_token,
            'idempotency-key': key,
          },
          throwOnError: true,
        })
      ).data,
    retry: false,
    gcTime: 0,
    onSuccess: async (base) => {
      await queryClient.invalidateQueries({
        queryKey: ['knowledge', 'bases', identity.user.id],
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
      if (
        active.current &&
        queryClient.getQueryData<CurrentSession>(sessionKey(apiClient))?.user
          .id === identity.user.id
      )
        onOpen(base.id);
    },
  });
  const items = bases.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <Button
        variant="outline"
        disabled={bases.isFetching}
        onClick={() => {
          void bases.refetch();
        }}
      >
        重新查询知识库
      </Button>
      {bases.isPending ? (
        <p role="status">正在读取知识库…</p>
      ) : bases.isError ? (
        <Failure error={bases.error} />
      ) : (
        <>
          {bases.data.pages[0]?.can_create ? (
            <BaseNameForm
              pending={creation.isPending}
              error={creation.error}
              action="创建共享知识库"
              onSave={(name) => {
                if (attempt.current?.name !== name)
                  attempt.current = { name, key: crypto.randomUUID() };
                creation.mutate(attempt.current);
              }}
            />
          ) : null}
          {items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有可访问的知识库</EmptyTitle>
                <EmptyDescription>
                  个人知识库会在首次保存文档时准备。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((base) => (
                <li
                  key={base.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4"
                >
                  <Button variant="link" onClick={() => onOpen(base.id)}>
                    {base.name}
                  </Button>
                  <span>
                    {base.personal ? '个人库' : '共享库'} ·{' '}
                    {base.can_edit ? '可编辑' : '只读'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {bases.hasNextPage ? (
        <Button
          variant="outline"
          disabled={bases.isFetching}
          onClick={() => {
            void bases.fetchNextPage();
          }}
        >
          加载更多知识库
        </Button>
      ) : null}
    </>
  );
}

export function KnowledgeBaseView({
  apiClient,
  baseId,
  onBack,
  onLogin,
  onNew,
  onOpen,
}: {
  apiClient: ApiClient;
  baseId: string;
  onBack: () => void;
  onLogin: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const base = useQuery(
    knowledgeBaseQuery(apiClient, session.data?.user.id, baseId),
  );
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <Button variant="outline" onClick={onBack}>
        知识库列表
      </Button>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <Failure error={session.error} />
      ) : !session.data ? (
        <Button onClick={onLogin}>登录后访问知识库</Button>
      ) : base.isPending ? (
        <p role="status">正在读取知识库…</p>
      ) : base.isError ? (
        <>
          <Failure error={base.error} />
          <Button
            variant="outline"
            onClick={() => {
              void base.refetch();
            }}
          >
            重新查询知识库
          </Button>
        </>
      ) : (
        <>
          <header className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">{base.data.name}</h1>
            {base.data.can_edit ? (
              <Button onClick={onNew}>新建文档</Button>
            ) : (
              <p>只读知识库</p>
            )}
          </header>
          <DocumentList
            key={`documents:${session.data.user.id}:${baseId}`}
            apiClient={apiClient}
            identity={session.data}
            knowledgeBaseId={baseId}
            canCreate={base.data.can_edit}
            onOpen={onOpen}
          />
          {base.data.can_manage ? (
            <>
              <RenameBase
                key={`name:${session.data.user.id}:${baseId}`}
                apiClient={apiClient}
                identity={session.data}
                baseId={baseId}
                name={base.data.name}
              />
              <Grants
                key={`grants:${session.data.user.id}:${baseId}`}
                apiClient={apiClient}
                identity={session.data}
                baseId={baseId}
              />
            </>
          ) : null}
        </>
      )}
    </main>
  );
}

const accessNames: Record<GrantAccess, string> = {
  reader: '只读',
  editor: '可编辑',
};
function Grants({
  apiClient,
  identity,
  baseId,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  baseId: string;
}) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [access, setAccess] = useState<GrantAccess>('reader');
  const members = useInfiniteQuery({
    queryKey: ['organization', 'members', identity.user.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listMembers({
          client: apiClient,
          query: { cursor: pageParam, limit: 50 },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 10,
    retry: false,
  });
  const grants = useInfiniteQuery({
    queryKey: ['knowledge', 'grants', identity.user.id, baseId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await listKnowledgeBaseGrants({
          client: apiClient,
          path: { id: baseId },
          query: { cursor: pageParam, limit: 50 },
          signal,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    maxPages: 10,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async ({
      target,
      access,
    }: {
      target: string;
      access?: GrantAccess;
    }) => {
      const options = {
        client: apiClient,
        path: { id: baseId, user_id: target },
        headers: { 'x-csrf-token': identity.csrf_token },
        throwOnError: true as const,
      };
      if (access) await setKnowledgeBaseGrant({ ...options, body: { access } });
      else await revokeKnowledgeBaseGrant(options);
    },
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  const items = grants.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section
      aria-label="知识库授权"
      className="flex flex-col gap-4 rounded-lg border p-6"
    >
      <h2 className="text-xl font-semibold">知识库授权</h2>
      <p>文档和附件继承知识库权限。企业 Owner/Admin 始终拥有管理与读写权限。</p>
      {members.isPending || grants.isPending ? (
        <p role="status">正在读取授权与成员…</p>
      ) : null}
      {members.isError ? (
        <>
          <Failure error={members.error} />
          <Button
            variant="outline"
            onClick={() => {
              void members.refetch();
            }}
          >
            重读成员
          </Button>
        </>
      ) : null}
      {grants.isError ? (
        <>
          <Failure error={grants.error} />
          <Button
            variant="outline"
            onClick={() => {
              void grants.refetch();
            }}
          >
            重读授权
          </Button>
        </>
      ) : null}
      {members.data && !members.isError ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (userId && !mutation.isPending)
              mutation.mutate({ target: userId, access });
          }}
        >
          <FieldGroup>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="grant-user">选择成员</FieldLabel>
              <NativeSelect
                id="grant-user"
                required
                value={userId}
                disabled={mutation.isPending}
                onChange={(event) => setUserId(event.currentTarget.value)}
              >
                <NativeSelectOption value="" disabled>
                  选择已启用成员
                </NativeSelectOption>
                {members.data.pages
                  .flatMap((page) => page.data)
                  .filter((member) => member.active)
                  .map((member) => (
                    <NativeSelectOption
                      key={member.user_id}
                      value={member.user_id}
                    >
                      {member.email}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <FieldDescription>
                无需邀请，直接选择已经注册的成员。
              </FieldDescription>
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="grant-access">访问权限</FieldLabel>
              <NativeSelect
                id="grant-access"
                value={access}
                disabled={mutation.isPending}
                onChange={(event) =>
                  setAccess(event.currentTarget.value as GrantAccess)
                }
              >
                {(Object.keys(accessNames) as GrantAccess[]).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {accessNames[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={mutation.isPending || !userId}>
              {mutation.isPending ? '正在保存…' : '保存授权'}
            </Button>
          </FieldGroup>
        </form>
      ) : null}
      {members.hasNextPage ? (
        <Button
          variant="outline"
          disabled={members.isFetching}
          onClick={() => {
            void members.fetchNextPage();
          }}
        >
          加载更多成员
        </Button>
      ) : null}
      {mutation.isError ? <Failure error={mutation.error} /> : null}
      {!grants.isPending && !grants.isError && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有额外授权</EmptyTitle>
            <EmptyDescription>
              选择已注册成员，授予只读或编辑权限。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {!grants.isError ? (
        <ul className="flex flex-col gap-3">
          {items.map((grant) => (
            <li
              key={grant.user_id}
              className="flex items-center justify-between gap-3"
            >
              <span>
                {grant.email} · {accessNames[grant.access]}
              </span>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                aria-label={`撤销 ${grant.email} 的授权`}
                onClick={() => mutation.mutate({ target: grant.user_id })}
              >
                撤销
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {grants.hasNextPage ? (
        <Button
          variant="outline"
          disabled={grants.isFetching}
          onClick={() => {
            void grants.fetchNextPage();
          }}
        >
          加载更多授权
        </Button>
      ) : null}
    </section>
  );
}
