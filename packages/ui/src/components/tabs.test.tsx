import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { compile } from 'tailwindcss';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const styles: HTMLStyleElement[] = [];
afterEach(() => styles.splice(0).forEach((style) => style.remove()));

async function open(
  orientation: 'horizontal' | 'vertical',
  variant: 'default' | 'line',
) {
  const { container } = render(
    <Tabs defaultValue="overview" orientation={orientation}>
      <TabsList variant={variant} aria-label="Sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview content</TabsContent>
      <TabsContent value="performance">Performance content</TabsContent>
    </Tabs>,
  );
  const candidates = Array.from(container.querySelectorAll('[class]')).flatMap(
    (element) => Array.from(element.classList),
  );
  const compiler = await compile('@tailwind utilities;');
  const style = document.createElement('style');
  style.textContent = compiler.build(candidates);
  document.head.append(style);
  styles.push(style);
  return {
    root: container.firstElementChild!,
    list: screen.getByRole('tablist'),
    user: userEvent.setup(),
  };
}

test.each(['default', 'line'] as const)(
  '%s horizontal tabs place their bar above the active panel',
  async (variant) => {
    const { root, list, user } = await open('horizontal', variant);
    expect(getComputedStyle(root).flexDirection).toBe('column');
    expect(getComputedStyle(list).flexDirection).toBe('row');
    await user.click(screen.getByRole('tab', { name: 'Performance' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Performance content',
    );
  },
);

test('explicit vertical tabs retain a column beside their active panel', async () => {
  const { root, list } = await open('vertical', 'default');
  expect(getComputedStyle(root).flexDirection).toBe('row');
  expect(getComputedStyle(list).flexDirection).toBe('column');
});
