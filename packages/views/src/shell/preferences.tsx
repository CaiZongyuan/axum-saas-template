import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Language and appearance preferences (docs/ui/design.md §6 Q2): the first
// visit follows the device, explicit choices win and stay on this device
// only. The provider applies html.lang, color-scheme and the resolved dark
// class on every change, and only `system` mode keeps following the OS. An
// index.html inline script applies the same resolution before first paint;
// everything here is idempotent so the handover is invisible.

export type AppLocale = 'zh' | 'en';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const LOCALE_STORAGE_KEY = 'saas.locale';
export const THEME_STORAGE_KEY = 'saas.theme';

export function localeTag(locale: AppLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

// The device's language list is honored in order: the first Chinese or
// English entry decides; anything else falls back to en.
export function pickLocale(candidates: readonly string[]): AppLocale {
  for (const tag of candidates) {
    if (/^zh/i.test(tag)) return 'zh';
    if (/^en/i.test(tag)) return 'en';
  }
  return 'en';
}

export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

function readStoredChoice<T extends string>(
  key: string,
  valid: readonly T[],
): T | undefined {
  try {
    const value = window.localStorage.getItem(key);
    return valid.includes(value as T) ? (value as T) : undefined;
  } catch {
    // Storage unavailable (blocked or private mode): fall back to defaults.
    return undefined;
  }
}

function writeStoredChoice(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice still holds for this session even when it cannot persist.
  }
}

const systemPrefersDarkNow = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

export type PreferencesValue = {
  locale: AppLocale;
  theme: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: ThemeChoice) => void;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

function applyPreferences(locale: AppLocale, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.lang = localeTag(locale);
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(
    () =>
      readStoredChoice(LOCALE_STORAGE_KEY, ['zh', 'en']) ??
      pickLocale(window.navigator.languages ?? [window.navigator.language]),
  );
  const [theme, setThemeState] = useState<ThemeChoice>(
    () =>
      readStoredChoice(THEME_STORAGE_KEY, ['system', 'light', 'dark']) ??
      'system',
  );
  const [systemPrefersDark, setSystemPrefersDark] =
    useState(systemPrefersDarkNow);

  // Only system mode follows OS changes — and the subscription exists
  // exactly while the provider is mounted, never after.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, systemPrefersDark);

  useEffect(() => {
    applyPreferences(locale, resolvedTheme);
  }, [locale, resolvedTheme]);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    writeStoredChoice(LOCALE_STORAGE_KEY, next);
  }, []);
  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    writeStoredChoice(THEME_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ locale, theme, resolvedTheme, setLocale, setTheme }),
    [locale, theme, resolvedTheme, setLocale, setTheme],
  );
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value)
    throw new Error('usePreferences used outside PreferencesProvider');
  return value;
}
