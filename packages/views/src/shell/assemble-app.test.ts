import { describe, expect, test } from 'vitest';
import { assembleApp, CORE_RESERVED_ROUTES } from './app-contract';
import type { ExampleContribution } from './app-contract';

// The public composition contract: examples declare pages, navigation,
// messages and optional notification parsing under a stable id; the shell
// validates the assembled result and refuses conflicts instead of letting
// the last registration win.

function example(
  overrides: Partial<ExampleContribution> = {},
): ExampleContribution {
  return {
    id: 'notes',
    routes: [{ path: '/notes', component: () => null }],
    navigation: [
      {
        id: 'notes-group',
        labelKey: 'group.label',
        items: [{ id: 'notes-open', labelKey: 'nav.notes', path: '/notes' }],
      },
    ],
    messages: {
      zh: { 'group.label': '便签', 'nav.notes': '便签列表' },
      en: { 'group.label': 'Notes', 'nav.notes': 'Notes list' },
    },
    defaultEntry: '/notes',
    ...overrides,
  };
}

describe('assembleApp', () => {
  test('assembles navigation, routes, namespaced messages and default entry', () => {
    const app = assembleApp({ examples: [example()] });
    expect(app.defaultEntry).toBe('/notes');
    expect(app.routes.map((route) => route.path)).toEqual(['/notes']);
    expect(app.messages.zh['notes.group.label']).toBe('便签');
    expect(app.messages.en['notes.nav.notes']).toBe('Notes list');
    expect(app.navigation).toHaveLength(1);
    expect(app.resolveNotificationTarget).toBeUndefined();
  });

  test('an empty selection assembles a Core-only app at the root entry', () => {
    const app = assembleApp({ examples: [] });
    expect(app.defaultEntry).toBe('/');
    expect(app.routes).toEqual([]);
    expect(app.navigation).toEqual([]);
    expect(app.messages).toEqual({ zh: {}, en: {} });
  });

  test('empty navigation groups disappear from the assembled navigation', () => {
    const app = assembleApp({
      examples: [
        example({
          navigation: [
            { id: 'empty', labelKey: 'group.label', items: [] },
            {
              id: 'kept',
              labelKey: 'group.label',
              items: [{ id: 'item', labelKey: 'nav.notes', path: '/notes' }],
            },
          ],
        }),
      ],
    });
    expect(app.navigation.map((group) => group.id)).toEqual(['notes:kept']);
  });

  test('duplicate example ids fail the assembly', () => {
    expect(() => assembleApp({ examples: [example(), example()] })).toThrow(
      /duplicate example id: notes/,
    );
  });

  test('route conflicts between examples fail the assembly', () => {
    const other = example({
      id: 'other',
      routes: [{ path: '/notes', component: () => null }],
      navigation: [
        {
          id: 'g',
          labelKey: 'k',
          items: [{ id: 'i', labelKey: 'k', path: '/notes' }],
        },
      ],
      messages: { zh: { k: '他' }, en: { k: 'Other' } },
    });
    expect(() => assembleApp({ examples: [example(), other] })).toThrow(
      /route \/notes is already contributed/,
    );
  });

  test('occupying a Core reserved route fails the assembly', () => {
    expect(CORE_RESERVED_ROUTES).toContain('/login');
    expect(() =>
      assembleApp({
        examples: [
          example({ routes: [{ path: '/login', component: () => null }] }),
        ],
      }),
    ).toThrow(/Core reserved route \/login/);
  });

  test('navigation labels must resolve in both locales', () => {
    const missing = example();
    missing.messages.en = {};
    expect(() => assembleApp({ examples: [missing] })).toThrow(
      /message notes\.group\.label has no en text/,
    );
  });

  test('a default entry outside the contributed routes fails the assembly', () => {
    expect(() =>
      assembleApp({ examples: [example()], defaultEntry: '/missing' }),
    ).toThrow(/default entry \/missing is not a contributed route/);
    expect(() =>
      assembleApp({ examples: [example()], defaultEntry: '/login' }),
    ).toThrow(/Core reserved route/);
  });

  test('the declared default entry wins over contribution defaults', () => {
    const knowledge = example({
      id: 'knowledge',
      defaultEntry: '/documents',
      routes: [
        { path: '/documents', component: () => null },
        { path: '/knowledge-docs', component: () => null },
      ],
      messages: {
        zh: {
          'group.label': '知识库',
          'nav.notes': '便签列表',
          'nav.documents': '我的文档',
        },
        en: {
          'group.label': 'Knowledge',
          'nav.notes': 'Notes list',
          'nav.documents': 'My documents',
        },
      },
      navigation: [
        {
          id: 'g',
          labelKey: 'group.label',
          items: [
            { id: 'a', labelKey: 'nav.documents', path: '/documents' },
            { id: 'b', labelKey: 'nav.notes', path: '/knowledge-docs' },
          ],
        },
      ],
    });
    const app = assembleApp({
      examples: [example(), knowledge],
      defaultEntry: '/documents',
    });
    expect(app.defaultEntry).toBe('/documents');
  });

  test('the first example declaring a default entry wins the assembled entry', () => {
    const knowledge = example({
      id: 'knowledge',
      defaultEntry: '/documents',
      routes: [{ path: '/documents', component: () => null }],
      navigation: [
        {
          id: 'g',
          labelKey: 'group.label',
          items: [{ id: 'a', labelKey: 'nav.notes', path: '/documents' }],
        },
      ],
    });
    expect(assembleApp({ examples: [knowledge, example()] }).defaultEntry).toBe(
      '/documents',
    );
    expect(assembleApp({ examples: [example(), knowledge] }).defaultEntry).toBe(
      '/notes',
    );
  });

  test('notification resolvers compose in contribution order', () => {
    const first = example({
      id: 'first',
      resolveNotificationTarget: () => undefined,
    });
    const second = example({
      id: 'second',
      defaultEntry: '/second',
      routes: [{ path: '/second', component: () => null }],
      navigation: [
        {
          id: 'g',
          labelKey: 'group.label',
          items: [{ id: 'i', labelKey: 'nav.notes', path: '/second' }],
        },
      ],
      resolveNotificationTarget: () => () => undefined,
    });
    const app = assembleApp({ examples: [first, second] });
    expect(app.resolveNotificationTarget).toBeDefined();
  });
});
