import { expect, test } from '@playwright/test';

// Uses the isolated bootstrap Owner, API, Worker and PostgreSQL supplied by
// scripts/e2e.mjs. Authentication journeys keep traces and screenshots off.
test.use({ locale: 'zh-CN', trace: 'off', screenshot: 'off' });

test('an administrator reads monitoring, persists an alert, and opens its real test notification', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_OWNER_EMAIL!);
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const snapshotResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/system/monitoring?') &&
      response.status() === 200,
  );
  await page
    .getByRole('navigation', { name: '设置目录' })
    .getByRole('link', { name: '监控与诊断' })
    .click();
  expect((await snapshotResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/settings\?section=monitoring$/);
  await expect(page.getByRole('group', { name: '排队中' })).toBeVisible();
  const help = page.getByRole('button', { name: '解释：P95 响应时间' });
  await help.hover();
  await expect(page.getByRole('tooltip')).toContainText('95%');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await help.focus();
  await expect(page.getByRole('tooltip')).toContainText('95%');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  const hourResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/system/monitoring?window_minutes=60') &&
      response.status() === 200,
  );
  await page.getByRole('combobox', { name: '统计时段' }).selectOption('60');
  expect((await hourResponse).status()).toBe(200);
  await page.getByRole('tab', { name: '采集与告警' }).click();
  const enabled = page.getByRole('switch', { name: '启用站内告警' });
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await page.getByRole('spinbutton', { name: '错误率阈值（%）' }).fill('2');
  await page.getByRole('combobox', { name: '持续时间' }).selectOption('1');
  await page.getByRole('button', { name: '保存告警' }).click();
  await expect(page.getByText('告警配置已保存。')).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          '/api/v1/system/monitoring/alerts',
        );
        expect(response.status()).toBe(200);
        return (await response.json()).last_evaluated_at;
      },
      { timeout: 45_000 },
    )
    .not.toBeNull();
  await page.reload();
  await page.getByRole('tab', { name: '采集与告警' }).click();
  await expect(enabled).toBeChecked();
  await expect(
    page.getByRole('spinbutton', { name: '错误率阈值（%）' }),
  ).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: '持续时间' })).toHaveValue(
    '1',
  );

  const notificationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/system/monitoring/alerts/test') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送测试通知' }).click();
  expect((await notificationResponse).status()).toBe(201);
  await expect(page.getByText('测试通知已创建')).toBeVisible();
  await page.getByRole('link', { name: '查看我的通知' }).click();
  const notification = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: '监控测试通知' }) });
  await expect(notification).toHaveCount(1);
  await notification.getByRole('button', { name: '查看结果' }).click();
  await expect(page).toHaveURL(/\/settings\?section=monitoring$/);
  await expect(page.getByRole('tab', { name: '运行概况' })).toBeVisible();

  // Copy the session only in memory; no credential-bearing storageState file.
  const mobileContext = await browser.newContext({
    baseURL: process.env.E2E_WEB_URL,
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await page.context().storageState(),
  });
  try {
    const mobile = await mobileContext.newPage();
    await mobile.goto('/settings?section=monitoring');
    await expect(mobile.getByRole('group', { name: '请求量' })).toBeVisible();
    await mobile.getByRole('button', { name: '解释：P95 响应时间' }).tap();
    await expect(mobile.getByRole('tooltip')).toContainText('95%');
    await mobile
      .getByRole('heading', { name: '监控与诊断', exact: true })
      .tap();
    await expect(mobile.getByRole('tooltip')).toHaveCount(0);
    await mobile.getByRole('tab', { name: '采集与告警' }).tap();
    await expect(
      mobile.getByRole('switch', { name: '启用站内告警' }),
    ).toBeChecked();
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await mobileContext.close();
  }

  // Return the isolated shared deployment's rule to its default for other tests.
  await page.getByRole('tab', { name: '采集与告警' }).click();
  await enabled.click();
  await page.getByRole('button', { name: '保存告警' }).click();
  await expect(page.getByText('告警配置已保存。')).toBeVisible();
});

test('a newly registered member cannot enter administrator monitoring', async ({
  page,
}) => {
  await page.goto('/register');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill('monitoring-member@example.test');
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: '创建账号' }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '设置目录' })
      .getByRole('link', { name: '监控与诊断' }),
  ).toHaveCount(0);
  await page.goto('/settings?section=monitoring');
  await expect(
    page.getByText('仅企业所有者和管理员可以查看监控。'),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: '运行概况' })).toHaveCount(0);
  // The same browser identity is denied by the real protected endpoint.
  expect((await page.request.get('/api/v1/system/monitoring')).status()).toBe(
    403,
  );
});
