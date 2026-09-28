import { RateLimitHint } from '../system/rate-limit';
import { AppShellLayout, type ShellRole } from '../shell/app-shell';
import { usePageTitle } from '../shell/page-title';
import { useAppMessage } from '../shell/messages';
import type { AssembledApp } from '../shell/app-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logoutUser, type ApiClient } from '@saas/sdk';
import { Alert, AlertDescription, AlertTitle } from '@saas/ui/components/alert';
import { Badge } from '@saas/ui/components/badge';
import { Button, buttonVariants } from '@saas/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { replaceSession, sessionQuery } from './session';

export function HomeView({
  apiClient,
  docsUrl,
  navigation,
  onOpenNavigation,
}: {
  apiClient: ApiClient;
  docsUrl: string;
  navigation?: AssembledApp['navigation'];
  onOpenNavigation?: (path: string) => void;
}) {
  const message = useAppMessage();
  usePageTitle('shell.nav.home');
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const logout = useMutation({
    mutationFn: async () => {
      if (!session.data) return;
      const result = await logoutUser({
        client: apiClient,
        headers: { 'x-csrf-token': session.data.csrf_token },
      });
      if (result.response?.status === 401) return;
      if (result.error) throw result.error;
    },
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      await replaceSession(queryClient, apiClient, null);
    },
  });
  const user = session.data?.user;
  const role: ShellRole | undefined = user?.role;
  return (
    <AppShellLayout
      navigation={user ? navigation : undefined}
      role={role}
      docsUrl={docsUrl}
      onOpen={onOpenNavigation}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col justify-center gap-6 px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">
                {user
                  ? message('home.greeting', {
                      name: user.display_name || user.email,
                    })
                  : message('home.title')}
              </h1>
            </CardTitle>
            <CardDescription>
              {user
                ? message('home.signedInHint')
                : message('home.signedOutHint')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {session.isPending ? (
              <p role="status">{message('home.loadingSession')}</p>
            ) : null}
            {session.isError ? (
              <>
                <Alert variant="destructive">
                  <AlertTitle>{message('home.sessionError')}</AlertTitle>
                  <AlertDescription>
                    {message('home.sessionErrorHint')}
                    <RateLimitHint error={session.error} />
                  </AlertDescription>
                </Alert>
                <Button
                  className="w-fit"
                  onClick={() => {
                    void session.refetch();
                  }}
                >
                  {message('common.retry')}
                </Button>
              </>
            ) : null}
            {user ? (
              <>
                <p>{user.email}</p>
                <Badge variant="secondary">
                  {message(`home.role.${user.role}`)}
                </Badge>
                {logout.isError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{message('home.logoutError')}</AlertTitle>
                    <AlertDescription>
                      {message('home.sessionErrorHint')}
                      <RateLimitHint error={logout.error} />
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  variant="outline"
                  className="w-fit"
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  {logout.isPending
                    ? message('home.loggingOut')
                    : message('home.logout')}
                </Button>
              </>
            ) : session.isSuccess ? (
              <>
                <a href="/login" className={buttonVariants() + ' w-fit'}>
                  {message('login.submit')}
                </a>
                <a
                  href="/register"
                  className={buttonVariants({ variant: 'outline' }) + ' w-fit'}
                >
                  {message('home.registerAccount')}
                </a>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShellLayout>
  );
}
