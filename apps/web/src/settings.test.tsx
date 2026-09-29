import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createApiClient, type CurrentSession } from '@saas/sdk';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';

// The settings page (UI04, regrouped in UI-R3): preferences apply
// instantly through native radios, and the page groups appearance,
// account, API keys, the embedded design-system showroom and help into
// anchored sections. Signed-in state reveals the account sections; the
// `?section=` query deep-links to an anchor and survives navigation.

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
  expect(await screen.findByRole('heading', { name: '设置' })).toBeVisible();
  expect(document.title).toBe('设置 · SaaS 模板');
  // The appearance section keeps its tutorial deep link into the zh docs
  // chapter — never the site-root landing.
  expect(
    screen.getByRole('link', { name: '查看「外观与语言」教程' }),
  ).toHaveAttribute('href', 'https://docs.test/tutorials/appearance-language');
});

test('an explicit language applies instantly, persists, and survives a remount', async () => {
  const { user } = open('/settings');
  await screen.findByRole('heading', { name: '设置' });
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
  await screen.findByRole('heading', { name: '设置' });

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

test('signed in, the account sections appear with the embedded showroom', async () => {
  open('/settings', signedIn);
  await screen.findByRole('heading', { name: '设置' });
  // The account section names the signed-in identity…
  expect(await screen.findByText('settings@example.com')).toBeVisible();
  // …the API-keys section anchors for deep links…
  expect(
    document.querySelector('[data-settings-anchor="api-keys"]'),
  ).not.toBeNull();
  // …and the design-system section embeds the showroom itself (§6 Q3):
  // the production tabs render in place, no navigation needed.
  expect(
    await screen.findByRole('tab', { name: '基础', hidden: false }),
  ).toBeVisible();
  expect(
    document.querySelector('[data-settings-anchor="design-system"]'),
  ).not.toBeNull();
});

test('signed out, the account sections stay hidden', async () => {
  open('/settings');
  await screen.findByRole('heading', { name: '设置' });
  // Account, API keys and the showroom are authenticated capabilities;
  // only appearance and help render before sign-in.
  expect(screen.queryByRole('heading', { name: '设计系统' })).toBeNull();
  expect(
    document.querySelector('[data-settings-anchor="api-keys"]'),
  ).toBeNull();
  expect(screen.getByRole('heading', { name: '外观与语言' })).toBeVisible();
});

test('the section query survives on the settings route for deep links', async () => {
  const { router } = open('/settings?section=api-keys', signedIn);
  await screen.findByRole('heading', { name: 'API Keys' });
  // The validated param stays in the URL: a reload or back/forward keeps
  // landing on the same section instead of dropping the deep link.
  expect(router.state.location.search).toEqual({ section: 'api-keys' });
});

test('the section query scrolls the anchored section into view once it mounts', async () => {
  // jsdom has no scrollIntoView; the effect calls it optionally, so the
  // stub records which anchor the deep link actually landed on.
  const scrolled: (string | null)[] = [];
  const native = Element.prototype.scrollIntoView as unknown;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this.getAttribute('data-settings-anchor'));
  } as typeof Element.prototype.scrollIntoView;
  try {
    open('/settings?section=api-keys', signedIn);
    await screen.findByRole('heading', { name: 'API Keys' });
    // The scroll waits for the session-resolved anchor: the deep link
    // lands on the API-keys section, not the top of the page.
    expect(scrolled).toContain('api-keys');
  } finally {
    if (typeof native === 'function') {
      Element.prototype.scrollIntoView =
        native as typeof Element.prototype.scrollIntoView;
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  }
});

test('the help section links to the docs home and system status', async () => {
  open('/settings');
  await screen.findByRole('heading', { name: '设置' });
  // Scoped to the main landmark: the sidebar keeps its own 系统状态 entry.
  const main = within(screen.getByRole('main'));
  const docsLink = main.getByRole('link', { name: '使用教程' });
  expect(docsLink).toHaveAttribute('href', 'https://docs.test/docs/');
  expect(docsLink).toHaveAttribute('target', '_blank');
  expect(main.getByRole('link', { name: '系统状态' })).toHaveAttribute(
    'href',
    '/system',
  );
});
