import { expect, test, type Page } from '@playwright/test';

// The public Landing, the Documentation entry and the two honest Coming
// soon pages, driven in a real browser against the built static site.
// Run via `just e2e-docs`; no application stack is involved.

// E2E_DOCS_URL carries the deployed base, but page.goto('/') would resolve
// against the bare origin — every journey goes through this helper so the
// base always stays in the URL.
const site = new URL(process.env.E2E_DOCS_URL ?? 'http://127.0.0.1:0/');
const go = (page: Page, path = '/') =>
  page.goto(site.pathname.replace(/\/$/, '') + path);

test('the landing offers the four public entries and the start actions', async ({
  page,
}) => {
  await go(page);
  await expect(page).toHaveTitle(/Dougong/);
  const nav = page.locator('.VPNavBarMenuLink');
  await expect(nav).toHaveCount(4);
  // Scope to the navbar: cards and CTA buttons also contain 文档/博客 text.
  await expect(nav.filter({ hasText: '文档' })).toHaveAttribute(
    'href',
    /\/docs\/$/,
  );
  await expect(nav.filter({ hasText: '博客' })).toHaveAttribute(
    'href',
    /\/blog\/$/,
  );
  await expect(nav.filter({ hasText: '下载' })).toHaveAttribute(
    'href',
    /\/downloads\/$/,
  );
  await expect(
    page
      .locator('.landing-actions')
      .first()
      .getByRole('link', { name: '查看文档' }),
  ).toHaveAttribute('href', 'docs/'); // raw HTML: a base-relative literal the browser resolves; the CTA test below follows it
  await expect(page.getByRole('link', { name: 'GitHub 仓库' })).toHaveAttribute(
    'href',
    /github\.com/,
  );
});

test('the primary CTA enters the Chinese documentation and old deep links keep working', async ({
  page,
}) => {
  await go(page, '/');
  await page
    .locator('.landing-actions')
    .first()
    .getByRole('link', { name: '查看文档' })
    .click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(
    page.getByRole('heading', { name: '文档教程', level: 1 }),
  ).toBeVisible();
  await go(page, '/getting-started/quickstart');
  await expect(
    page.getByRole('heading', { level: 1 }).filter({ hasText: '快速开始' }),
  ).toBeVisible();
});

