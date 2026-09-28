import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AppMessagesProvider, useAppMessage } from './messages';

function Text({ namespace, k }: { namespace?: string; k: string }) {
  return <>{useAppMessage(namespace)(k)}</>;
}

const app = {
  messages: {
    zh: { 'notes.page.title': '便签示例页' },
    en: { 'notes.page.title': 'Notes example page' },
  },
};

test('resolves a namespaced example key in the active locale', () => {
  render(
    <AppMessagesProvider app={app} locale="en">
      <Text namespace="notes" k="page.title" />
    </AppMessagesProvider>,
  );
  expect(screen.getByText('Notes example page')).toBeInTheDocument();
});

test('Core shell code resolves already-namespaced keys without a namespace', () => {
  render(
    <AppMessagesProvider app={app} locale="zh">
      <Text k="notes.page.title" />
    </AppMessagesProvider>,
  );
  expect(screen.getByText('便签示例页')).toBeInTheDocument();
});

test('a missing key is a wiring bug and fails loudly', () => {
  expect(() =>
    render(
      <AppMessagesProvider app={{ messages: { zh: {}, en: {} } }}>
        <Text namespace="notes" k="page.title" />
      </AppMessagesProvider>,
    ),
  ).toThrow(/Missing zh message: notes\.page\.title/);
});
