import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createApiClient, type CurrentSession, type Document } from '@saas/sdk';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

test('failed saves retain input and retry the same payload with the same idempotency key', async () => {
  const keys: string[] = [];
  server.use(
    http.post('http://api.test/api/v1/knowledge/documents', ({ request }) => {
      keys.push(request.headers.get('idempotency-key') ?? '');
      if (keys.length === 1)
        return HttpResponse.json(
          {
            error: {
              code: 'knowledge.unavailable',
              message: 'Try later',
              details: {},
              request_id: 'save-failed',
            },
          },
          { status: 503 },
        );
      return HttpResponse.json(document, { status: 201 });
    }),
    http.get(`http://api.test/api/v1/knowledge/documents/${document.id}`, () =>
      HttpResponse.json(document),
    ),
  );
  const { user, router } = open('/documents/new');
  await user.type(await screen.findByLabelText('标题'), document.title);
  await user.type(screen.getByLabelText('Markdown 正文'), document.markdown);
  await user.click(screen.getByRole('button', { name: '保存文档' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('save-failed');
  expect(screen.getByLabelText('标题')).toHaveValue(document.title);
  expect(screen.getByLabelText('Markdown 正文')).toHaveValue(document.markdown);
  expect(router.state.location.pathname).toBe('/documents/new');
  await user.click(screen.getByRole('button', { name: '保存文档' }));
  expect(
    await screen.findByRole('heading', { name: document.title }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test('a denied document displays a safe error without the document body', async () => {
  server.use(
    http.get(`http://api.test/api/v1/knowledge/documents/${document.id}`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'knowledge.not_found',
            message: 'Not found',
            details: {},
            request_id: 'denied-document',
          },
        },
        { status: 404 },
      ),
    ),
  );
  open(`/documents/${document.id}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('文档不存在');
  expect(screen.queryByText(/# 欢迎/)).not.toBeInTheDocument();
});

const identity = {
  user: {
    id: 'member-one',
    email: 'writer@example.com',
    display_name: '写作者',
    role: 'member',
  },
  csrf_token: 'csrf-proof',
} satisfies CurrentSession;
const document = {
  id: '018f0000-0000-7000-8000-000000000001',
  knowledge_base_id: '018f0000-0000-7000-8000-000000000002',
  title: '团队手册',
  markdown: '# 欢迎\n第一篇正文',
  version: 1,
  created_by: identity.user.id,
  updated_by: identity.user.id,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
} satisfies Document;

function open(path = '/documents') {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(identity),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router, queryClient };
}

test('a save completing during an identity refresh cannot repopulate the former identity cache', async () => {
  let releaseSave!: (response: Response) => void;
  let releaseList!: (response: Response) => void;
  let sawRefetch!: () => void;
  const saved = new Promise<Response>((resolve) => {
    releaseSave = resolve;
  });
  const refreshed = new Promise<Response>((resolve) => {
    releaseList = resolve;
  });
  const refetchStarted = new Promise<void>((resolve) => {
    sawRefetch = resolve;
  });
  let listCalls = 0;
  const empty = () =>
    HttpResponse.json({ data: [], next_cursor: null, has_more: false });
  server.use(
    http.post('http://api.test/api/v1/knowledge/documents', () => saved),
    http.get('http://api.test/api/v1/knowledge/documents', () => {
      if (++listCalls === 2) {
        sawRefetch();
        return refreshed;
      }
      return empty();
    }),
    http.get(`http://api.test/api/v1/knowledge/documents/${document.id}`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'knowledge.not_found',
            message: 'Not found',
            details: {},
            request_id: 'other-identity',
          },
        },
        { status: 404 },
      ),
    ),
  );
  const { user, router, queryClient } = open('/documents/new');
  queryClient.setQueryDefaults(['knowledge', 'document'], { gcTime: Infinity });
  await user.type(await screen.findByLabelText('标题'), document.title);
  await user.click(screen.getByRole('button', { name: '保存文档' }));
  await user.click(screen.getByRole('button', { name: '我的文档' }));
  await screen.findByText('暂无可访问的文档');
  try {
    await act(async () => {
      releaseSave(HttpResponse.json(document, { status: 201 }));
      await refetchStarted;
    });
    server.use(
      http.get('http://api.test/api/v1/auth/session', () =>
        HttpResponse.json({
          ...identity,
          user: { ...identity.user, id: 'member-two' },
        }),
      ),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    });
    expect(router.state.location.pathname).toBe('/documents');
    expect(
      queryClient.getQueryData([
        'knowledge',
        'document',
        identity.user.id,
        document.id,
      ]),
    ).toBeUndefined();
  } finally {
    releaseList(empty());
  }
});

test('an empty personal space leads to creation and the saved document detail', async () => {
  server.use(
    http.get('http://api.test/api/v1/knowledge/documents', () =>
      HttpResponse.json({ data: [], next_cursor: null, has_more: false }),
    ),
    http.post(
      'http://api.test/api/v1/knowledge/documents',
      async ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe(identity.csrf_token);
        expect(request.headers.get('idempotency-key')).toBeTruthy();
        expect(await request.json()).toEqual({
          title: document.title,
          markdown: document.markdown,
        });
        return HttpResponse.json(document, { status: 201 });
      },
    ),
    http.get(`http://api.test/api/v1/knowledge/documents/${document.id}`, () =>
      HttpResponse.json(document),
    ),
  );
  const { user, router } = open();
  expect(await screen.findByText('暂无可访问的文档')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '新建文档' }));
  await user.type(await screen.findByLabelText('标题'), document.title);
  await user.type(screen.getByLabelText('Markdown 正文'), document.markdown);
  await user.click(screen.getByRole('button', { name: '保存文档' }));
  expect(
    await screen.findByRole('heading', { name: document.title }),
  ).toBeVisible();
  expect(screen.getByText(/# 欢迎\s+第一篇正文/)).toBeVisible();
  expect(router.state.location.pathname).toBe(`/documents/${document.id}`);
});
