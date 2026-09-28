import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas/ui/components/card';
import { AppShellLayout } from './app-shell';
import { docsChapterUrl } from './docs-links';
import { useAppMessage } from './messages';
import {
  usePreferences,
  type AppLocale,
  type ThemeChoice,
} from './preferences';
import { usePageTitle } from './page-title';

// The appearance-and-language settings (docs/ui/design.md §6): native
// radio groups so keyboard behavior is the platform's, applied instantly
// through the preferences provider — no reload, no lost input. The page
// is reachable before sign-in; preferences are device-scoped either way.

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
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm hover:bg-muted"
          >
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
  onOpen,
}: {
  docsUrl: string;
  /** Router port for opening paths without a full page load. */
  onOpen?: (path: string) => void;
}) {
  const message = useAppMessage();
  const { locale, setLocale, theme, setTheme } = usePreferences();
  usePageTitle('settings.title');
  const languageOptions: { value: AppLocale; label: string }[] = [
    { value: 'zh', label: message('settings.language.zh') },
    { value: 'en', label: message('settings.language.en') },
  ];
  const themeOptions: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: message('settings.theme.system') },
    { value: 'light', label: message('settings.theme.light') },
    { value: 'dark', label: message('settings.theme.dark') },
  ];
  return (
    <AppShellLayout docsUrl={docsUrl} onOpen={onOpen}>
      <div className="mx-auto w-full max-w-xl px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">
                {message('settings.title')}
              </h1>
            </CardTitle>
            <CardDescription>{message('settings.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ChoiceGroup
              name="language"
              legend={message('settings.language')}
              hint={message('settings.languageHint')}
              options={languageOptions}
              value={locale}
              onChange={setLocale}
            />
            <ChoiceGroup
              name="theme"
              legend={message('settings.theme')}
              hint={message('settings.themeHint')}
              options={themeOptions}
              value={theme}
              onChange={setTheme}
            />
            <a
              href={docsChapterUrl(
                docsUrl,
                locale,
                'tutorials/appearance-language.md',
              )}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-link hover:underline"
            >
              {message('settings.tutorial')}
            </a>
          </CardContent>
        </Card>
      </div>
    </AppShellLayout>
  );
}
