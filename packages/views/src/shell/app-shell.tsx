import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { ModuleIcon } from '@saas/ui/components/module-icon';
import type { AssembledApp } from './app-contract';
import { coreModuleIcons } from './module-registry';
import { useAppMessage } from './messages';
import { BusinessNavigation, sidebarLinkClass } from './app-navigation';

// The shell layout (docs/ui/design.md §4): a left sidebar — assembled
// business groups, notifications, the permission-gated administration
// group, and the bottom utility entries — beside the main workspace. On
// narrow screens the sidebar folds into a drawer behind a toggling button
// (touch targets stay ≥44px); on wide screens it is a sticky column. The
// shell never knows which example a group came from — it renders the
// assembled result and consumes ports for opening paths.

export type ShellRole = 'owner' | 'admin' | 'member';

export function AppShellLayout({
  navigation,
  moduleIcons,
  role,
  onOpen,
  children,
}: {
  navigation?: AssembledApp['navigation'];
  /** Assembled module colors for the business links above. */
  moduleIcons?: AssembledApp['moduleIcons'];
  role?: ShellRole;
  /** Router port for opening paths without a full page load. */
  onOpen?: (path: string) => void;
  children: ReactNode;
}) {
  const message = useAppMessage();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);
  const signedIn = role !== undefined;
  const canAdmin = role === 'owner' || role === 'admin';

  // The drawer is a passive navigation surface: Escape dismisses it, and
  // the toggle button carries the state (full focus containment is not
  // required for a non-modal drawer).
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // One icon lookup for every sidebar link: the shell's core registry
  // first, then the assembled example colors (which can never shadow a
  // core path — assembly refuses that).
  const icons = { ...coreModuleIcons, ...moduleIcons };
  const link = (path: string, label: string, extraClassName?: string) => {
    const icon = icons[path];
    return (
      <a
        href={path}
        className={sidebarLinkClass + (extraClassName ?? '')}
        onClick={(event) => {
          if (onOpen) {
            event.preventDefault();
            onOpen(path);
          }
          close();
        }}
      >
        {icon ? (
          <ModuleIcon
            icon={icon.icon}
            variant={icon.variant}
            appearance="bare"
            size="sm"
          />
        ) : null}
        {label}
      </a>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {message('shell.nav.skipToContent')}
      </a>
      {menuOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          aria-hidden="true"
          onClick={close}
        />
      ) : null}
      <aside
        id="app-sidebar"
        className={
          (menuOpen
            ? 'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar'
            : 'hidden') +
          ' lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-sidebar'
        }
      >
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-semibold">{message('app.name')}</span>
          <button
            type="button"
            aria-label={message('shell.nav.closeMenu')}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
            onClick={close}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <nav
          aria-label={message('shell.nav.mainMenu')}
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4"
        >
          {navigation && navigation.length > 0 ? (
            <BusinessNavigation
              navigation={navigation}
              moduleIcons={icons}
              onOpen={(path) => {
                if (onOpen) onOpen(path);
                close();
              }}
            />
          ) : null}
          <div className="flex flex-col gap-1">
            {link('/', message('shell.nav.home'))}
            {signedIn
              ? link('/notifications', message('shell.nav.notifications'))
              : null}
          </div>
          {canAdmin ? (
            <div className="flex flex-col gap-1">
              <h3 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {message('shell.nav.management')}
              </h3>
              {link('/members', message('shell.nav.members'))}
              {link('/jobs', message('shell.nav.jobs'))}
              {link('/audit', message('shell.nav.audit'))}
            </div>
          ) : null}
          <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
            {/* The bottom block converges on 设置 (§5): the sections live
                on the settings page; only the high-frequency, permission-
                gated shortcuts stay as direct entries. Tutorials moved
                into settings#help. */}
            {link('/settings', message('shell.nav.settings'))}
            {signedIn ? link('/api-keys', message('shell.nav.apiKeys')) : null}
            {signedIn
              ? link('/design-system', message('shell.nav.designSystem'))
              : null}
            {link('/system', message('shell.nav.status'))}
          </div>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-2 py-1 lg:hidden">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            aria-label={message('shell.nav.openMenu')}
            className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <span className="text-sm font-semibold">{message('app.name')}</span>
        </header>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
