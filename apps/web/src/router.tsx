import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ApiClient } from '@saas/sdk';
import {
  AppMessagesProvider,
  AppShellLayout,
  PreferencesProvider,
  sessionQuery,
  useAppMessage,
  usePageTitle,
  SettingsView,
  ForgotPasswordView,
  ResetPasswordView,
  ApiKeysView,
  AuditView,
  NotificationsView,
  StatusView,
  LoginView,
  RegisterView,
  HomeView,
  MembersView,
  JobsView,
  JobView,
  type AssembledApp,
  type NavigateTarget,
} from '@saas/views';
import { assembledApp, exampleEntries } from './app-examples';

// The design-system page and its icon catalog load on demand
// (docs/ui/design.md §6 Q9): the subpath import keeps the design-system
// view — and everything it alone uses — out of the initial bundle, within
// the existing perf budgets.
const DesignSystemView = lazy(() => import('@saas/views/design-system'));

type AppContext = { apiClient: ApiClient; docsUrl: string };
const rootRoute = createRootRouteWithContext<AppContext>()({
  component: RootLayout,
  notFoundComponent: RouteNotFoundPage,
});

// The universal shell renders the assembled result; the actual Router
// wiring (TanStack) lives only in this adapter. Core pages are registered
// below, example pages come from the explicit assembly point. Preferences
// (language + appearance) wrap the message catalog so every page — auth
// included — renders in the resolved language and theme.

function RootLayout() {
  return (
    <PreferencesProvider>
      <AppMessagesProvider app={assembledApp}>
        <Outlet />
      </AppMessagesProvider>
    </PreferencesProvider>
  );
}

// Unknown paths render the shell's unavailable page instead of silently
// rewriting the address: the URL may be an old bookmark of a removed
// example, and the page keeps a visible way home without a loop.
function RouteNotFoundPage() {
  const message = useAppMessage();
  usePageTitle('unavailable.title');
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">{message('unavailable.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {message('unavailable.description')}
      </p>
      <button
        type="button"
        className="mt-4 text-sm underline"
        onClick={() => {
          void navigate({ to: '/' });
        }}
      >
        {message('unavailable.backHome')}
      </button>
    </main>
  );
}

// Example routes register at runtime, so TanStack's typed `to` unions can
// never list them; typed navigation stays impossible for them and both
// ports below go through the untyped options instead.
function navigateOptions(target: NavigateTarget) {
  return {
    to: target.path,
    params: target.params as never,
    replace: target.replace,
    ignoreBlocker: target.ignoreBlocker,
  };
}

function navigatePort(
  navigate: ReturnType<typeof useNavigate>,
): (target: NavigateTarget) => void {
  return (target) => {
    void navigate(navigateOptions(target));
  };
}

// Programmatic navigation to runtime-registered routes (tests, adapters).
export function navigateExample(
  router: ReturnType<typeof createAppRouter>,
  target: NavigateTarget,
): Promise<void> {
  return router.navigate(navigateOptions(target));
}

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/system',
  component: function StatusPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    return <StatusView apiClient={apiClient} docsUrl={docsUrl} />;
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: function LoginPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <LoginView
        apiClient={apiClient}
        onLoggedIn={() => {
          void navigate({ to: assembledApp.defaultEntry });
        }}
      />
    );
  },
});

const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: function RegistrationPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <RegisterView
        apiClient={apiClient}
        onRegistered={() => {
          void navigate({ to: assembledApp.defaultEntry });
        }}
      />
    );
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function HomePage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <HomeView
        apiClient={apiClient}
        docsUrl={docsUrl}
        navigation={assembledApp.navigation}
        onOpenNavigation={(path) => {
          void navigate({ to: path });
        }}
      />
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <SettingsView
        docsUrl={docsUrl}
        apiClient={apiClient}
        onOpen={(path) => {
          void navigate({ to: path });
        }}
      />
    );
  },
});

const designSystemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design-system',
  component: function DesignSystemPage() {
    const { docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    const message = useAppMessage();
    return (
      <Suspense
        fallback={
          <p role="status" className="p-8 text-sm text-muted-foreground">
            {message('design.pageLoading')}
          </p>
        }
      >
        <DesignSystemView
          docsUrl={docsUrl}
          scenes={assembledApp.scenes}
          copyText={(text) => navigator.clipboard.writeText(text)}
          onOpen={(path) => {
            void navigate({ to: path });
          }}
        />
      </Suspense>
    );
  },
});

const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/members',
  component: function MembersPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <MembersView
        apiClient={apiClient}
        docsUrl={docsUrl}
        onOpen={(path) => {
          void navigate({ to: path });
        }}
        onLogin={() => {
          void navigate({ to: '/login' });
        }}
      />
    );
  },
});

