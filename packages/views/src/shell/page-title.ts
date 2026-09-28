import { useEffect } from 'react';
import { useAppMessage } from './messages';
import { usePreferences } from './preferences';

// Page titles track the active language: `${page} · ${app name}`. Views
// call this once with their page's message key; switching the preference
// re-titles without a reload. Titles resolve at render time so the effect
// depends on the resolved strings, not a per-render resolver closure.
export function usePageTitle(pageKey: string) {
  const message = useAppMessage();
  const { locale } = usePreferences();
  const app = message('app.name');
  const page = message(pageKey);
  useEffect(() => {
    document.title = page === app ? app : `${page} · ${app}`;
  }, [locale, page, app]);
}
