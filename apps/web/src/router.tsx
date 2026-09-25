import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ApiClient } from '@saas/sdk';
import { StatusView, RegisterView, HomeView } from '@saas/views';

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
  path: '/system',
  component: StatusPage,
});
function RegistrationPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <RegisterView
      apiClient={apiClient}
      onRegistered={() => {
        void navigate({ to: '/' });
      }}
    />
  );
}
function HomePage() {
  const { apiClient, docsUrl } = rootRoute.useRouteContext();
  return <HomeView apiClient={apiClient} docsUrl={docsUrl} />;
}
const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegistrationPage,
});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});
const routeTree = rootRoute.addChildren([
  homeRoute,
  registrationRoute,
  statusRoute,
]);

export function createAppRouter(context: AppContext, history?: RouterHistory) {
  return createRouter({ routeTree, context, history });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
