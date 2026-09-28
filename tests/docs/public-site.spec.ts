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
  await expect(page).toHaveTitle(/Axum SaaS Template/);
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
  await go(page, '/en/blog/');
  await expect(page).toHaveTitle(/Blog · Coming soon/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Blog · Coming soon' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /not implemented yet/,
  );
  await go(page, '/en/downloads/');
  await expect(page).toHaveTitle(/Downloads · Coming soon/);
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

test('the appearance choice persists locally on the public site', async ({
  page,
}) => {
  await go(page, '/');
  // VitePress renders the switch in the navbar and again in the (hidden)
  // mobile nav screen; the first is the visible one at desktop width.
  await page.locator('button.VPSwitchAppearance').first().click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
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
