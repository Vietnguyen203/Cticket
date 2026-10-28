import { expect, signInAdmin, test } from '../support/fixtures'

/**
 * Phase 23: the "Tình trạng hệ thống" page. The API pushes its figures to
 * Redis every 10 seconds, so the page is reloaded until they show.
 */
test('system page: request figures, components, and a JavaScript error of the web', async ({ browser, page }, testInfo) => {
  // One message per project: desktop and mobile share the API.
  const message = `E2E: lỗi JavaScript cố ý (${testInfo.project.name})`
  // A visitor's page fails: the error is sent to the API by itself (no query string kept).
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/events?q=thu-loi')
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible()
  await visitor.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text)
    })
  }, message)

  await signInAdmin(page, '/admin/system')
  await expect(page.getByRole('heading', { name: 'Tình trạng hệ thống' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Hoạt động bình thường|cảnh báo|Redis|Worker|Cơ sở dữ liệu/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Cơ sở dữ liệu (PostgreSQL)' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /Phát vé/ })).toBeVisible()

  // The message is also in the (folded) stack: look for the list entry.
  const webError = page.getByRole('listitem').filter({ hasText: message })
  await expect(async () => {
    await page.getByRole('button', { name: 'Làm mới' }).click()
    const requests = page.getByText('Request / phút', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]')
    await expect(requests).not.toContainText('—', { timeout: 1000 })
    await expect(webError).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })

  await expect(webError).toContainText('1 lần')
  await expect(webError).toContainText('/events')
  await expect(webError).not.toContainText('thu-loi')
})
