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

// Shell behavior that must hold in every source combination (zero, one or
// two examples). The tests read the assembled app instead of naming a
// specific example, so this one file gates all four combos in CI; the
// per-example journeys live in the example-owned suites.

const signedIn = {
  user: {
    id: 'shell-user',
    email: 'shell@example.com',
    display_name: '壳用户',
    role: 'member',
  },
  csrf_token: 'shell-csrf',
} satisfies CurrentSession;

function open(path = '/') {
  server.use(
    http.get('http://api.test/api/v1/auth/session', () =>
      HttpResponse.json(signedIn),
    ),
    // A business entry page may list its resources; an empty page is valid.
    http.get('http://api.test/api/v1/knowledge/documents', () =>
      HttpResponse.json({
        data: [],
        next_cursor: null,
        has_more: false,
        can_create: true,
      }),
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

test('the Core home stays put; direct visits are never forced to a business entry', async () => {
  const { router } = open('/');
  await screen.findByRole('main');
  expect(router.state.location.pathname).toBe('/');
});

test('unknown paths fall back to the Core home without a loop', async () => {
  const { router } = open('/no-such-business-path');
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(await screen.findByRole('main')).toBeVisible();
});

test('business navigation mirrors the assembled groups and opens assembled routes', async () => {
  const { user, router } = open('/');
  await screen.findByRole('main');
  const navigation = screen.queryByRole('navigation', { name: '业务导航' });
  if (assembledApp.navigation.length === 0) {
    expect(navigation).toBeNull();
    return;
  }
  expect(navigation).not.toBeNull();
  // A group label may legitimately repeat as one of its item labels, so
  // presence is asserted with getAllByText.
  for (const group of assembledApp.navigation)
    expect(
      within(navigation as HTMLElement).getAllByText(
        assembledApp.messages.zh[group.labelKey],
      ).length,
    ).toBeGreaterThan(0);
  const first = assembledApp.navigation[0].items[0];
  await user.click(
    within(navigation as HTMLElement).getByText(
      assembledApp.messages.zh[first.labelKey],
    ),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe(first.path));
  expect(await screen.findByRole('main')).toBeVisible();
});

test('the business default entry is directly reachable as a deep link', async () => {
  if (assembledApp.defaultEntry === '/') return; // Core-only combo: home test covers '/'
  const { router } = open(assembledApp.defaultEntry);
  expect(await screen.findByRole('main')).toBeVisible();
  expect(router.state.location.pathname).toBe(assembledApp.defaultEntry);
});
