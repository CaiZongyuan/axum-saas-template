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
function open(role: CurrentSession['user']['role'] = 'member') {
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
    createMemoryHistory({ initialEntries: ['/api-keys'] }),
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

const key = {
  id: 'key-one',
  user_id: 'reader',
  name: 'My script',
  prefix: 'saas_key_abcd1234',
  scopes: ['profile:read'],
  created_at: '2026-09-26T00:00:00Z',
  expires_at: '2026-10-26T00:00:00Z',
  revoked_at: null,
  last_used_at: null,
} satisfies import('@saas/sdk').KeyInfo;
const secret = 'test-only-one-time-key';

test('creating a key reveals its secret once and refresh or leaving never reveals it again', async () => {
  let created = false;
  server.use(
    http.get('http://api.test/api/v1/api-keys/scopes', () =>
      HttpResponse.json({
        data: [{ id: 'profile:read', label: '读取自己的基本资料' }],
      }),
    ),
    http.get('http://api.test/api/v1/api-keys', () =>
      HttpResponse.json({
        data: created ? [key] : [],
        next_cursor: null,
        has_more: false,
      }),
    ),
    http.post('http://api.test/api/v1/api-keys', async ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf-proof');
      expect(await request.json()).toEqual({
        name: 'My script',
        scopes: ['profile:read'],
        expires_in_days: 30,
      });
      created = true;
      return HttpResponse.json({ key, secret }, { status: 201 });
    }),
  );
  const user = open();
  expect(await screen.findByText('还没有 API Key')).toBeVisible();
  await user.type(screen.getByLabelText('名称'), 'My script');
  await user.click(screen.getByRole('switch', { name: '读取自己的基本资料' }));
  await user.click(screen.getByRole('button', { name: '创建密钥' }));
  expect(await screen.findByLabelText('新密钥（只显示这一次）')).toHaveValue(
    secret,
  );
  await user.click(screen.getByRole('button', { name: '复制密钥' }));
  expect(await screen.findByText('已复制')).toBeVisible();
  expect(await navigator.clipboard.readText()).toBe(secret);
  await user.click(screen.getByRole('button', { name: '我已保存，隐藏密钥' }));
  expect(
    screen.queryByLabelText('新密钥（只显示这一次）'),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '刷新密钥' }));
  expect(await screen.findByText('saas_key_abcd1234')).toBeVisible();
  expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回首页' }));
  expect(await screen.findByRole('link', { name: 'API Keys' })).toBeVisible();
});

test('a failed revocation can retry and a revoked key stays visible as metadata only', async () => {
  let fail = true;
  let revokedAt: string | null = null;
  server.use(
    http.get('http://api.test/api/v1/api-keys/scopes', () =>
      HttpResponse.json({
        data: [{ id: 'profile:read', label: '读取自己的基本资料' }],
      }),
    ),
    http.get('http://api.test/api/v1/api-keys', () =>
      HttpResponse.json({
        data: [{ ...key, revoked_at: revokedAt }],
        next_cursor: null,
        has_more: false,
      }),
    ),
    http.delete('http://api.test/api/v1/api-keys/key-one', ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe('csrf-proof');
      if (fail)
        return HttpResponse.json(
          {
            error: {
              code: 'api_keys.unavailable',
              request_id: 'revoke-retry',
              message: 'Unavailable',
            },
          },
          { status: 503 },
        );
      revokedAt = '2026-09-26T01:00:00Z';
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const user = open();
  await user.click(
    await screen.findByRole('button', { name: '撤销 My script' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('revoke-retry');
  fail = false;
  await user.click(screen.getByRole('button', { name: '撤销 My script' }));
  expect(await screen.findByText('已撤销')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '撤销 My script' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('新密钥（只显示这一次）'),
  ).not.toBeInTheDocument();
});

test('a failed creation keeps inputs and does not automatically issue another credential', async () => {
  let attempts = 0;
  server.use(
    http.get('http://api.test/api/v1/api-keys/scopes', () =>
      HttpResponse.json({
        data: [{ id: 'profile:read', label: '读取自己的基本资料' }],
      }),
    ),
    http.get('http://api.test/api/v1/api-keys', () =>
      HttpResponse.json({ data: [], next_cursor: null, has_more: false }),
    ),
    http.post('http://api.test/api/v1/api-keys', () => {
      attempts++;
      return HttpResponse.json(
        {
          error: {
            code: 'api_keys.unavailable',
            request_id: 'create-uncertain',
            message: 'Unavailable',
          },
        },
        { status: 503 },
      );
    }),
  );
  const user = open();
  await user.type(await screen.findByLabelText('名称'), 'Keep this name');
  await user.click(
    await screen.findByRole('switch', { name: '读取自己的基本资料' }),
  );
  await user.click(screen.getByRole('button', { name: '创建密钥' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '请刷新列表确认是否已创建',
  );
  expect(screen.getByLabelText('名称')).toHaveValue('Keep this name');
  await user.click(screen.getByRole('button', { name: '刷新密钥' }));
  expect(await screen.findByText('还没有 API Key')).toBeVisible();
  expect(attempts).toBe(1);
  expect(
    screen.queryByLabelText('新密钥（只显示这一次）'),
  ).not.toBeInTheDocument();
});
