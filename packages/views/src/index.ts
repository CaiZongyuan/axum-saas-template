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
// example:knowledge:views:end
