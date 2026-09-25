import { expect, test } from '@playwright/test';

test('two browsers register, refresh, log out and sign in with isolated sessions', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    for (const [context, email, role] of [
      [first, 'first-member@example.com', '成员'],
      [second, 'member@example.com', '成员'],
    ] as const) {
      const page = await context.newPage();
      await page.goto('/register');
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      await page
        .getByLabel('密码', { exact: true })
        .fill('browser-test-password');
      await page.getByRole('button', { name: '创建账号' }).click();
      await expect(
        page.getByRole('heading', { name: `你好，${email}` }),
      ).toBeVisible();
      await expect(page.getByText(role, { exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('heading', { name: `你好，${email}` }),
      ).toBeVisible();
      const cookie = (await context.cookies()).find(
        (cookie) => cookie.name === 'saas_session',
      );
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe('Lax');
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        'saas_session',
      );
      await page.getByRole('button', { name: '退出登录' }).click();
      await expect(
        page.getByRole('link', { name: '登录', exact: true }),
      ).toBeVisible();
      const oldSession = await context.request.get('/api/v1/auth/session', {
        headers: { cookie: `saas_session=${cookie!.value}` },
      });
      expect(oldSession.status()).toBe(401);
      await page.getByRole('link', { name: '登录', exact: true }).click();
      await page.getByLabel('邮箱', { exact: true }).fill(email);
      await page
        .getByLabel('密码', { exact: true })
        .fill('browser-test-password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: `你好，${email}` }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
          }),
        ),
      ).not.toContain('browser-test-password');
    }
    expect((await first.cookies())[0]?.value).not.toEqual(
      (await second.cookies())[0]?.value,
    );
  } finally {
    await first.close();
    await second.close();
  }
});
