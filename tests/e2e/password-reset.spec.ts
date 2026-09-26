import { expect, test } from '@playwright/test';

test('captured reset mail changes the password and invalidates the other browser session', async ({
  browser,
}) => {
  const original = await browser.newContext();
  const recovery = await browser.newContext();
  const email = 'browser-reset@example.test';
  try {
    const page = await original.newPage();
    await page.goto('/register');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page
      .getByLabel('密码', { exact: true })
      .fill('original-browser-password');
    await page.getByRole('button', { name: '创建账号' }).click();
    await expect(
      page.getByRole('heading', { name: `你好，${email}` }),
    ).toBeVisible();

    const resetPage = await recovery.newPage();
    await resetPage.goto('/login');
    await resetPage.getByRole('link', { name: '忘记密码？' }).click();
    await resetPage.getByLabel('邮箱').fill(email);
    await resetPage.getByRole('button', { name: '发送重置邮件' }).click();
    await expect(resetPage.getByRole('status')).toContainText('如果该账号可用');
    const captureUrl = process.env.MAILPIT_HTTP_URL!;
    let messageId: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${captureUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
            { signal: AbortSignal.timeout(3000) },
          );
          const result = await response.json();
          messageId = result.messages?.[0]?.ID;
          return Boolean(messageId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const message = await (
      await fetch(`${captureUrl}/api/v1/message/${messageId}`, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    const link = (message.Text as string)
      .split(/\s+/)
      .find((word) => word.includes('/reset-password#token='));
    if (!link) throw new Error('Captured mail did not contain a reset link');
    // Never print the capture, link, token, password, or original cookies.
    await resetPage.goto(link);
    await expect(resetPage.getByLabel('新密码', { exact: true })).toBeVisible();
    await expect.poll(() => new URL(resetPage.url()).hash === '').toBe(true);
    await resetPage
      .getByLabel('新密码', { exact: true })
      .fill('replacement-browser-password');
    await resetPage
      .getByLabel('确认新密码')
      .fill('replacement-browser-password');
    await resetPage.getByRole('button', { name: '设置新密码' }).click();
    await expect(resetPage.getByRole('status')).toHaveText(
      '密码已重置，请重新登录。',
    );
    expect((await original.request.get('/api/v1/auth/session')).status()).toBe(
      401,
    );
    await page.reload();
    await expect(
      page.getByRole('link', { name: '登录', exact: true }),
    ).toBeVisible();
    // Reopening an email in this same tab is a fragment-only navigation.
    await resetPage.goto(link);
    await expect(resetPage.getByLabel('新密码', { exact: true })).toBeVisible();
    await expect.poll(() => new URL(resetPage.url()).hash === '').toBe(true);
    await resetPage
      .getByLabel('新密码', { exact: true })
      .fill('replacement-browser-password');
    await resetPage
      .getByLabel('确认新密码')
      .fill('replacement-browser-password');
    await resetPage.getByRole('button', { name: '设置新密码' }).click();
    await expect(resetPage.getByRole('alert')).toContainText(
      '重置链接无效或已失效',
    );
    await resetPage.getByRole('button', { name: '返回登录' }).click();
    await resetPage.getByLabel('邮箱', { exact: true }).fill(email);
    await resetPage
      .getByLabel('密码', { exact: true })
      .fill('replacement-browser-password');
    await resetPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(
      resetPage.getByRole('heading', { name: `你好，${email}` }),
    ).toBeVisible();
    expect(
      await resetPage.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }).includes('replacement-browser-password'),
      ),
    ).toBe(false);
  } finally {
    await original.close();
    await recovery.close();
  }
});