const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  component: function JobsPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <JobsView
        apiClient={apiClient}
        onBack={() => {
          void navigate({ to: '/' });
        }}
        onOpenJob={(jobId) => {
          void navigate({ to: '/jobs/$jobId', params: { jobId } });
        }}
      />
    );
  },
});

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs/$jobId',
  component: function JobPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const { jobId } = jobRoute.useParams();
    const navigate = useNavigate();
    return (
      <JobView
        apiClient={apiClient}
        jobId={jobId}
        onBack={() => {
          void navigate({ to: '/jobs' });
        }}
      />
    );
  },
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: function ForgotPasswordPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <ForgotPasswordView
        apiClient={apiClient}
        onLogin={() => {
          void navigate({ to: '/login' });
        }}
      />
    );
  },
});

function resetToken(hash: string) {
  if (hash.length > 256) return undefined;
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return value && /^[0-9a-f]{64}$/i.test(value) ? value : undefined;
}

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: function ResetPasswordPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    const hash = useLocation({ select: (location) => location.hash });
    const [link, setLink] = useState(() => ({
      observedHash: hash,
      token: resetToken(hash),
      revision: 0,
    }));
    // A new email link may navigate within this mounted route. Capture it before
    // replacing the fragment; a fresh View drops prior form/success/request state.
    if (hash !== link.observedHash) {
      setLink({
        observedHash: hash,
        token: hash ? resetToken(hash) : link.token,
        revision: hash ? link.revision + 1 : link.revision,
      });
    }
    useEffect(() => {
      if (hash)
        void navigate({ to: '/reset-password', hash: '', replace: true });
    }, [hash, navigate]);
    return (
      <ResetPasswordView
        apiClient={apiClient}
        key={link.revision}
        token={link.token}
        onConsumed={() =>
          setLink((current) => ({ ...current, token: undefined }))
        }
        onLogin={() => {
          void navigate({ to: '/login' });
        }}
        onRequest={() => {
          void navigate({ to: '/forgot-password' });
        }}
      />
    );
  },
});

const apiKeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/api-keys',
  component: function ApiKeysPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <ApiKeysView
        apiClient={apiClient}
        docsUrl={docsUrl}
        onOpen={(path) => {
          void navigate({ to: path });
        }}
        copySecret={(secret) => navigator.clipboard.writeText(secret)}
      />
    );
  },
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: function AuditPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <AuditView
        apiClient={apiClient}
        onBack={() => {
          void navigate({ to: '/' });
        }}
      />
    );
  },
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: function NotificationsPage() {
    const { apiClient } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    return (
      <NotificationsView
        apiClient={apiClient}
        resolveTarget={
          assembledApp.resolveNotificationTarget
            ? (target) =>
                assembledApp.resolveNotificationTarget?.(target, {
                  navigate: navigatePort(navigate),
                })
            : undefined
        }
        onBack={() => {
          void navigate({ to: '/' });
        }}
      />
    );
  },
});

// Example pages: one adapter turns assembled descriptors into real routes;
// `provide` lets an example wrap its own pages with example-owned ports.
const provideByExample = new Map(
  exampleEntries.map((entry) => [entry.id, entry.provide]),
);

// Every example page renders inside the universal shell (docs/ui/design.md
// §4.1): the adapter — not the example — resolves the session for the
// role-aware navigation and owns the router ports. Example views render
// page content only; the shell provides the landmarks.
function adapterRoute(route: AssembledApp['routes'][number]) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path: route.path,
    component: function ExamplePage() {
      const params = useParams({ strict: false }) as Record<string, string>;
      const navigate = useNavigate();
      const { apiClient, docsUrl } = rootRoute.useRouteContext();
      const queryClient = useQueryClient();
      const session = useQuery(sessionQuery(apiClient, queryClient));
      const page = route.component({
        params,
        apiClient,
        navigate: navigatePort(navigate),
      });
      return (
        <AppShellLayout
          docsUrl={docsUrl}
          navigation={assembledApp.navigation}
          role={session.data?.user.role}
          onOpen={(path) => {
            void navigate({ to: path });
          }}
        >
          {provideByExample.get(route.exampleId)?.(page) ?? page}
        </AppShellLayout>
      );
    },
  });
}

const routeTree = rootRoute.addChildren([
  ...assembledApp.routes.map(adapterRoute),
  forgotPasswordRoute,
  resetPasswordRoute,
  apiKeysRoute,
  auditRoute,
  notificationsRoute,
  loginRoute,
  membersRoute,
  jobsRoute,
  jobRoute,
  settingsRoute,
  designSystemRoute,
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
