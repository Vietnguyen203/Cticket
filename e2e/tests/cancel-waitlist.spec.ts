import { buy, createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/**
 * Phase 18.3: a buyer cancels a paid order under the event's refund policy
 * ("Tiêu chuẩn": 30 days before the show → 80% back).
 */
test('cancel a paid order: the refund shown is the refund made, the fee is kept', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  expect((await api.patch(`events/${world.event.id}`, { headers: bearer(organizer.token), data: { refundPolicy: 'STANDARD' } })).ok()).toBe(true)
  const buyer = await createCustomer(api)
  const { order } = await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.A01] })

  await page.goto(`/events/${world.event.slug}`)
  await expect(page.getByText('Chính sách hủy: Tiêu chuẩn')).toBeVisible()

  await signIn(page, buyer.email, undefined, `/orders/${order.id}`)
  await expect(page.getByText(/hủy bây giờ được hoàn 1\.600\.000.*\(80%\), phí hủy 400\.000/)).toBeVisible()
  await page.getByRole('button', { name: 'Hủy đơn và hoàn tiền' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy đơn' }).click()

  await expect(page.getByText('Đã hoàn tiền', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hoàn tiền' })).toBeVisible()
  await expect(page.getByText(/^1\.600\.000/)).toBeVisible()
  await expect(page.getByText('Đã hoàn', { exact: true })).toBeVisible()
})

/**
 * Phase 18.4: B waits for the last standing ticket; A gives it back; B gets
 * the offer (kept for B) and books it from the waiting list page.
 */
test('waiting list: sold out → "Báo tôi khi có vé" → someone cancels → offer → booked', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  // Only 1 standing ticket on sale.
  const blocked = await api.post(`schedules/${world.schedule.id}/inventory/block`, {
    headers: bearer(organizer.token),
    data: { action: 'BLOCK', reason: 'Kept for sponsors', ticketTypeId: world.standing.id, quantity: 99 },
  })
  expect(blocked.ok()).toBe(true)
  const [alice, bob] = [await createCustomer(api, 'Alice'), await createCustomer(api, 'Bob')]
  const held = await api.post(`schedules/${world.schedule.id}/orders`, {
    headers: bearer(alice.token),
    data: { items: [{ ticketTypeId: world.standing.id, quantity: 1 }] },
  })
  const aliceOrder = (await held.json()).data.order

  const context = await browser.newContext()
  const page = await context.newPage()
  const mapUrl = `/events/${world.event.slug}/schedules/${world.schedule.id}`
  await signIn(page, bob.email, undefined, mapUrl)
  await expect(page.getByText('Hết vé? Vào danh sách chờ')).toBeVisible()
  await page.getByRole('button', { name: 'Báo tôi khi có vé' }).click()
  await expect(page.getByText('Đã vào danh sách chờ, bạn đứng thứ 1.')).toBeVisible()

  // Alice gives her ticket back; the offer job (every 2 s on this stack) offers it to Bob.
  expect((await api.post(`orders/${aliceOrder.id}/cancel`, { headers: bearer(alice.token) })).ok()).toBe(true)
  await page.getByRole('link', { name: 'Danh sách chờ', exact: true }).click()
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('Có vé cho bạn')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  // Kept for Bob: Alice cannot take it back.
  const again = await api.post(`schedules/${world.schedule.id}/orders`, {
    headers: bearer(alice.token),
    data: { items: [{ ticketTypeId: world.standing.id, quantity: 1 }] },
  })
  expect(again.status()).toBe(409)

  await page.getByRole('link', { name: 'Đặt ngay' }).click()
  await page.getByRole('button', { name: 'Thêm Đứng' }).click()
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await page.goto('/waitlist')
  await expect(page.getByText('Đã đặt')).toBeVisible()
  await context.close()
})
