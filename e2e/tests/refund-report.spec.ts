import { buy, createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, signInAdmin, test } from '../support/fixtures'

test('a cancelled event: every paid order refunded, tickets void, the sales report moves them from revenue to refunds', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const keptBuyer = await createCustomer(api)
  const kept = {
    buyer: keptBuyer,
    ...(await buy(api, keptBuyer, world.schedule.id, {
      seatIds: [world.seat.A01],
      items: [{ ticketTypeId: world.standing.id, quantity: 1 }],
    })), // 2.000.000 + 500.000
  }
  const buyer = await createCustomer(api)
  const refunded = await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.B01] }) // 1.000.000

  const orgContext = await browser.newContext()
  const orgPage = await orgContext.newPage()
  await signIn(orgPage, organizer.email, undefined, `/organizer/events/${world.event.id}?tab=sales`)
  // A figure card: its label <p> and the value under it.
  const stat = (label: string) => orgPage.locator('p', { hasText: new RegExp(`^${label}$`) }).locator('..')
  await expect(stat('Doanh thu')).toContainText('3.500.000')
  await expect(stat('Vé đã bán')).toContainText('3')

  // No refund on request: the admin's order page has no refund button.
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await signInAdmin(adminPage, `/admin/orders/${refunded.order.id}`)
  await expect(adminPage.getByText('Thanh toán', { exact: true })).toBeVisible()
  await expect(adminPage.getByRole('button', { name: 'Hoàn tiền' })).toHaveCount(0)
  await adminContext.close()

  // The organizer cancels the event, with a reason: every paid order is refunded.
  await orgPage.getByRole('button', { name: 'Hủy sự kiện' }).click()
  const dialog = orgPage.getByRole('dialog')
  await dialog.getByLabel('Lý do').fill('Mưa bão (E2E)')
  await dialog.getByRole('button', { name: 'Hủy sự kiện' }).click()
  await expect(orgPage.getByText('Đã hủy').first()).toBeVisible()

  // The buyers' tickets are no longer valid (no QR).
  for (const [owner, ticketId] of [[buyer, refunded.tickets[0].id], [kept.buyer, kept.tickets[0].id]] as const) {
    const ticket = await api.get(`tickets/${ticketId}`, { headers: { Authorization: `Bearer ${owner.token}` } })
    expect((await ticket.json()).data.ticket).toMatchObject({ status: 'REFUNDED', qrToken: null })
  }

  // The organizer's report: the revenue moves to refunds.
  await orgPage.goto(`/organizer/events/${world.event.id}?tab=sales`)
  await expect(stat('Hoàn tiền')).toContainText('3.500.000')
  await expect(stat('Vé đã bán')).toContainText('0')
  await expect(stat('Doanh thu')).not.toContainText('3.500.000')
  await orgContext.close()
})
