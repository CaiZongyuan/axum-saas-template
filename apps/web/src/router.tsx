import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import type { ApiClient } from '@saas/sdk';
import { StatusView } from '@saas/views';

type AppContext = { apiClient: ApiClient; docsUrl: string };
const rootRoute = createRootRouteWithContext<AppContext>()({
  component: Outlet,
});

function StatusPage() {
  const { apiClient, docsUrl } = rootRoute.useRouteContext();
  return <StatusView apiClient={apiClient} docsUrl={docsUrl} />;
}

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: StatusPage,
});
const routeTree = rootRoute.addChildren([statusRoute]);

export function createAppRouter(context: AppContext) {
  return createRouter({ routeTree, context });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
