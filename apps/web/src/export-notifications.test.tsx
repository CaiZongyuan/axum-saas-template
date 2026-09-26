import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import {
  createApiClient,
  type CurrentSession,
  type Notification,
  type DocumentExport,
} from '@saas/sdk';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

const documentId = '0195c9a0-0000-7000-8000-000000000001';
const exportId = '0195c9a0-0000-7000-8000-000000000002';
const identity = {
  user: {
    id: 'writer',
    email: 'writer@example.com',
    display_name: null,
    role: 'member',
  },
  csrf_token: 'csrf-proof',
} satisfies CurrentSession;
const notification = {
  id: 'notice-one',
  subject: '文档导出',
  outcome: 'succeeded',
  read_at: null,
  created_at: '2026-09-26T00:00:00Z',
  target: {
    kind: 'knowledge.export',
    resource_id: exportId,
    context: { document_id: documentId },
  },
} satisfies Notification;
const exported = {
  id: exportId,
  document_id: documentId,
  document_version: 3,
  status: 'succeeded',
  can_download: true,
  last_error: null,
  created_at: '2026-09-26T00:00:00Z',
  expires_at: '2026-09-27T00:00:00Z',
} satisfies DocumentExport;

function open(canAccess: boolean) {
  let readAt: string | null = null;
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(identity),
    ),
    http.get('http://api.test/api/v1/notifications', () =>
      HttpResponse.json({
        data: [{ ...notification, read_at: readAt }],
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
        return HttpResponse.json({ ...notification, read_at: readAt });
      },
    ),
    http.get(
      `http://api.test/api/v1/knowledge/documents/${documentId}/exports/${exportId}`,
      () =>
        canAccess
          ? HttpResponse.json(exported)
          : HttpResponse.json(
              {
                error: {
                  code: 'knowledge.not_found',
                  message: 'Not found',
                  request_id: 'revoked-result',
                },
              },
              { status: 404 },
            ),
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

test('opening an export notification marks it read and navigates to the exact authorized result', async () => {
  const user = open(true);
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  expect(
    await screen.findByRole('heading', { name: '导出详情' }),
  ).toBeVisible();
  expect(await screen.findByText('版本 3')).toBeVisible();
  expect(screen.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '返回通知' }));
  await waitFor(() => expect(screen.getByText('0 条未读')).toBeVisible());
  expect(screen.getByText('已读')).toBeVisible();
});

test('a notice cannot expose a result after access is revoked', async () => {
  const user = open(false);
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '文档不存在或访问权限已失效',
  );
  expect(
    screen.queryByRole('button', { name: '下载 ZIP' }),
  ).not.toBeInTheDocument();
});

test('leaving while a read is pending does not navigate back to the old export', async () => {
  let releaseRead!: () => void;
  let startedRead!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const started = new Promise<void>((resolve) => {
    startedRead = resolve;
  });
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(identity),
    ),
    http.get('http://api.test/api/v1/notifications', () =>
      HttpResponse.json({
        data: [notification],
        unread_count: 1,
        next_cursor: null,
        has_more: false,
      }),
    ),
    http.post(
      'http://api.test/api/v1/notifications/notice-one/read',
      async () => {
        startedRead();
        await gate;
        return HttpResponse.json({
          ...notification,
          read_at: '2026-09-26T01:00:00Z',
        });
      },
    ),
    http.get(
      `http://api.test/api/v1/knowledge/documents/${documentId}/exports/${exportId}`,
      () => HttpResponse.json(exported),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: ['/notifications'] }),
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  await started;
  await user.click(screen.getByRole('button', { name: '返回首页' }));
  expect(await screen.findByRole('link', { name: '通知' })).toBeVisible();
  releaseRead();
  // Settle the public QueryClient before checking that the completed request did not navigate.
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByRole('link', { name: '通知' })).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: '导出详情' }),
  ).not.toBeInTheDocument();
});
