import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import {
  createApiClient,
  type CurrentSession,
  type JobInfo,
  type JobDetails,
} from '@saas/sdk';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

const time = '2026-09-26T00:00:00Z';
const identity = {
  user: {
    id: 'owner',
    email: 'owner@example.com',
    display_name: null,
    role: 'owner',
  },
  csrf_token: 'csrf-proof',
} satisfies CurrentSession;
const job = {
  id: 'job-one',
  kind: 'reports.generate',
  schema_version: 1,
  status: 'failed',
  batch: 1,
  attempts: 1,
  max_attempts: 5,
  scheduled_at: time,
  lease_expires_at: time,
  last_error: 'reports.storage_unavailable',
  correlation_id: 'request-one',
  causation_id: null,
  created_at: time,
  updated_at: time,
  can_retry: true,
} satisfies JobInfo;
function details(current: JobInfo): JobDetails {
  return {
    job: current,
    batches: [
      {
        number: 1,
        max_attempts: 5,
        attempts: 1,
        legacy_attempts: 0,
        status: 'failed',
        requested_by: null,
        last_error: 'reports.storage_unavailable',
        created_at: time,
        ended_at: time,
      },
    ],
    attempts: [
      {
        batch: 1,
        number: 1,
        worker_id: 'worker-one',
        status: 'failed',
        last_error: 'reports.storage_unavailable',
        started_at: time,
        lease_expires_at: time,
        ended_at: time,
      },
    ],
    next_before_batch: null,
  };
}
function open(
  path = '/jobs/job-one',
  currentIdentity = () => identity as CurrentSession,
) {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(currentIdentity()),
    ),
  );
  const router = createAppRouter(
    {
      apiClient: createApiClient('http://api.test'),
      docsUrl: 'https://docs.test',
    },
    createMemoryHistory({ initialEntries: [path] }),
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

test('an administrator sees safe attempt history and explicitly starts a new execution batch', async () => {
  let current: JobInfo = job;
  server.use(
    http.get('http://api.test/api/v1/jobs/job-one', () =>
      HttpResponse.json(details(current)),
    ),
    http.post('http://api.test/api/v1/jobs/job-one/retry', ({ request }) => {
      expect(request.headers.get('x-csrf-token')).toBe(identity.csrf_token);
      expect(request.headers.get('idempotency-key')).toBeTruthy();
      current = {
        ...job,
        status: 'queued',
        batch: 2,
        attempts: 0,
        last_error: null,
        can_retry: false,
      };
      return HttpResponse.json(current, { status: 202 });
    }),
  );
  const user = open();
  expect(await screen.findByText('reports.storage_unavailable')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '重试失败任务' }));
  expect(await screen.findByText('等待处理')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试失败任务' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('当前第 2 批 · 已尝试 0 / 5 次')).toBeVisible();
});

test('a network failure retries the same command instead of accidentally opening two batches', async () => {
  const keys: string[] = [];
  let current: JobInfo = job;
  server.use(
    http.get('http://api.test/api/v1/jobs/job-one', () =>
      HttpResponse.json(details(current)),
    ),
    http.post('http://api.test/api/v1/jobs/job-one/retry', ({ request }) => {
      keys.push(request.headers.get('idempotency-key')!);
      if (keys.length === 1)
        return HttpResponse.json(
          {
            error: {
              code: 'jobs.unavailable',
              message: 'Try later',
              request_id: 'retry-failed',
            },
          },
          { status: 503 },
        );
      current = {
        ...job,
        status: 'queued',
        batch: 2,
        attempts: 0,
        last_error: null,
        can_retry: false,
      };
      return HttpResponse.json(current, { status: 202 });
    }),
  );
  const user = open();
  await user.click(await screen.findByRole('button', { name: '重试失败任务' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('retry-failed');
  await user.click(screen.getByRole('button', { name: '重试失败任务' }));
  expect(await screen.findByText('等待处理')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('a revoked administrator loses the cached job record after a rejected retry', async () => {
  let currentIdentity: CurrentSession = identity;
  server.use(
    http.get('http://api.test/api/v1/jobs/job-one', () =>
      HttpResponse.json(details(job)),
    ),
    http.post('http://api.test/api/v1/jobs/job-one/retry', () => {
      currentIdentity = {
        ...identity,
        user: { ...identity.user, role: 'member' },
      };
      return HttpResponse.json(
        {
          error: {
            code: 'jobs.forbidden',
            message: 'Forbidden',
            request_id: 'access-changed',
          },
        },
        { status: 403 },
      );
    }),
  );
  const user = open('/jobs/job-one', () => currentIdentity);
  await user.click(await screen.findByRole('button', { name: '重试失败任务' }));
  expect(
    await screen.findByText('仅企业所有者或管理员可以管理后台任务。'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '重试失败任务' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('reports.generate')).not.toBeInTheDocument();
});

test('changing the job status filter clears the old list and cursor', async () => {
  server.use(
    http.get('http://api.test/api/v1/jobs', ({ request }) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      expect(url.searchParams.has('cursor')).toBe(false);
      return HttpResponse.json({
        data: [{ ...job, id: status, status, can_retry: status === 'failed' }],
        next_cursor: null,
        has_more: false,
      });
    }),
  );
  const user = open('/jobs');
  expect(
    await screen.findByRole('button', { name: '查看任务 failed' }),
  ).toBeVisible();
  await user.selectOptions(screen.getByLabelText('任务状态'), 'queued');
  expect(
    await screen.findByRole('button', { name: '查看任务 queued' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: '查看任务 failed' }),
  ).not.toBeInTheDocument();
});
