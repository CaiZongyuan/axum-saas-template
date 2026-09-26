import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createApiClient, type CurrentSession } from '@saas/sdk';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

const identity = {
  user: {
    id: 'reader',
    email: 'reader@example.com',
    display_name: null,
    role: 'member',
  },
  csrf_token: 'csrf-proof',
} satisfies CurrentSession;
function open(role: CurrentSession['user']['role'] = 'owner') {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json({ ...identity, user: { ...identity.user, role } }),
    ),
  );
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: ['/audit'] }),
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

test('members cannot see the audit list while administrators can recover an empty search', async () => {
  let fail = false;
  server.use(
    http.get('http://api.test/api/v1/audit-events', () =>
      fail
        ? HttpResponse.json(
            {
              error: {
                code: 'audit.unavailable',
                request_id: 'audit-retry',
                message: 'Unavailable',
              },
            },
            { status: 503 },
          )
        : HttpResponse.json({ data: [], next_cursor: null, has_more: false }),
    ),
  );
  const user = open();
  expect(await screen.findByText('没有匹配的审计记录')).toBeVisible();
  fail = true;
  await user.click(screen.getByRole('button', { name: '刷新审计' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('audit-retry');
  fail = false;
  await user.click(screen.getByRole('button', { name: '刷新审计' }));
  expect(await screen.findByText('没有匹配的审计记录')).toBeVisible();
});

test('a normal member sees a clear permission message', async () => {
  open('member');
  expect(
    await screen.findByText('仅企业所有者或管理员可以查看审计记录。'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '筛选记录' }),
  ).not.toBeInTheDocument();
});

const event = {
  id: 'audit-one',
  action: 'knowledge.document.create',
  actor_type: 'user',
  actor_id: 'owner',
  resource_type: 'knowledge.document',
  resource_id: 'doc-one',
  request_id: 'request-one',
  correlation_id: 'request-one',
  trace_id: null,
  job_id: null,
  metadata: {},
  created_at: '2026-09-26T00:00:00Z',
} satisfies import('@saas/sdk').AuditEvent;

test('an administrator filters actual fields, pages history and loses visible rows after denial', async () => {
  let forbidden = false;
  server.use(
    http.get('http://api.test/api/v1/audit-events', ({ request }) => {
      if (forbidden)
        return HttpResponse.json(
          {
            error: {
              code: 'audit.forbidden',
              message: 'Forbidden',
              request_id: 'denied',
            },
          },
          { status: 403 },
        );
      const url = new URL(request.url);
      if (url.searchParams.has('resource_id')) {
        expect(url.searchParams.get('resource_id')).toBe('doc-one');
        expect(url.searchParams.get('action')).toBe(
          'knowledge.document.create',
        );
        return HttpResponse.json({
          data: [event],
          next_cursor: null,
          has_more: false,
        });
      }
      const more = url.searchParams.get('cursor') === 'next-audit-page';
      return HttpResponse.json({
        data: [
          {
            ...event,
            id: more ? 'earlier' : 'later',
            action: more ? 'identity.register' : 'organization.member.update',
            resource_id: 'user-one',
          },
        ],
        next_cursor: more ? null : 'next-audit-page',
        has_more: !more,
      });
    }),
  );
  const user = open();
  expect(await screen.findByText('organization.member.update')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '加载更多审计' }));
  expect(await screen.findByText('identity.register')).toBeVisible();
  await user.type(screen.getByLabelText('资源 ID'), 'doc-one');
  await user.type(screen.getByLabelText('动作'), 'knowledge.document.create');
  await user.click(screen.getByRole('button', { name: '筛选记录' }));
  expect(await screen.findByText('knowledge.document.create')).toBeVisible();
  expect(screen.queryByText('identity.register')).not.toBeInTheDocument();
  expect(screen.getByText('doc-one')).toBeVisible();
  expect(screen.getAllByText('request-one').length).toBeGreaterThan(0);
  forbidden = true;
  await user.click(screen.getByRole('button', { name: '刷新审计' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('当前权限已失效');
  expect(
    screen.queryByText('knowledge.document.create'),
  ).not.toBeInTheDocument();
});
