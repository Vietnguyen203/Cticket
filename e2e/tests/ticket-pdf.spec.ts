import { readFile } from 'node:fs/promises'
import { buy, createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

/** Phase 20: the tickets as a PDF, from the order page and from one ticket. */
test('download the tickets as PDF (order and one ticket)', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const buyer = await createCustomer(api)
  const { order, tickets } = await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.A01, world.seat.A02] })

  await signIn(page, buyer.email, undefined, `/orders/${order.id}`)
  const [orderPdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải vé PDF' }).click()])
  expect(orderPdf.suggestedFilename()).toBe(`Ve-${order.orderCode}.pdf`)
  const content = await readFile(await orderPdf.path())
  expect(content.subarray(0, 5).toString()).toBe('%PDF-')

  await page.goto(`/tickets/${tickets[0].id}`)
  const [ticketPdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải vé PDF' }).click()])
  expect(ticketPdf.suggestedFilename()).toBe(`Ve-${tickets[0].code}.pdf`)
})
