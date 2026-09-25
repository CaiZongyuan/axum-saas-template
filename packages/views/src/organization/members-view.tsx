import { useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  listMembers,
  updateMember,
  type ApiClient,
  type CurrentSession,
  type Member,
  type MemberRole,
} from '@saas/sdk';
import { requestIdFromError } from '@saas/core';
import { Alert, AlertTitle, AlertDescription } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button } from '@saas/ui/components/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@saas/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@saas/ui/components/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@saas/ui/components/native-select';
import { Switch } from '@saas/ui/components/switch';
import { sessionQuery } from '../identity';

const roleNames: Record<MemberRole, string> = {
  owner: '企业所有者',
  admin: '管理员',
  member: '成员',
};
function Failure({ error }: { error: unknown }) {
  const code =
    error && typeof error === 'object' && 'error' in error
      ? (error.error as { code?: string }).code
      : undefined;
  const messages: Record<string, string> = {
    'organization.last_owner':
      '必须保留至少一位启用的企业所有者。请先任命其他 Owner。',
    'organization.forbidden': '你没有管理这些成员或角色的权限。',
    'organization.version_conflict': '成员已被修改，请重新读取列表后再操作。',
    'auth.unauthorized': '会话已失效，请重新登录。',
  };
  const requestId = requestIdFromError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>
        {messages[code ?? ''] ?? '暂时无法完成，请稍后重试。'}
        {requestId ? <p>请求编号：{requestId}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

export function MembersView({
  apiClient,
  onBack,
  onLogin,
}: {
  apiClient: ApiClient;
  onBack: () => void;
  onLogin: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">企业成员</h1>
        <Button variant="link" onClick={onBack}>
          返回首页
        </Button>
      </header>
      {session.isPending ? (
        <p role="status">正在读取会话…</p>
      ) : session.isError ? (
        <Failure error={session.error} />
      ) : session.data ? (
        <MembersList
          key={session.data.user.id}
          apiClient={apiClient}
          identity={session.data}
        />
      ) : (
        <p>
          会话已失效，请
          <Button variant="link" onClick={onLogin}>
            重新登录
          </Button>
          。
        </p>
      )}
    </main>
  );
}

function MembersList({
  apiClient,
  identity,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
}) {
  const queryClient = useQueryClient();
  const [reload, setReload] = useState(0);
  const queryKey = ['organization', 'members', identity.user.id];
  const members = useInfiniteQuery({
    queryKey,
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
  return (
    <>
      <p>
        修改角色或启用状态后点击保存。停用会撤销该成员的全部会话；重新启用后需要重新登录。
      </p>
      <Button
        variant="outline"
        disabled={members.isFetching}
        onClick={async () => {
          await queryClient.resetQueries({ queryKey, exact: true });
          setReload((previous) => previous + 1);
        }}
      >
        重新读取列表
      </Button>
      {members.isPending ? <p role="status">正在读取成员…</p> : null}
      {members.isError ? <Failure error={members.error} /> : null}
      {!members.isError || members.isFetchNextPageError
        ? members.data?.pages.flatMap((page) =>
            page.data.map((member) => (
              <MemberCard
                key={`${reload}:${member.user_id}`}
                apiClient={apiClient}
                identity={identity}
                member={member}
                assignableRoles={page.assignable_roles}
              />
            )),
          )
        : null}
      {members.hasNextPage ? (
        <Button
          variant="outline"
          disabled={members.isFetching}
          onClick={() => {
            void members.fetchNextPage();
          }}
        >
          {members.isFetchingNextPage ? '正在加载…' : '加载更多成员'}
        </Button>
      ) : null}
    </>
  );
}

function MemberCard({
  apiClient,
  identity,
  member,
  assignableRoles,
}: {
  apiClient: ApiClient;
  identity: CurrentSession;
  member: Member;
  assignableRoles: MemberRole[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => ({
    role: member.role,
    active: member.active,
    version: member.version,
  }));
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await updateMember({
          client: apiClient,
          path: { user_id: member.user_id },
          body: draft,
          headers: { 'x-csrf-token': identity.csrf_token },
          throwOnError: true,
        })
      ).data,
    retry: false,
    gcTime: 0,
    onSuccess: async (saved) => {
      setDraft({
        role: saved.role,
        active: saved.active,
        version: saved.version,
      });
      await queryClient.invalidateQueries({
        queryKey: ['organization', 'members', identity.user.id],
      });
      await queryClient.fetchQuery(sessionQuery(apiClient, queryClient));
    },
  });
  return (
    <article aria-label={member.email}>
      <Card>
        <CardHeader>
          <CardTitle>{member.display_name || member.email}</CardTitle>
          <CardDescription>
            {member.email} · {roleNames[member.role]}
          </CardDescription>
          <Badge variant="secondary">
            {member.active ? '已启用' : '已停用'}
          </Badge>
        </CardHeader>
        <CardContent>
          {member.can_edit ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!mutation.isPending) mutation.mutate();
              }}
            >
              <FieldGroup>
                <Field data-disabled={mutation.isPending}>
                  <FieldLabel htmlFor={`role-${member.user_id}`}>
                    角色
                  </FieldLabel>
                  <NativeSelect
                    id={`role-${member.user_id}`}
                    value={draft.role}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        role: event.currentTarget.value as MemberRole,
                      })
                    }
                  >
                    {assignableRoles.map((role) => (
                      <NativeSelectOption key={role} value={role}>
                        {roleNames[role]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  orientation="horizontal"
                  data-disabled={mutation.isPending}
                >
                  <Switch
                    id={`active-${member.user_id}`}
                    checked={draft.active}
                    disabled={mutation.isPending}
                    onCheckedChange={(active) => setDraft({ ...draft, active })}
                  />
                  <FieldLabel htmlFor={`active-${member.user_id}`}>
                    启用成员
                  </FieldLabel>
                </Field>
                {mutation.isError ? <Failure error={mutation.error} /> : null}
                {mutation.isSuccess ? <p role="status">成员已保存</p> : null}
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? '正在保存…' : '保存成员'}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <p>当前角色不能修改这位成员。</p>
          )}
        </CardContent>
      </Card>
    </article>
  );
}
