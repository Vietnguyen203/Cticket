import { createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

const seat = (code: string) => new RegExp(`^Ghế ${code},`)

/**
 * Phase 21: the purchase queue. The organizer lets one person buy at a time;
 * Alice gets the turn, Bob waits in line and is let in by himself once Alice
 * has paid.
 */
test('purchase queue: one buys, the other waits, then goes in by himself', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const [alice, bob] = [await createCustomer(api, 'Alice'), await createCustomer(api, 'Bob')]
  const mapUrl = `/events/${world.event.slug}/schedules/${world.schedule.id}`

  // The organizer switches the queue on while the event is selling.
  const orgPage = await (await browser.newContext()).newPage()
  await signIn(orgPage, organizer.email, undefined, `/organizer/events/${world.event.id}`)
  await orgPage.getByLabel('Bật hàng chờ').check()
  await orgPage.getByLabel('Số người được mua cùng lúc').fill('1')
  await orgPage.getByRole('button', { name: 'Lưu hàng chờ' }).click()
  await expect(orgPage.getByTestId('queue-stats')).toContainText('đang mua 0 / 1')

  const alicePage = await (await browser.newContext()).newPage()
  await signIn(alicePage, alice.email, undefined, mapUrl)
  await expect(alicePage.getByText('Đến lượt bạn mua vé')).toBeVisible()

  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob.email, undefined, mapUrl)
  await expect(bobPage.getByRole('heading', { name: 'Bạn đang trong hàng chờ mua vé' })).toBeVisible()
  await expect(bobPage.getByTestId('queue-place')).toHaveText('1')
  await expect(bobPage.getByText('Bạn là người tiếp theo')).toBeVisible()
  await expect(orgPage.getByTestId('queue-stats')).toContainText('đang chờ 1', { timeout: 15_000 })

  // Alice holds a seat and pays: her turn goes to Bob.
  await alicePage.getByRole('button', { name: seat('A01') }).click()
  await alicePage.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await alicePage.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
  await alicePage.getByRole('button', { name: 'Giả lập thanh toán thành công' }).click()
  await expect(alicePage.getByRole('link', { name: /Xem QR/ }).first()).toBeVisible()

  // Bob's page, never reloaded, now shows the seat map; he can hold a seat.
  await expect(bobPage.getByText('Đến lượt bạn mua vé')).toBeVisible({ timeout: 15_000 })
  await bobPage.getByRole('button', { name: seat('A02') }).click()
  await bobPage.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(bobPage.getByRole('timer')).toContainText('Ghế được giữ cho bạn trong')
})
