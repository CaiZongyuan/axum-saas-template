import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ApiClient } from '@saas/sdk';
import {
  StatusView,
  RegisterView,
  HomeView,
  LoginView,
  MembersView,
} from '@saas/views';
// example:knowledge:imports:start
import { useDocumentNavigationGuard } from './knowledge-navigation';
import {
  KnowledgeBaseView,
  KnowledgeBasesView,
  DocumentsView,
  NewDocumentView,
  DocumentView,
  EditDocumentView,
} from '@saas/views';
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
      <a href="/members" className="text-sm underline">
        企业成员
      </a>
      {/* example:knowledge:home:start */}
      <a href="/knowledge-bases" className="text-sm underline">
        知识库
      </a>
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
function MembersPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <MembersView
      apiClient={apiClient}
      onBack={() => {
        void navigate({ to: '/' });
      }}
      onLogin={() => {
        void navigate({ to: '/login' });
      }}
    />
  );
}
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/members',
  component: MembersPage,
});
// example:knowledge:routes:start
function KnowledgeBasePage() {
  const { apiClient } = rootRoute.useRouteContext();
  const { baseId } = knowledgeBaseRoute.useParams();
  const navigate = useNavigate();
  return (
    <KnowledgeBaseView
      apiClient={apiClient}
      baseId={baseId}
      onBack={() => {
        void navigate({ to: '/knowledge-bases' });
      }}
      onLogin={() => {
        void navigate({ to: '/login' });
      }}
      onNew={() => {
        void navigate({
          to: '/knowledge-bases/$baseId/new',
          params: { baseId },
        });
      }}
      onOpen={(documentId) => {
        void navigate({ to: '/documents/$documentId', params: { documentId } });
      }}
    />
  );
}
const knowledgeBaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge-bases/$baseId',
  component: KnowledgeBasePage,
});
function KnowledgeBasesPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const navigate = useNavigate();
  return (
    <KnowledgeBasesView
      apiClient={apiClient}
      onBack={() => {
        void navigate({ to: '/' });
      }}
      onLogin={() => {
        void navigate({ to: '/login' });
      }}
      onOpen={(baseId) => {
        void navigate({ to: '/knowledge-bases/$baseId', params: { baseId } });
      }}
    />
  );
}
function NewLibraryDocumentPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const { baseId } = newLibraryDocumentRoute.useParams();
  const navigate = useNavigate();
  const guard = useDocumentNavigationGuard();
  return (
    <>
      {guard.prompt}
      <NewDocumentView
        apiClient={apiClient}
        knowledgeBaseId={baseId}
        onDirtyChange={guard.onDirtyChange}
        onBack={() => {
          void navigate({ to: '/knowledge-bases/$baseId', params: { baseId } });
        }}
        onCreated={(documentId) => {
          void navigate({
            to: '/documents/$documentId',
            params: { documentId },
            ignoreBlocker: true,
          });
        }}
      />
    </>
  );
}
const knowledgeBasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge-bases',
  component: KnowledgeBasesPage,
});
const newLibraryDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge-bases/$baseId/new',
  component: NewLibraryDocumentPage,
});
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
  const guard = useDocumentNavigationGuard();
  return (
    <>
      {guard.prompt}
      <NewDocumentView
        apiClient={apiClient}
        onDirtyChange={guard.onDirtyChange}
        onBack={() => {
          void navigate({ to: '/documents' });
        }}
        onCreated={(documentId) => {
          void navigate({
            to: '/documents/$documentId',
            params: { documentId },
            ignoreBlocker: true,
          });
        }}
      />
    </>
  );
}
function DocumentPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const { documentId } = documentRoute.useParams();
  const navigate = useNavigate();
  return (
    <DocumentView
      apiClient={apiClient}
      onLibrary={(baseId) => {
        void navigate({ to: '/knowledge-bases/$baseId', params: { baseId } });
      }}
      documentId={documentId}
      onEdit={() => {
        void navigate({
          to: '/documents/$documentId/edit',
          params: { documentId },
        });
      }}
      onBack={() => {
        void navigate({ to: '/documents' });
      }}
    />
  );
}
function EditDocumentPage() {
  const { apiClient } = rootRoute.useRouteContext();
  const { documentId } = editDocumentRoute.useParams();
  const navigate = useNavigate();
  const guard = useDocumentNavigationGuard();
  return (
    <>
      {guard.prompt}
      <EditDocumentView
        apiClient={apiClient}
        documentId={documentId}
        onDirtyChange={guard.onDirtyChange}
        onBack={() => {
          void navigate({
            to: '/documents/$documentId',
            params: { documentId },
          });
        }}
        onSaved={(id) => {
          void navigate({
            to: '/documents/$documentId',
            params: { documentId: id },
            ignoreBlocker: true,
          });
        }}
      />
    </>
  );
}
const editDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId/edit',
  component: EditDocumentPage,
});
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
  knowledgeBaseRoute,
  knowledgeBasesRoute,
  newLibraryDocumentRoute,
  editDocumentRoute,
  documentsRoute,
  newDocumentRoute,
  documentRoute,
  // example:knowledge:route-tree:end
  loginRoute,
  membersRoute,
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
