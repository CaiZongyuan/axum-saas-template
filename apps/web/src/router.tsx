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
import type { ApiClient, StatusFilter } from '@saas/sdk';
import {
  AppMessagesProvider,
  AppShellLayout,
  PreferencesProvider,
  sessionQuery,
  useFlowLocaleSetter,
  useAppMessage,
  usePageTitle,
  SettingsView,
  ForgotPasswordView,
  ResetPasswordView,
  ApiKeysView,
  AuditView,
  auditFilterFields,
  NotificationsView,
  StatusView,
  LoginView,
  RegisterView,
  HomeView,
  MembersView,
  JobsView,
  JobView,
  filterableStatuses,
  type AppLocale,
  type AssembledApp,
  type NavigateTarget,
} from '@saas/views';
import { assembledApp, exampleEntries } from './app-examples';
import { DesktopPreferencesMirror } from './desktop-preferences';

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
      {/* Desktop-only adapter: mirrors the appearance enums to the shell
          for its local error page; absent in plain browsers. */}
      <DesktopPreferencesMirror />
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

// Shell navigation keeps the URL's query conditions (job status, audit
// filters) alive across detours such as the settings page — switching the
// language or theme must not clear a legitimate query. Retention applies
// only to the routes that own search-param state and the preferences page
// hosting that detour; every other destination drops the keys, and the
// owning routes re-validate on arrival and strip foreign keys.
const queryRetainingPaths = new Set(['/jobs', '/audit', '/settings']);
function shellPathPort(
  navigate: ReturnType<typeof useNavigate>,
): (path: string) => void {
  return (path) => {
    void navigate({
      to: path,
      ...(queryRetainingPaths.has(path) ? { search: true as const } : {}),
    });
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
    const navigate = useNavigate();
    return (
      <StatusView
        apiClient={apiClient}
        docsUrl={docsUrl}
        onOpen={shellPathPort(navigate)}
      />
    );
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
        onOpenNavigation={shellPathPort(navigate)}
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
        onOpen={shellPathPort(navigate)}
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
          onOpen={shellPathPort(navigate)}
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
        onOpen={shellPathPort(navigate)}
        onLogin={() => {
          void navigate({ to: '/login' });
        }}
      />
    );
  },
});

// The status filter is a URL search param: a language/theme switch or a
// settings detour cannot clear a legitimate query, and filtered views
// stay shareable. The accepted values are the view's own filterable
// statuses — one source of truth for the validator and the select.
// Absent param defaults to `failed` (the administrator's working set);
// `all` lists every status.
const DEFAULT_JOB_STATUS = 'failed' as const;
type JobsSearch = { status?: StatusFilter | 'all' };
function validateJobsSearch(search: Record<string, unknown>): JobsSearch {
  const status = search.status;
  if (status === 'all') return { status: 'all' };
  if (
    typeof status === 'string' &&
    filterableStatuses.includes(status as StatusFilter)
  )
    return { status: status as StatusFilter };
  return {};
}
const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  validateSearch: validateJobsSearch,
  component: function JobsPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    const { status } = jobsRoute.useSearch();
    return (
      <JobsView
        apiClient={apiClient}
        docsUrl={docsUrl}
        onOpen={shellPathPort(navigate)}
        onOpenJob={(jobId) => {
          void navigate({ to: '/jobs/$jobId', params: { jobId } });
        }}
        status={status ?? DEFAULT_JOB_STATUS}
        onStatusChange={(next) => {
          void navigate({
            to: '/jobs',
            search: next === DEFAULT_JOB_STATUS ? {} : { status: next },
          });
        }}
      />
    );
  },
});

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs/$jobId',
  component: function JobPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const { jobId } = jobRoute.useParams();
    const navigate = useNavigate();
    return (
      <JobView
        apiClient={apiClient}
        docsUrl={docsUrl}
        jobId={jobId}
        onOpen={shellPathPort(navigate)}
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

// The reset link's fragment carries the secret token plus a non-sensitive
// language hint; both are read once and the fragment is cleared. The hint
// steers only this reset flow's language (docs/ui/design.md §6 Q8).
function resetLink(hash: string): {
  token: string | undefined;
  hint: AppLocale | undefined;
} {
  if (hash.length > 256) return { token: undefined, hint: undefined };
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token');
  const lang = params.get('lang');
  return {
    token: token && /^[0-9a-f]{64}$/i.test(token) ? token : undefined,
    hint: lang === 'zh' || lang === 'en' ? lang : undefined,
  };
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
      ...resetLink(hash),
      revision: 0,
    }));
    // A new email link may navigate within this mounted route. Capture it before
    // replacing the fragment; a fresh View drops prior form/success/request state.
    if (hash !== link.observedHash) {
      const parsed = resetLink(hash);
      setLink({
        observedHash: hash,
        token: hash ? parsed.token : link.token,
        hint: hash ? parsed.hint : link.hint,
        revision: hash ? link.revision + 1 : link.revision,
      });
    }
    useEffect(() => {
      if (hash)
        void navigate({ to: '/reset-password', hash: '', replace: true });
    }, [hash, navigate]);
    // The mail's language renders this flow (and only it) in that
    // language; each fresh link re-applies its hint, and leaving the
    // route hands the document back to the saved preference.
    const setFlowLocale = useFlowLocaleSetter();
    useEffect(() => {
      setFlowLocale(link.hint);
      return () => setFlowLocale(undefined);
    }, [link.revision, link.hint, setFlowLocale]);
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
        onOpen={shellPathPort(navigate)}
        copySecret={(secret) => navigator.clipboard.writeText(secret)}
      />
    );
  },
});

// Audit filter conditions are URL search params for the same reason as
// the job status filter: they survive language/theme switches, back
// navigation and bookmarks.
type AuditSearch = {
  action?: string;
  resource_id?: string;
  resource_type?: string;
  actor_id?: string;
  request_id?: string;
  correlation_id?: string;
  job_id?: string;
};
// The accepted keys are the view's own filter fields, so the URL state
// and the form cannot drift apart.
function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
  const next: AuditSearch = {};
  for (const key of auditFilterFields) {
    const value = search[key];
    if (typeof value === 'string' && value.trim()) next[key] = value;
  }
  return next;
}
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  validateSearch: validateAuditSearch,
  component: function AuditPage() {
    const { apiClient, docsUrl } = rootRoute.useRouteContext();
    const navigate = useNavigate();
    const search = auditRoute.useSearch();
    return (
      <AuditView
        apiClient={apiClient}
        docsUrl={docsUrl}
        onOpen={shellPathPort(navigate)}
        filters={search}
        onApplyFilters={(filters) => {
          void navigate({ to: '/audit', search: filters });
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
          onOpen={shellPathPort(navigate)}
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
