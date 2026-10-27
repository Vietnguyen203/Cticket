import { createOrganizer, createPublishedEvent } from '../support/api'
import { expect, test } from '../support/fixtures'

test('the terms of sale: from the event page to the refund article, with the legal bases', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })

  await page.goto(`/events/${world.event.slug}`)
  await page.getByRole('link', { name: 'Điều kiện hoàn tiền' }).click()

  await expect(page).toHaveURL(/\/dieu-khoan#huy-va-hoan-tien$/)
  await expect(page.getByRole('heading', { name: 'Điều kiện giao dịch chung' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Điều 5. Không hủy vé, hoàn tiền khi sự kiện bị hủy' })).toBeInViewport()
  await expect(page.getByText(/Tiền vé chỉ được hoàn khi sự kiện hoặc suất diễn bị hủy/)).toBeVisible()
  // Each legal basis opens its full text in a new tab (not followed here: an outside site).
  const civilCode = page.getByRole('link', { name: /^Bộ luật Dân sự số 91\/2015\/QH13/ })
  await expect(civilCode).toHaveAttribute('href', /^https:\/\/thuvienphapluat\.vn\/van-ban\//)
  await expect(civilCode).toHaveAttribute('target', '_blank')

  // Also one click away from every page: the footer, and "Chính sách" in the menu (a new tab).
  await page.goto('/')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Điều kiện giao dịch' }).click()
  await expect(page).toHaveURL(/\/dieu-khoan$/)

  await page.goto('/events')
  const [tab] = await Promise.all([page.waitForEvent('popup'), page.getByRole('banner').getByRole('link', { name: /^Chính sách/ }).click()])
  await expect(tab).toHaveURL(/\/dieu-khoan$/)
  await expect(tab.getByRole('heading', { name: 'Điều kiện giao dịch chung' })).toBeVisible()
  await expect(page).toHaveURL(/\/events$/) // the page the visitor was on stays
})
