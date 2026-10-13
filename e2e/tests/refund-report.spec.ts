import { buy, createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { E2E_ADMIN } from '../stack.mjs'
import { expect, signIn, test } from '../support/fixtures'

test('an admin refund: the ticket is void and the organizer’s sales report moves it from revenue to refunds', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const kept = await buy(api, await createCustomer(api), world.schedule.id, {
    seatIds: [world.seat.A01],
    items: [{ ticketTypeId: world.standing.id, quantity: 1 }],
  }) // 2.000.000 + 500.000
  const buyer = await createCustomer(api)
  const refunded = await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.B01] }) // 1.000.000

  const orgContext = await browser.newContext()
  const orgPage = await orgContext.newPage()
  await signIn(orgPage, organizer.email, undefined, `/organizer/events/${world.event.id}?tab=sales`)
  // A figure card: its label <p> and the value under it.
  const stat = (label: string) => orgPage.locator('p', { hasText: new RegExp(`^${label}$`) }).locator('..')
  await expect(stat('Doanh thu')).toContainText('3.500.000')
  await expect(stat('Vé đã bán')).toContainText('3')

  // The admin refunds the B01 order, with a reason.
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await signIn(adminPage, E2E_ADMIN.email, E2E_ADMIN.password, `/admin/orders/${refunded.order.id}`)
  await adminPage.getByRole('button', { name: 'Hoàn tiền' }).click()
  const dialog = adminPage.getByRole('dialog')
  await dialog.getByLabel('Lý do').fill('Khách xin hủy (E2E)')
  await dialog.getByRole('button', { name: 'Hoàn tiền' }).click()
  await expect(adminPage.getByText('Đã hoàn tiền').first()).toBeVisible()
  await adminContext.close()

  // The buyer's ticket is no longer valid (no QR).
  const ticket = await api.get(`tickets/${refunded.tickets[0].id}`, { headers: { Authorization: `Bearer ${buyer.token}` } })
  expect((await ticket.json()).data.ticket).toMatchObject({ status: 'REFUNDED', qrToken: null })

  // The organizer's report: revenue down, the refund shown apart.
  await orgPage.reload()
  await expect(stat('Doanh thu')).toContainText('2.500.000')
  await expect(stat('Vé đã bán')).toContainText('2')
  await expect(stat('Hoàn tiền')).toContainText('1.000.000')
  await expect(orgPage.getByRole('row', { name: /CAT 2/ })).toContainText('0 / 10')
  expect(kept.tickets).toHaveLength(2)
  await orgContext.close()
})
