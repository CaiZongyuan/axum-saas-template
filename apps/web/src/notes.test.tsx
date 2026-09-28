import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createApiClient, type CurrentSession } from '@saas/sdk';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../../../tests/frontend/server';
import { createAppRouter } from './router';
import { assembledApp } from './app-examples';

const signedIn = {
  user: {
    id: 'notes-reader',
    email: 'notes@example.com',
    display_name: '便签用户',
    role: 'member',
  },
  csrf_token: 'notes-csrf',
} satisfies CurrentSession;

function open(path = '/') {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(signedIn),
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

test('the notes page opens from the home business navigation and renders its own messages', async () => {
  const { user, router } = open('/');
  const navigation = await screen.findByRole('navigation', {
    name: '业务导航',
  });
  await user.click(within(navigation).getByRole('link', { name: '便签示例' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
  expect(
    await screen.findByRole('heading', { name: '便签示例页' }),
  ).toBeVisible();
});

test('a direct /notes deep link renders without any backend call', async () => {
  const { router } = open('/notes');
  expect(
    await screen.findByRole('heading', { name: '便签示例页' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe('/notes');
});

test('assembly carries the notes messages and scene in both locales', () => {
  expect(assembledApp.messages.zh['notes.nav.notes']).toBe('便签示例');
  expect(assembledApp.messages.en['notes.nav.notes']).toBe('Notes example');
  expect(assembledApp.scenes.map(({ scene }) => scene.id)).toContain(
    'notes-demo',
  );
});
