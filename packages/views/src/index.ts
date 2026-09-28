export {
  ForgotPasswordView,
  ResetPasswordView,
} from './identity/password-reset-views';
export { ApiKeysView } from './api-keys/api-keys-view';
export { AuditView } from './audit/audit-view';
export {
  NotificationsView,
  type NotificationTargetResolver,
} from './notifications/notifications-view';
export { StatusView } from './system/status-view';
export { RegisterView } from './identity/register-view';
export { HomeView } from './identity/home-view';
export { LoginView } from './identity/login-view';
export { JobsView, JobView } from './jobs/jobs-view';
export { MembersView } from './organization/members-view';
// The universal shell and its composition contract: Core-owned, imported
// by the app assembly point and never by example code.
export {
  assembleApp,
  CORE_RESERVED_ROUTES,
  type AppPage,
  type AppPageProps,
  type AppScene,
  type AssembledApp,
  type ExampleContribution,
  type NavigatePort,
  type NavigateTarget,
} from './shell/app-contract';
export { AppMessagesProvider } from './shell/messages';
export { BusinessNavigation } from './shell/app-navigation';
// example:knowledge:views:start
export {
  DocumentExportView,
  KnowledgeBaseView,
  KnowledgeBasesView,
  DocumentsView,
  NewDocumentView,
  DocumentView,
  EditDocumentView,
} from './knowledge';
export type { FileTransfer } from './knowledge';
export { createKnowledgeExample } from './knowledge/app-example';
export {
  DocumentGuardContext,
  useDocumentGuard,
  type DocumentGuardValue,
} from './knowledge/document-guard';
// example:knowledge:views:end
// example:notes:views:start
export { createNotesExample } from './notes/example';
// example:notes:views:end
