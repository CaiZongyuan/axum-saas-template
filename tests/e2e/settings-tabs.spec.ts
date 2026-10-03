import { expect, test, type Locator } from '@playwright/test';

test.use({ locale: 'zh-CN', trace: 'off', screenshot: 'off' });

async function tabGeometry(list: Locator) {
  return list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const root = element.closest('[data-slot="tabs"]')!;
    const panel = root.querySelector('[role="tabpanel"]:not([hidden])')!;
    return {
      rootDirection: getComputedStyle(root).flexDirection,
      listDirection: getComputedStyle(element).flexDirection,
      bottom: bounds.bottom,
      panelTop: panel.getBoundingClientRect().top,
      buttons: Array.from(element.querySelectorAll('[role="tab"]')).map(
        (tab) => {
          const box = tab.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, width: box.width };
        },
      ),
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
}

test('monitoring and design-system tabs remain horizontal above their content', async ({
  page,
}) => {
  await page.goto('/login');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_OWNER_EMAIL!);
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();

  for (const section of ['monitoring', 'design-system']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/settings?section=${section}`);
    const list = page.getByRole('tablist');
    await expect(list.getByRole('tab')).toHaveCount(4);
    const desktop = await tabGeometry(list);
    expect(desktop.rootDirection).toBe('column');
    expect(desktop.listDirection).toBe('row');
    expect(desktop.panelTop).toBeGreaterThanOrEqual(desktop.bottom);
    expect(
      Math.max(...desktop.buttons.map((tab) => tab.y)) -
        Math.min(...desktop.buttons.map((tab) => tab.y)),
    ).toBeLessThan(2);
    for (let index = 1; index < desktop.buttons.length; index++) {
      expect(desktop.buttons[index].x).toBeGreaterThan(
        desktop.buttons[index - 1].x,
      );
    }
    // The cropped bar contains only public UI labels, never credentials or account data.
    await list.screenshot({
      path: test.info().outputPath(`${section}-desktop.png`),
    });

    await list.getByRole('tab').nth(1).click();
    await expect(list.getByRole('tab').nth(1)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await expect(list.getByRole('tab').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list.getByRole('tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Exercise the longest labels through the public language setting.
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'English', exact: true }).click();
    for (const viewport of [390, 320]) {
      await page.setViewportSize({ width: viewport, height: 844 });
      await page.goto(`/settings?section=${section}`);
      await expect(list.getByRole('tab')).toHaveCount(4);
      const narrow = await tabGeometry(list);
      expect(narrow.listDirection).toBe('row');
      expect(narrow.width).toBeLessThanOrEqual(narrow.viewport);
      expect(narrow.panelTop).toBeGreaterThanOrEqual(narrow.bottom);
      for (const tab of narrow.buttons) {
        expect(tab.x).toBeGreaterThanOrEqual(0);
        expect(tab.right).toBeLessThanOrEqual(viewport);
      }
      await list.screenshot({
        path: test.info().outputPath(`${section}-${viewport}.png`),
      });
      await list.getByRole('tab').nth(1).click();
      await expect(list.getByRole('tab').nth(1)).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await page.goto('/settings');
    await page.getByRole('radio', { name: '简体中文', exact: true }).click();
  }
});
