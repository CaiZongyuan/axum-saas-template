import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import {
  createApiClient,
  type CurrentSession,
  type MemberPage,
} from '@saas/sdk';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

const owner = {
  user: {
    id: 'owner',
    email: 'owner@example.com',
    display_name: null,
    role: 'owner',
  },
  csrf_token: 'csrf-proof',
} satisfies CurrentSession;
const member = {
  user_id: 'member',
  email: 'member@example.com',
  display_name: '团队成员',
  role: 'member',
  active: true,
  version: 1,
  can_edit: true,
} satisfies MemberPage['data'][number];
function open() {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(owner),
    ),
  );
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: ['/members'] }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
test('an administrator changes the role and disables a member through the shared page', async () => {
  let current: MemberPage['data'][number] = member;
  server.use(
    http.get('http://api.test/api/v1/organization/members', () =>
      HttpResponse.json({
        data: [current],
        next_cursor: null,
        has_more: false,
        assignable_roles: ['owner', 'admin', 'member'],
      } satisfies MemberPage),
    ),
    http.put(
      'http://api.test/api/v1/organization/members/member',
      async ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe(owner.csrf_token);
        expect(await request.json()).toEqual({
          role: 'admin',
          active: false,
          version: 1,
        });
        current = { ...member, role: 'admin', active: false, version: 2 };
        return HttpResponse.json(current);
      },
    ),
  );
  const user = open();
  const row = within(
    await screen.findByRole('article', { name: member.email }),
  );
  await user.selectOptions(row.getByLabelText('角色'), 'admin');
  await user.click(row.getByRole('switch', { name: '启用成员' }));
  await user.click(row.getByRole('button', { name: '保存成员' }));
  expect(await row.findByText('成员已保存')).toBeVisible();
  expect(row.getByText('已停用')).toBeVisible();
});

test.each([
  ['organization.last_owner', '必须保留至少一位', 422],
  ['organization.version_conflict', '成员已被修改', 409],
] as const)(
  'a rejected %s change stays visible until an explicit reload',
  async (code, message, status) => {
    server.use(
      http.get('http://api.test/api/v1/organization/members', () =>
        HttpResponse.json({
          data: [member],
          next_cursor: null,
          has_more: false,
          assignable_roles: ['owner', 'admin', 'member'],
        } satisfies MemberPage),
      ),
      http.put('http://api.test/api/v1/organization/members/member', () =>
        HttpResponse.json(
          {
            error: {
              code,
              message: 'Rejected',
              details: {},
              request_id: 'member-rejected',
            },
          },
          { status },
        ),
      ),
    );
    const user = open();
    await screen.findByRole('article', { name: member.email });
    await user.click(screen.getByRole('switch', { name: '启用成员' }));
    await user.click(screen.getByRole('button', { name: '保存成员' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('switch', { name: '启用成员' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '重新读取列表' }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '启用成员' })).toBeChecked(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);

test('server capabilities determine which members have editing controls', async () => {
  server.use(
    http.get('http://api.test/api/v1/organization/members', () =>
      HttpResponse.json({
        data: [{ ...member, can_edit: false }],
        next_cursor: null,
        has_more: false,
        assignable_roles: ['admin', 'member'],
      } satisfies MemberPage),
    ),
  );
  open();
  expect(await screen.findByText('当前角色不能修改这位成员。')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '保存成员' }),
  ).not.toBeInTheDocument();
});

test('denied member administration shows no roster', async () => {
  server.use(
    http.get('http://api.test/api/v1/organization/members', () =>
      HttpResponse.json(
        {
          error: {
            code: 'organization.forbidden',
            message: 'Forbidden',
            details: {},
            request_id: 'denied-members',
          },
        },
        { status: 403 },
      ),
    ),
  );
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '没有管理这些成员',
  );
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
