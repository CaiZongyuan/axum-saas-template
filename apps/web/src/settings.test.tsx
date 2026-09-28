import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createApiClient, type CurrentSession } from '@saas/sdk';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

// The appearance-and-language page (UI04): an explicit choice applies
// instantly, updates the document, persists on the device, and never
// reloads the app — typed input survives a language switch. Signed in
// (UI05), the page also offers the design-system showroom entry (§6 Q3).

const signedIn = {
  user: {
    id: 'settings-user',
    email: 'settings@example.com',
    display_name: '设置用户',
    role: 'member',
  },
  csrf_token: 'settings-csrf',
} satisfies CurrentSession;

function open(path = '/', session: 'anonymous' | CurrentSession = 'anonymous') {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      session === 'anonymous'
        ? HttpResponse.json(null, { status: 401 })
        : HttpResponse.json(session),
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
  return { user: userEvent.setup(), router };
}

test('the settings page is reachable signed out and renames the document', async () => {
  open('/settings');
  expect(
    await screen.findByRole('heading', { name: '外观与语言' }),
  ).toBeVisible();
  expect(document.title).toBe('外观与语言 · SaaS 模板');
  // The tutorial link deep-links into this chapter's zh docs page — never
  // the site-root landing.
  expect(
    screen.getByRole('link', { name: '查看「外观与语言」教程' }),
  ).toHaveAttribute('href', 'https://docs.test/tutorials/appearance-language');
});

test('an explicit language applies instantly, persists, and survives a remount', async () => {
  const { user } = open('/settings');
  await screen.findByRole('heading', { name: '外观与语言' });
  expect(document.documentElement.lang).toBe('zh-CN');

  await user.click(screen.getByRole('radio', { name: 'English' }));
  // Applied to the running document without any reload…
  expect(document.documentElement.lang).toBe('en');
  // …persisted on the device…
  expect(window.localStorage.getItem('saas.locale')).toBe('en');
  // …and visible in the same mounted tree (the sidebar renames live).
  expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  expect(
    await screen.findByRole('heading', { name: 'Appearance & language' }),
  ).toBeVisible();
  // Language names never translate themselves: both options stay readable
  // in their own language so a user who picked the wrong one can recover.
  expect(screen.getByRole('radio', { name: '简体中文' })).toBeVisible();

  await user.click(screen.getByRole('radio', { name: '简体中文' }));
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(window.localStorage.getItem('saas.locale')).toBe('zh');
  expect(screen.getByRole('navigation', { name: '主菜单' })).toBeVisible();
});

test('an explicit theme toggles the dark document immediately and persists', async () => {
  const { user } = open('/settings');
  await screen.findByRole('heading', { name: '外观与语言' });

  await user.click(screen.getByRole('radio', { name: '暗色' }));
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(window.localStorage.getItem('saas.theme')).toBe('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');

  await user.click(screen.getByRole('radio', { name: '亮色' }));
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(window.localStorage.getItem('saas.theme')).toBe('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
});

test('switching language keeps typed input: no reload, nothing lost', async () => {
  const { user } = open('/login');
  const email = await screen.findByLabelText('邮箱');
  await user.type(email, 'person@example.com');

  // The auth pages carry the same toggles, usable before any sign-in.
  await user.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByLabelText('Email')).toHaveValue('person@example.com');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('signed in, the page offers the design-system entry and it opens the showroom', async () => {
  const { user } = open('/settings', signedIn);
  await screen.findByRole('heading', { name: '外观与语言' });
  // The entry (§6 Q3: 设置 → 设计系统) reads as navigation into the
  // demo-data showroom; the sidebar reflects the same real session (both
  // appear once the session query resolves).
  expect(await screen.findByRole('link', { name: 'API Keys' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /设计系统/ }));
  expect(
    await screen.findByRole('heading', { name: '设计系统' }),
  ).toBeVisible();
});
