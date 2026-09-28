import { createContext, useContext, type ReactNode } from 'react';
import type { AssembledApp } from './app-contract';

// The message catalog assembles every example's namespace plus Core texts.
// UI02 keeps the resolution minimal (fixed locale from the provider);
// UI04 builds the preference switching on this catalog.

export type AppLocale = 'zh' | 'en';

const AppMessagesContext = createContext<{
  locale: AppLocale;
  messages: Record<string, string>;
}>({ locale: 'zh', messages: {} });

export function AppMessagesProvider({
  app,
  locale = 'zh',
  children,
}: {
  app: Pick<AssembledApp, 'messages'>;
  locale?: AppLocale;
  children: ReactNode;
}) {
  return (
    <AppMessagesContext.Provider
      value={{ locale, messages: app.messages[locale] }}
    >
      {children}
    </AppMessagesContext.Provider>
  );
}

/**
 * Resolves a message key against the assembled catalog; a missing key is a
 * wiring bug. Example pages pass their example id as the namespace so keys
 * stay in the example's own vocabulary (assembly adds the prefix).
 */
export function useAppMessage(namespace?: string): (key: string) => string {
  const { locale, messages } = useContext(AppMessagesContext);
  return (key: string) => {
    const resolved = namespace ? `${namespace}.${key}` : key;
    const text = messages[resolved];
    if (!text) throw new Error(`Missing ${locale} message: ${resolved}`);
    return text;
  };
}
