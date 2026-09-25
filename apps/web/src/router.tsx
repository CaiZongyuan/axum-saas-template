import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ApiClient } from '@saas/sdk';
import { StatusView, RegisterView, HomeView, LoginView } from '@saas/views';
// example:knowledge:imports:start
import { DocumentsView, NewDocumentView, DocumentView } from '@saas/views';
// example:knowledge:imports:end

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
  return (
    <HomeView apiClient={apiClient} docsUrl={docsUrl}>
      {/* example:knowledge:home:start */}
      <a href="/documents" className="text-sm underline">
        我的文档
      </a>
      {/* example:knowledge:home:end */}
    </HomeView>
  );
}
function LoginPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <LoginView
      apiClient={apiClient}
      onLoggedIn={() => {
        void navigate({ to: '/' });
      }}
    />
  );
}
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});
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
// example:knowledge:routes:start
function DocumentsPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <DocumentsView
      apiClient={apiClient}
      onNew={() => {
        void navigate({ to: '/documents/new' });
      }}
      onOpen={(documentId) => {
        void navigate({ to: '/documents/$documentId', params: { documentId } });
      }}
    />
  );
}
function NewDocumentPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <NewDocumentView
      apiClient={apiClient}
      onBack={() => {
        void navigate({ to: '/documents' });
      }}
      onCreated={(documentId) => {
        void navigate({ to: '/documents/$documentId', params: { documentId } });
      }}
    />
  );
}
function DocumentPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const { documentId } = documentRoute.useParams();
  const navigate = useNavigate();
  return (
    <DocumentView
      apiClient={apiClient}
      documentId={documentId}
      onBack={() => {
        void navigate({ to: '/documents' });
      }}
    />
  );
}
const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: DocumentsPage,
});
const newDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/new',
  component: NewDocumentPage,
});
const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId',
  component: DocumentPage,
});
// example:knowledge:routes:end

const routeTree = rootRoute.addChildren([
  // example:knowledge:route-tree:start
  documentsRoute,
  newDocumentRoute,
  documentRoute,
  // example:knowledge:route-tree:end
  loginRoute,
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
