import { createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

const seat = (code: string) => new RegExp(`^Ghế ${code},`)

test('change a held order (BKG-02): swap a seat on the map, drop one on the order page; another buyer sees it live', async ({ browser, page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const [buyer, watcher] = [await createCustomer(api, 'Lan'), await createCustomer(api, 'Minh')]
  const mapUrl = `/events/${world.event.slug}/schedules/${world.schedule.id}`

  // Another buyer keeps the seat map open, never reloading it.
  const watcherContext = await browser.newContext()
  const watcherPage = await watcherContext.newPage()
  await signIn(watcherPage, watcher.email, undefined, mapUrl)
  await expect(watcherPage.getByText('Cập nhật trực tiếp')).toBeVisible()

  // Hold A05 and A07.
  await signIn(page, buyer.email, undefined, mapUrl)
  await page.getByRole('button', { name: seat('A05') }).click()
  await page.getByRole('button', { name: seat('A07') }).click()
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(page).toHaveURL(/\/orders\//)
  const orderUrl = page.url()

  // Back on the map, the page changes this order: its seats start picked.
  await page.getByRole('link', { name: 'Đổi / thêm ghế' }).click()
  await expect(page.getByRole('heading', { name: 'Đổi ghế' })).toBeVisible()
  await expect(page.getByRole('button', { name: seat('A05') })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: seat('A05') }).click()
  await page.getByRole('button', { name: seat('A06') }).click()
  await expect(page.getByLabel('Thay đổi')).toContainText('Thêm: A06')
  await expect(page.getByLabel('Thay đổi')).toContainText('Bỏ: A05')
  await page.getByRole('button', { name: 'Cập nhật đơn' }).click()

  // The same order now holds A06 and A07.
  await expect(page).toHaveURL(orderUrl)
  await expect(page.getByRole('cell', { name: /^Khu A - A06$/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Khu A - A05$/ })).toHaveCount(0)

  // One seat out from the order page; with one ticket left, no more "Bỏ" (that is "Hủy giữ chỗ").
  await page.getByRole('button', { name: /^Bỏ ghế .*A07$/ }).click()
  await expect(page.getByRole('cell', { name: /^Khu A - A07$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Bỏ ghế/ })).toHaveCount(0)

  // The watcher's map followed every change.
  await expect(watcherPage.getByRole('button', { name: /^Ghế A05, .*còn trống/ })).toBeVisible()
  await expect(watcherPage.getByRole('button', { name: /^Ghế A07, .*còn trống/ })).toBeVisible()
  await expect(watcherPage.getByRole('button', { name: /^Ghế A06, .*đang có người giữ/ })).toBeVisible()
  await watcherContext.close()
})
