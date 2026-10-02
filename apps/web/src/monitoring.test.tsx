import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import {
  createApiClient,
  type CurrentSession,
  type MonitoringSnapshot,
  type MonitoringAlertRule,
} from '@saas/sdk';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

const identity = {
  user: {
    id: 'monitor-admin',
    email: 'admin@example.com',
    display_name: '管理员',
    role: 'admin',
  },
  csrf_token: 'monitor-csrf',
} satisfies CurrentSession;

function open(
  role: CurrentSession['user']['role'] = 'admin',
  path = '/settings?section=monitoring',
) {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json({ ...identity, user: { ...identity.user, role } }),
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
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router, ...view };
}

test('ordinary members cannot open detailed monitoring or see its settings entry', async () => {
  let reads = 0;
  server.use(
    http.get('http://api.test/api/v1/system/monitoring', () => {
      reads += 1;
      return HttpResponse.json({});
    }),
  );
  open('member');
  expect(
    await screen.findByText('仅企业所有者和管理员可以查看监控。'),
  ).toBeVisible();
  const directory = screen.getByRole('navigation', { name: '设置目录' });
  expect(
    within(directory).queryByRole('link', { name: '监控与诊断' }),
  ).toBeNull();
  expect(reads).toBe(0);
});

const snapshot = {
  checked_at: '2026-10-02T10:00:00Z',
  window_minutes: 15,
  services: { api: 'ready', database: 'ready', worker: 'unconfigured' },
  collection: { state: 'disabled', last_sample_at: null },
  http: null,
  jobs: {
    waiting: 4,
    running: 1,
    failed: 2,
    oldest_wait_seconds: 90,
    attempts: [],
  },
  grafana_url: null,
} satisfies MonitoringSnapshot;
const rule = {
  id: 'default',
  version: 1,
  enabled: false,
  error_rate_percent: 1,
  duration_minutes: 5,
  state: 'disabled',
  last_evaluated_at: null,
  breach_started_at: null,
} satisfies MonitoringAlertRule;
function monitoringHandlers(value = snapshot) {
  server.use(
    http.get('http://api.test/api/v1/system/monitoring', () =>
      HttpResponse.json(value),
    ),
    http.get('http://api.test/api/v1/system/monitoring/alerts', () =>
      HttpResponse.json(rule),
    ),
  );
}

test('disabled collection shows missing HTTP values but real queue state and accessible metric explanations', async () => {
  monitoringHandlers();
  const { user } = open();
  expect((await screen.findAllByText('未启用采集'))[0]).toBeVisible();
  expect(
    within(screen.getByRole('group', { name: '请求量' })).getByText('—'),
  ).toBeVisible();
  expect(
    within(screen.getByRole('group', { name: '排队中' })).getByText('4'),
  ).toBeVisible();
  const help = screen.getByRole('button', { name: '解释：P95 响应时间' });
  await user.hover(help);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('95%');
  await user.unhover(help);
  await user.click(help);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('95%');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
  await user.tab();
  await user.tab({ shift: true });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('95%');
});

