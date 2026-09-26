import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import {
  createApiClient,
  type Notification,
  type CurrentSession,
} from '@saas/sdk';
import { render, screen, waitFor } from '@testing-library/react';
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
function open() {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(identity),
    ),
  );
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: ['/notifications'] }),
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

test('an empty inbox can refresh into a retryable error and recover', async () => {
  let failed = false;
  server.use(
    http.get('http://api.test/api/v1/notifications', () =>
      failed
        ? HttpResponse.json(
            {
              error: {
                code: 'notifications.unavailable',
                request_id: 'inbox-retry',
                message: 'Unavailable',
              },
            },
            { status: 503 },
          )
        : HttpResponse.json({
            data: [],
            unread_count: 0,
            next_cursor: null,
            has_more: false,
          }),
    ),
  );
  const user = open();
  expect(await screen.findByText('暂无通知')).toBeVisible();
  expect(screen.getByText('0 条未读')).toBeVisible();
  failed = true;
  await user.click(screen.getByRole('button', { name: '刷新通知' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('inbox-retry');
  failed = false;
  await user.click(screen.getByRole('button', { name: '刷新通知' }));
  expect(await screen.findByText('暂无通知')).toBeVisible();
});

const notice = {
  id: 'notice-one',
  subject: '报告生成',
  outcome: 'failed',
  created_at: '2026-09-26T00:00:00Z',
  read_at: null,
  target: { kind: 'removed.example', resource_id: 'one', context: {} },
} satisfies Notification;

test('a failed outcome remains readable when its business is removed and marking read persists through refresh', async () => {
  let readAt: string | null = null;
  server.use(
    http.get('http://api.test/api/v1/notifications', () =>
      HttpResponse.json({
        data: [{ ...notice, read_at: readAt }],
        unread_count: readAt ? 0 : 1,
        next_cursor: null,
        has_more: false,
      }),
    ),
    http.post(
      'http://api.test/api/v1/notifications/notice-one/read',
      ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe('csrf-proof');
        readAt = '2026-09-26T01:00:00Z';
        return HttpResponse.json({ ...notice, read_at: readAt });
      },
    ),
  );
  const user = open();
  expect(await screen.findByText('报告生成失败')).toBeVisible();
  expect(screen.getByText('1 条未读')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '查看结果' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('此通知的功能当前不可用。')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '标记已读' }));
  await waitFor(() => expect(screen.getByText('0 条未读')).toBeVisible());
  await user.click(screen.getByRole('button', { name: '刷新通知' }));
  expect(await screen.findByText('已读')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '标记已读' }),
  ).not.toBeInTheDocument();
});

test('a failed read operation keeps the notice unread and allows retry', async () => {
  let succeed = false;
  let readAt: string | null = null;
  server.use(
    http.get('http://api.test/api/v1/notifications', () =>
      HttpResponse.json({
        data: [{ ...notice, read_at: readAt }],
        unread_count: readAt ? 0 : 1,
        next_cursor: null,
        has_more: false,
      }),
    ),
    http.post('http://api.test/api/v1/notifications/notice-one/read', () => {
      if (!succeed)
        return HttpResponse.json(
          {
            error: {
              code: 'notifications.unavailable',
              request_id: 'read-retry',
              message: 'Unavailable',
            },
          },
          { status: 503 },
        );
      readAt = '2026-09-26T01:00:00Z';
      return HttpResponse.json({ ...notice, read_at: readAt });
    }),
  );
  const user = open();
  await user.click(await screen.findByRole('button', { name: '标记已读' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('read-retry');
  expect(screen.getByText('1 条未读')).toBeVisible();
  succeed = true;
  await user.click(screen.getByRole('button', { name: '标记已读' }));
  expect(await screen.findByText('已读')).toBeVisible();
});

test('paging and unread filtering use server cursors and refresh returns to recent notices', async () => {
  server.use(
    http.get('http://api.test/api/v1/notifications', ({ request }) => {
      const url = new URL(request.url);
      const unread = url.searchParams.get('unread_only') === 'true';
      const next = url.searchParams.get('cursor');
      return HttpResponse.json(
        unread
          ? { data: [], unread_count: 0, next_cursor: null, has_more: false }
          : {
              data: [
                {
                  ...notice,
                  id: next ? 'old' : 'new',
                  subject: next ? '早期任务' : '最新任务',
                },
              ],
              unread_count: 2,
              next_cursor: next ? null : 'next-page',
              has_more: !next,
            },
      );
    }),
  );
  const user = open();
  expect(await screen.findByText('最新任务失败')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '加载更多通知' }));
  expect(await screen.findByText('早期任务失败')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '刷新通知' }));
  await waitFor(() =>
    expect(screen.queryByText('早期任务失败')).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole('button', { name: '只看未读' }));
  expect(await screen.findByText('暂无未读通知')).toBeVisible();
  expect(screen.queryByText('最新任务失败')).not.toBeInTheDocument();
});