test('blog and downloads are direct Coming soon pages without fabricated content', async ({
  page,
}) => {
  for (const [path, heading, backName] of [
    ['/blog/', '博客 · 即将推出', '首页'],
    ['/downloads/', '下载 · 即将推出', '首页'],
  ] as const) {
    await go(page, path);
    await expect(
      page.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible();
    // The styled container exists and carries the mono badge; the page
    // content itself is untouched honest prose.
    await expect(page.locator('.placeholder')).toBeVisible();
    await expect(page.locator('.placeholder-badge')).toHaveText('即将推出');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    // Honest placeholder: no article list, no asset table, no download
    // buttons, no dates posed as release dates.
    await expect(page.locator('article, table, [download], time')).toHaveCount(
      0,
    );
    await page.getByRole('link', { name: backName }).first().click();
    await expect(page).toHaveURL(/\/$/);
  }
  const meta = page.locator('meta[name="description"]');
  await go(page, '/blog/');
  await expect(meta).toHaveAttribute('content', /尚未开始实现/);
  await go(page, '/downloads/');
  await expect(meta).toHaveAttribute('content', /尚未开始实现/);
});

test('the English coming soon pages carry honest English meta', async ({
  page,
}) => {
  for (const [path, title, heading] of [
    ['/en/blog/', /Blog · Coming soon/, 'Blog · Coming soon'],
    ['/en/downloads/', /Downloads · Coming soon/, 'Downloads · Coming soon'],
  ] as const) {
    await go(page, path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible();
    // The styled container mirrors the Chinese pages.
    await expect(page.locator('.placeholder')).toBeVisible();
    await expect(page.locator('.placeholder-badge')).toHaveText('Coming soon');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /not implemented yet/,
    );
  }
});

test('the language switcher lands on the same page in the other locale', async ({
  page,
}) => {
  await go(page, '/blog/');
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('link', { name: '中文', exact: true }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('the landing CTA and switcher also work from the English home', async ({
  page,
}) => {
  await go(page, '/en/');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'A Rust + React foundation for your next SaaS',
    }),
  ).toBeVisible();
  await page
    .locator('.landing-actions')
    .first()
    .getByRole('link', { name: 'Documentation' })
    .click();
  await expect(page).toHaveURL(/\/en\/docs\/$/);
});

test('the landing presents the confirmed Expo-style structure', async ({
  page,
}) => {
  // The mono facts strip is visible in both languages and carries no
  // digits at all — the tutorial's non-numeric rule, asserted by machine.
  for (const [path, cta] of [
    ['/', '了解更多 →'],
    ['/en/', 'Learn more →'],
  ]) {
    await go(page, path);
    await expect(page.locator('.landing-facts')).toBeVisible();
    await expect(page.locator('.landing-facts')).not.toContainText(/\d/);
    await expect(page.locator('.landing-hero-art')).toBeVisible();
    await expect(page.locator('.landing-card-cta').first()).toHaveText(cta);
    await expect(page.locator('.landing-closing')).toBeVisible();
  }
  // Below 960px the hero is a single column and the art steps aside.
  await page.setViewportSize({ width: 375, height: 720 });
  await go(page, '/');
  await expect(page.locator('.landing-hero-art')).not.toBeVisible();
});

test('the three-state appearance control covers system, light and dark', async ({
  page,
}) => {
  await go(page, '/');
  // The navbar hosts the control from 960px; the nav-screen copy only
  // mounts with the hamburger, so the match stays unambiguous.
  const dark = page.getByRole('button', { name: '深色', exact: true });
  await dark.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/); // survives a reload
  const light = page.getByRole('button', { name: '浅色', exact: true });
  await light.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const system = page.getByRole('button', { name: '跟随系统', exact: true });
  await system.click();
  // Playwright defaults to a light color scheme, so 'auto' stays light…
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  // …and follows the OS live, without a reload.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('the shared chrome keeps gutters, the language pill and the license line', async ({
  page,
}) => {
  await go(page, '/');
  // The pill and the appearance control join the navbar right cluster
  // from 960px — including the 960–1279 range where VitePress shows
  // neither its hamburger nor its own appearance toggle.
  await expect(page.locator('.docs-locale-nav')).toBeVisible();
  await expect(page.locator('.docs-appearance-nav')).toBeVisible();
  const copyright = page.locator('.VPFooter .copyright');
  await expect(copyright).toContainText('MIT');
  await expect(copyright.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    /github\.com/,
  );
  // Every width keeps horizontal gutters: the `page` layout has no styles
  // of its own, so the wrappers provide them.
  await page.setViewportSize({ width: 390, height: 720 });
  await go(page, '/');
  const heroHeading = await page.locator('.landing-hero h1').boundingBox();
  expect(heroHeading?.x).toBeGreaterThan(0);
  await go(page, '/blog/');
  const placeholderHeading = await page
    .locator('.placeholder h1')
    .boundingBox();
  expect(placeholderHeading?.x).toBeGreaterThan(0);
  // Below 960px the navbar pills hide and the nav screen carries both.
  await expect(page.locator('.docs-locale-nav')).not.toBeVisible();
  await expect(page.locator('.docs-appearance-nav')).not.toBeVisible();
  await page.getByRole('button', { name: 'mobile navigation' }).click();
  // The screen copies are the only language and theme controls below
  // 960px: reachable by role and sized for the 44px touch floor of
  // design.md §5.
  await expect(
    page.locator('.docs-locale-screen').getByRole('link', { name: 'English' }),
  ).toBeVisible();
  await expect(
    page.locator('.docs-appearance-screen').getByRole('button'),
  ).toHaveCount(3);
  const option = page
    .locator('.docs-appearance-screen .docs-appearance-option')
    .first();
  expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const locale = page.locator('.docs-locale-screen .docs-locale-link');
  expect((await locale.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test('narrow-screen navigation reaches the four entries with the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await go(page, '/');
  const hamburger = page.getByRole('button', { name: 'mobile navigation' });
  await hamburger.focus();
  await expect(hamburger).toBeFocused();
  await page.keyboard.press('Enter');
  const screen = page.locator('.VPNavScreen');
  await expect(screen).toBeVisible();
  for (const name of ['首页', '文档', '博客', '下载']) {
    await expect(
      screen.locator('.VPNavScreenMenuLink', { hasText: name }),
    ).toBeVisible();
  }
  // The screen's focus order starts at its menu; walk Tab until the
  // documentation entry holds focus (skip-to-content and the locale
  // switcher sit in between) and follow it with Enter.
  for (let tabs = 0; tabs < 8; tabs++) {
    const focused = await page.evaluate(() =>
      document.activeElement?.textContent?.trim(),
    );
    if (focused === '文档') break;
    await page.keyboard.press('Tab');
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.textContent?.trim()),
    )
    .toBe('文档');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/docs\/$/);
});

test('the landing ships representative visual evidence for both widths', async ({
  page,
}) => {
  await go(page, '/');
  await page.screenshot({
    path: 'test-results/docs/landing-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 720 });
  await expect(
    page.getByRole('button', { name: 'mobile navigation' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/docs/landing-narrow.png',
    fullPage: true,
  });
});

test('the landing ships dark visual evidence as well', async ({ page }) => {
  await go(page, '/');
  // A fresh context stores no preference, so the appearance control's
  // default ('auto') drives the page from the emulated OS scheme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({
    path: 'test-results/docs/landing-desktop-dark.png',
    fullPage: true,
  });
});
