import { expect, test } from '@playwright/test';

test('a newly registered Member writes Markdown and reads it after refresh', async ({
  page,
}) => {
  await page.goto('/register');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill('knowledge-member@example.com');
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByText('成员', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '我的文档', exact: true }).click();
  await expect(page.getByText('暂无可访问的文档')).toBeVisible();
  await page.getByRole('button', { name: '新建文档' }).click();
  await page.getByLabel('标题', { exact: true }).fill('第一篇团队笔记');
  await page
    .getByLabel('Markdown 正文', { exact: true })
    .fill('# 起步\n\n来自真实 PostgreSQL。');
  await page.getByRole('tab', { name: '预览' }).click();
  await expect(page.getByRole('heading', { name: '起步' })).toBeVisible();
  await page.getByRole('button', { name: '保存文档' }).click();
  await expect(
    page.getByRole('heading', { name: '第一篇团队笔记' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '第一篇团队笔记' }),
  ).toBeVisible();
  await expect(page.locator('article')).toContainText('来自真实 PostgreSQL。');
  await page.getByRole('button', { name: '我的文档' }).click();
  await page.getByLabel('标题关键词').fill('团队');
  await page.getByLabel('标题关键词').press('Enter');
  await page.getByRole('button', { name: '第一篇团队笔记' }).click();
  await expect(
    page.getByRole('heading', { name: '第一篇团队笔记' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '起步' })).toBeVisible();
});
