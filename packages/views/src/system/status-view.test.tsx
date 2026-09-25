import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient, type SystemStatus } from '@saas/sdk';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../../tests/frontend/server';
import { StatusView } from './status-view';

const readyStatus = {
  database: 'connected',
  schema_version: 1,
  service: 'saas-api',
  status: 'ok',
  version: '0.1.0',
} satisfies SystemStatus;

function renderStatus(timeoutMs?: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusView
        apiClient={createApiClient('http://api.test', { timeoutMs })}
        docsUrl="https://docs.test/"
      />
    </QueryClientProvider>,
  );
}

test('shows loading, then the real API contract result and tutorial entry', async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  server.use(http.get('http://api.test/api/v1/system/status', () => response));
  renderStatus();
  expect(screen.getByRole('status')).toHaveTextContent('正在检查服务连接');
  release(HttpResponse.json(readyStatus));
  expect(
    await screen.findByRole('heading', { name: '服务已就绪' }),
  ).toBeVisible();
  expect(screen.getByText('PostgreSQL 已连接')).toBeVisible();
  expect(screen.getByRole('link', { name: '阅读入门教程' })).toHaveAttribute(
    'href',
    'https://docs.test/',
  );
});

test('shows a correlated failure and lets the user retry after recovery', async () => {
  server.use(
    http.get('http://api.test/api/v1/system/status', () =>
      HttpResponse.json(
        {
          error: {
            code: 'database.unavailable',
            details: {},
            message: 'Database is not ready',
            request_id: 'req-503-test',
          },
        },
        { status: 503 },
      ),
    ),
  );
  renderStatus();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '暂时无法连接服务',
  );
  expect(screen.getByText('req-503-test')).toBeVisible();
  server.use(
    http.get('http://api.test/api/v1/system/status', () =>
      HttpResponse.json(readyStatus),
    ),
  );
  const user = (await import('@testing-library/user-event')).default.setup();
  await user.click(screen.getByRole('button', { name: '重新检查' }));
  expect(
    await screen.findByRole('heading', { name: '服务已就绪' }),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a non-responding service reaches an error state and enables retry', async () => {
  server.use(
    http.get(
      'http://api.test/api/v1/system/status',
      () => new Promise<Response>(() => {}),
    ),
  );
  renderStatus(30);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '暂时无法连接服务',
  );
  expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled();
});
