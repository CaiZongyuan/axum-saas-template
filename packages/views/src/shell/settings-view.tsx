import { lazy, Suspense, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '@saas/sdk';
import {
  SETTINGS_ANCHOR_ATTR,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsTab,
} from './settings-kit';
import { choiceRowClass } from './rows';
import { docsChapterUrl, docsHomeUrl } from './docs-links';
import { roleMessageKeys, useAppMessage } from './messages';
import {
  usePreferences,
  type AppLocale,
  type ThemeChoice,
} from './preferences';
import { usePageTitle } from './page-title';
import { sessionQuery } from '../identity/session';
import type { AssembledApp } from './app-contract';

// The settings page (docs/ui/design.md §6, §5 kit): grouped, anchored
// sections — appearance & language (device scope), account and API keys
// (account scope), the embedded design-system showroom, and help.
// Preferences keep their native radio groups as the public test
// interface, applied instantly through the preferences provider. The
// page is reachable before sign-in; the account sections appear once the
// session resolves. `?section=<anchor>` deep-links to a section and
// survives the query-retaining navigation the shell already grants this
// route.

// The showroom stays an async chunk here exactly as on its own route:
// the dynamic import resolves to the same module, so both entries share
// one lazy boundary and the initial bundle never sees it.
const DesignSystemView = lazy(
  () => import('../design-system/design-system-view'),
);

function ChoiceGroup<T extends string>({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{legend}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="flex flex-col gap-1">
        {options.map((option) => (
          <label key={option.value} className={choiceRowClass}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="accent-[var(--primary)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsView({
  docsUrl,
  apiClient,
  onOpen,
  section,
  showroom,
}: {
  docsUrl: string;
  apiClient: ApiClient;
  /** Router port for opening paths without a full page load. */
  onOpen?: (path: string) => void;
  /** `?section=` target: scroll the anchored section into view. */
  section?: string;
  /** Ports for the embedded showroom; missing scenes or copy hide it. */
  showroom?: {
    scenes?: AssembledApp['scenes'];
    copyText?: (text: string) => Promise<void>;
  };
}) {
  const message = useAppMessage();
  const { locale, setLocale, theme, setTheme } = usePreferences();
  usePageTitle('settings.title');
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery(apiClient, queryClient));
  const user = session.data?.user;
  const signedIn = user !== undefined;
  const languageOptions: { value: AppLocale; label: string }[] = [
    { value: 'zh', label: message('settings.language.zh') },
    { value: 'en', label: message('settings.language.en') },
  ];
  const themeOptions: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: message('settings.theme.system') },
    { value: 'light', label: message('settings.theme.light') },
    { value: 'dark', label: message('settings.theme.dark') },
  ];

  // Deep links land on an anchor once it exists: the account sections
  // mount with the session, so the scroll also waits for the resolved
  // session. Unresolvable sections (unknown or signed-out) scroll nowhere.
  useEffect(() => {
    if (!section) return;
    const target = document.querySelector(
      `[${SETTINGS_ANCHOR_ATTR}="${CSS.escape(section)}"]`,
    );
    target?.scrollIntoView?.({ block: 'start' });
  }, [section, signedIn]);

  const openPath =
    (path: string) => (event: { preventDefault: () => void }) => {
      if (onOpen) {
        event.preventDefault();
        onOpen(path);
      }
    };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <SettingsTab
        title={message('settings.title')}
        description={message('settings.description')}
      >
        <SettingsSection
          title={message('settings.appearance')}
          scope="device"
          scopeLabel={message('settings.scope.device')}
          description={message('settings.appearanceHint')}
          anchor="appearance"
        >
          <SettingsCard>
            <div className="py-4">
              <ChoiceGroup
                name="language"
                legend={message('settings.language')}
                hint={message('settings.languageHint')}
                options={languageOptions}
                value={locale}
                onChange={setLocale}
              />
            </div>
            <div className="py-4">
              <ChoiceGroup
                name="theme"
                legend={message('settings.theme')}
                hint={message('settings.themeHint')}
                options={themeOptions}
                value={theme}
                onChange={setTheme}
              />
            </div>
          </SettingsCard>
          <a
            href={docsChapterUrl(
              docsUrl,
              locale,
              'tutorials/appearance-language.md',
            )}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-link hover:underline"
          >
            {message('settings.tutorial')}
          </a>
        </SettingsSection>

        {signedIn && user ? (
          <SettingsSection
            title={message('settings.account')}
            scope="account"
            scopeLabel={message('settings.scope.account')}
            description={message('settings.accountHint')}
            anchor="account"
          >
            <SettingsCard>
              <SettingsRow label={message('settings.accountEmail')}>
                <span className="text-sm">{user.email}</span>
              </SettingsRow>
              <SettingsRow label={message('settings.accountDisplayName')}>
                <span className="text-sm">{user.display_name || '—'}</span>
              </SettingsRow>
              <SettingsRow label={message('settings.accountRole')}>
                <span className="text-sm">
                  {message(roleMessageKeys[user.role])}
                </span>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {signedIn ? (
          <SettingsSection
            title={message('settings.apiKeys')}
            scope="account"
            scopeLabel={message('settings.scope.account')}
            description={message('settings.apiKeysHint')}
            anchor="api-keys"
            action={
              <a
                href="/api-keys"
                className="text-sm text-link hover:underline"
                onClick={openPath('/api-keys')}
              >
                {message('settings.apiKeysOpen')}
              </a>
            }
          />
        ) : null}

        {signedIn && showroom?.scenes && showroom.copyText ? (
          <SettingsSection
            title={message('settings.designSystem')}
            description={message('settings.designSystemHint')}
            anchor="design-system"
          >
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {message('design.pageLoading')}
                </p>
              }
            >
              <DesignSystemView
                embedded
                docsUrl={docsUrl}
                scenes={showroom.scenes}
                copyText={showroom.copyText}
              />
            </Suspense>
          </SettingsSection>
        ) : null}

        <SettingsSection title={message('settings.help')} anchor="help">
          <SettingsCard>
            <SettingsRow label={message('settings.helpDocsLabel')}>
              <a
                href={docsHomeUrl(docsUrl, locale)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-link hover:underline"
              >
                {message('shell.nav.tutorials')}
              </a>
            </SettingsRow>
            <SettingsRow label={message('settings.helpStatusLabel')}>
              <a
                href="/system"
                className="text-sm text-link hover:underline"
                onClick={openPath('/system')}
              >
                {message('shell.nav.status')}
              </a>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </SettingsTab>
    </div>
  );
}