test('changing the reporting window requests fresh values and a failed refresh hides stale metrics', async () => {
  let fail = false;
  const windows: string[] = [];
  monitoringHandlers();
  server.use(
    http.get('http://api.test/api/v1/system/monitoring', ({ request }) => {
      const window = new URL(request.url).searchParams.get('window_minutes')!;
      windows.push(window);
      return fail
        ? HttpResponse.json(
            {
              error: {
                code: 'monitoring.unavailable',
                request_id: 'monitor-retry',
              },
            },
            { status: 503 },
          )
        : HttpResponse.json({
            ...snapshot,
            window_minutes: Number(window),
            collection: {
              state: 'collecting',
              last_sample_at: snapshot.checked_at,
            },
            http: {
              requests: window === '60' ? 400 : 100,
              server_errors: 0,
              error_rate_percent: 0,
              p50_ms: 25,
              p95_ms: 90,
              series: [],
            },
          });
    }),
  );
  const { user } = open();
  expect(await screen.findByText('100')).toBeVisible();
  await user.selectOptions(
    screen.getByRole('combobox', { name: '统计时段' }),
    '60',
  );
  expect(await screen.findByText('400')).toBeVisible();
  expect(windows).toContain('60');
  fail = true;
  await user.click(screen.getByRole('button', { name: '刷新监控' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('monitor-retry');
  expect(screen.queryByText('400')).toBeNull();
  expect(
    within(screen.getByRole('group', { name: '请求量' })).getByText('—'),
  ).toBeVisible();
});

test('no HTTP requests leaves error rate and percentiles undefined', async () => {
  monitoringHandlers();
  server.use(
    http.get('http://api.test/api/v1/system/monitoring', () =>
      HttpResponse.json({
        ...snapshot,
        collection: {
          state: 'collecting',
          last_sample_at: snapshot.checked_at,
        },
        http: {
          requests: 0,
          server_errors: 0,
          error_rate_percent: null,
          p50_ms: null,
          p95_ms: null,
          series: [],
        },
      }),
    ),
  );
  open();
  await screen.findAllByText('正常采集');
  expect(
    within(screen.getByRole('group', { name: '请求量' })).getByText('0'),
  ).toBeVisible();
  for (const name of ['5xx 错误率', 'P50 响应时间', 'P95 响应时间']) {
    expect(
      within(screen.getByRole('group', { name })).getByText('—'),
    ).toBeVisible();
  }
});

test('a version conflict preserves the alert draft and loading the latest configuration allows saving', async () => {
  monitoringHandlers();
  let latest = { ...rule, enabled: true, state: 'normal' };
  let conflict = true;
  let submitted: unknown;
  server.use(
    http.get('http://api.test/api/v1/system/monitoring/alerts', () =>
      HttpResponse.json(latest),
    ),
    http.put(
      'http://api.test/api/v1/system/monitoring/alerts',
      async ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe(identity.csrf_token);
        submitted = await request.json();
        if (conflict) {
          latest = { ...latest, version: 2, error_rate_percent: 3 };
          return HttpResponse.json(
            {
              error: {
                code: 'monitoring.version_conflict',
                request_id: 'conflict',
              },
            },
            { status: 409 },
          );
        }
        latest = { ...latest, ...(submitted as typeof latest), version: 3 };
        return HttpResponse.json(latest);
      },
    ),
  );
  const { user } = open();
  await user.click(await screen.findByRole('tab', { name: '采集与告警' }));
  const rate = await screen.findByRole('spinbutton', {
    name: '错误率阈值（%）',
  });
  await user.clear(rate);
  await user.type(rate, '2');
  await user.click(screen.getByRole('button', { name: '保存告警' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '配置已被其他管理员更新',
  );
  expect(rate).toHaveValue(2);
  await user.click(screen.getByRole('tab', { name: '运行概况' }));
  await user.click(screen.getByRole('tab', { name: '采集与告警' }));
  expect(rate).toHaveValue(2);
  await user.click(screen.getByRole('button', { name: '载入最新配置' }));
  await screen.findByDisplayValue('3');
  await user.clear(rate);
  await user.type(rate, '4');
  conflict = false;
  await user.click(screen.getByRole('button', { name: '保存告警' }));
  expect(await screen.findByText('告警配置已保存。')).toBeVisible();
  expect(submitted).toMatchObject({
    version: 2,
    error_rate_percent: 4,
    duration_minutes: 5,
    enabled: true,
  });
});

test('a test alert creates a real inbox item and its Core destination opens monitoring', async () => {
  monitoringHandlers();
  let created = false;
  let read = false;
  const notification = {
    id: 'monitor-test',
    subject: 'monitoring',
    outcome: 'test',
    created_at: snapshot.checked_at,
    read_at: null,
    target: {
      kind: 'core.monitoring.alert',
      resource_id: 'default',
      context: {},
    },
  };
  server.use(
    http.post(
      'http://api.test/api/v1/system/monitoring/alerts/test',
      ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe(identity.csrf_token);
        created = true;
        return HttpResponse.json({ status: 'created' }, { status: 201 });
      },
    ),
    http.get('http://api.test/api/v1/notifications', () =>
      HttpResponse.json({
        data: created ? [notification] : [],
        unread_count: 1,
        has_more: false,
        next_cursor: null,
      }),
    ),
    http.post('http://api.test/api/v1/notifications/:id/read', () => {
      read = true;
      return HttpResponse.json({
        ...notification,
        read_at: snapshot.checked_at,
      });
    }),
  );
  const { user, router } = open();
  await user.click(await screen.findByRole('tab', { name: '采集与告警' }));
  await user.click(await screen.findByRole('button', { name: '发送测试通知' }));
  expect(await screen.findByText('测试通知已创建')).toBeVisible();
  expect(created).toBe(true);
  await user.click(
    within(screen.getByRole('navigation', { name: '主菜单' })).getByRole(
      'link',
      { name: '通知' },
    ),
  );
  expect(
    await screen.findByRole('heading', { name: '监控测试通知' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: '查看结果' }));
  expect(await screen.findByRole('tab', { name: '运行概况' })).toBeVisible();
  expect(read).toBe(true);
  expect(router.state.location.search).toEqual({ section: 'monitoring' });
});

test('revoking the current administrator removes displayed monitoring and refreshes permission', async () => {
  monitoringHandlers();
  let revoked = false;
  const { user } = open();
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json({
        ...identity,
        user: { ...identity.user, role: revoked ? 'member' : 'admin' },
      }),
    ),
    http.get('http://api.test/api/v1/system/monitoring', () =>
      revoked
        ? HttpResponse.json(
            { error: { code: 'system.forbidden', request_id: 'revoked' } },
            { status: 403 },
          )
        : HttpResponse.json(snapshot),
    ),
  );
  expect(await screen.findByRole('group', { name: '排队中' })).toBeVisible();
  revoked = true;
  await user.click(screen.getByRole('button', { name: '刷新监控' }));
  expect(
    await screen.findByText('仅企业所有者和管理员可以查看监控。'),
  ).toBeVisible();
  expect(screen.queryByRole('group', { name: '排队中' })).toBeNull();
  expect(screen.queryByRole('tab', { name: '采集与告警' })).toBeNull();
});

test('leaving a dirty alert through settings navigation can cancel or discard', async () => {
  monitoringHandlers();
  const { user, router } = open();
  await user.click(await screen.findByRole('tab', { name: '采集与告警' }));
  await user.click(await screen.findByRole('switch', { name: '启用站内告警' }));
  const directory = screen.getByRole('navigation', { name: '设置目录' });
  await user.click(within(directory).getByRole('link', { name: '外观与语言' }));
  const prompt = await screen.findByRole('alertdialog', {
    name: '告警配置尚未保存',
  });
  await user.click(within(prompt).getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('switch', { name: '启用站内告警' })).toBeChecked();
  expect(router.state.location.search).toEqual({ section: 'monitoring' });
  await user.click(within(directory).getByRole('link', { name: '外观与语言' }));
  await user.click(await screen.findByRole('button', { name: '放弃并离开' }));
  expect(await screen.findByRole('radio', { name: '简体中文' })).toBeVisible();
  await user.click(within(directory).getByRole('link', { name: '监控与诊断' }));
  await user.click(await screen.findByRole('tab', { name: '采集与告警' }));
  expect(
    await screen.findByRole('switch', { name: '启用站内告警' }),
  ).not.toBeChecked();
});
