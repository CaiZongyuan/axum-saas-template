import { type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApiClient, type CurrentSession } from '@saas/sdk';
import { sessionQuery } from '../identity';
import { AppShellLayout } from './app-shell';
import { ErrorAlert } from './error-alert';
import { useAppMessage } from './messages';
import { usePageTitle } from './page-title';

// Shared frame for administrator-only pages (docs/ui/design.md §4): the
// universal shell plus one session gate that keeps loading, sign-in and
// permission states explicit before the page content renders with the
// real identity. The role also drives the sidebar's administration group.
// A failed session request is a transport failure — the session query
// itself resolves 401 to null — so the alert reports the outage instead
// of claiming an expired session.
export function AdminFrame({
  apiClient,
  onOpen,
  titleKey,
  adminOnlyKey,
  children,
}: {
  apiClient: ApiClient;
  /** Router port for opening paths without a full page load. */
  onOpen?: (path: string) => void;
  titleKey: string;
  adminOnlyKey: string;
  children: (identity: CurrentSession) => ReactNode;
}) {
  const message = useAppMessage();
  usePageTitle(titleKey);
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  return (
    <AppShellLayout onOpen={onOpen} role={session.data?.user.role}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-semibold">{message(titleKey)}</h1>
        {session.isPending ? (
          <p role="status">{message('common.loadingSession')}</p>
        ) : session.isError ? (
          <ErrorAlert
            error={session.error}
            title={message('common.sessionUnavailable')}
          />
        ) : !session.data ? (
          <p>{message('common.signedOut')}</p>
        ) : session.data.user.role === 'member' ? (
          <p>{message(adminOnlyKey)}</p>
        ) : (
          children(session.data)
        )}
      </div>
    </AppShellLayout>
  );
}
