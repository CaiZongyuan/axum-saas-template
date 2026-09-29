/** 壳层图标合同：无裸字符开关，导航图标按注册表渲染。 */
import { render, screen } from '@testing-library/react';
import { BookOpenIcon } from 'lucide-react';
import { expect, test } from 'vitest';
import { AppMessagesProvider } from './messages';
import { PreferencesProvider } from './preferences';
import { AppShellLayout } from './app-shell';
import { coreMessages } from './core-messages';

// The assembled catalog is core texts plus example namespaces; the unit
// test mirrors that shape with one example key.
const app = {
  messages: {
    zh: {
      ...coreMessages.zh,
      'knowledge.nav.documents': '我的文档',
    },
    en: {
      ...coreMessages.en,
      'knowledge.nav.documents': 'My documents',
    },
  },
};

function pinLocale(locale: 'zh' | 'en') {
  window.localStorage.setItem('saas.locale', locale);
}

function Shell(props: Omit<Parameters<typeof AppShellLayout>[0], 'children'>) {
  return (
    <PreferencesProvider>
      <AppMessagesProvider app={app}>
        <AppShellLayout {...props}>main</AppShellLayout>
      </AppMessagesProvider>
    </PreferencesProvider>
  );
}

test('the drawer toggles are Lucide glyphs, not bare characters', () => {
  pinLocale('en');
  const { container } = render(<Shell role="member" />);
  const open = screen.getByRole('button', { name: 'Open navigation menu' });
  expect(open.querySelector('svg')).not.toBeNull();
  expect(container.textContent).not.toContain('☰');
  expect(container.textContent).not.toContain('✕');
});

test('core sidebar links carry their registry icon alongside the label', () => {
  pinLocale('en');
  render(<Shell role="member" />);
  const home = screen.getByRole('link', { name: 'Home' });
  const icon = home.querySelector('[data-slot="module-icon"]');
  expect(icon?.getAttribute('data-variant')).toBe('blue');
  expect(icon?.getAttribute('data-appearance')).toBe('bare');
  expect(home.textContent).toContain('Home');
});

test('business links take their icon from the assembled module registry', () => {
  pinLocale('en');
  render(
    <Shell
      role="member"
      navigation={[
        {
          id: 'knowledge:main',
          labelKey: 'knowledge.nav.documents',
          items: [
            {
              id: 'knowledge:documents',
              labelKey: 'knowledge.nav.documents',
              path: '/documents',
            },
          ],
        },
      ]}
      moduleIcons={{
        '/documents': { icon: BookOpenIcon, variant: 'teal' },
      }}
    />,
  );
  const link = screen.getByRole('link', { name: 'My documents' });
  expect(
    link
      .querySelector('[data-slot="module-icon"]')
      ?.getAttribute('data-variant'),
  ).toBe('teal');
});
