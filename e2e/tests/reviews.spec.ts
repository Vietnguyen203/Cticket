import { buy, createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { sql } from '../support/db'
import { expect, signIn, signInAdmin, test } from '../support/fixtures'

/**
 * Phase 19: someone who went in reviews the event; it shows on the event
 * page; the organizer answers; an admin hides it and the average follows.
 */
test('review: attendee writes it, organizer answers, admin hides it', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const fan = await createCustomer(api, 'Lan')
  const { order } = await buy(api, fan, world.schedule.id, { seatIds: [world.seat.A01] })
  await sql(`UPDATE tickets SET status = 'USED', used_at = now() WHERE order_id = $1`, [order.id]) // as if scanned at the gate

  // The attendee: from "Vé của tôi" to the event's reviews.
  const fanContext = await browser.newContext()
  const fanPage = await fanContext.newPage()
  await signIn(fanPage, fan.email, undefined, '/tickets')
  await fanPage.getByRole('link', { name: '★ Đánh giá sự kiện' }).click()
  await fanPage.getByRole('button', { name: 'Viết đánh giá' }).click()
  await fanPage.getByRole('radio', { name: '4 sao' }).click()
  await fanPage.getByLabel('Nhận xét').fill('Âm thanh rất tốt, vào cổng nhanh.')
  await fanPage.getByRole('button', { name: 'Gửi đánh giá' }).click()
  const reviews = fanPage.locator('#danh-gia')
  await expect(reviews.getByText('Âm thanh rất tốt, vào cổng nhanh.').last()).toBeVisible()
  await expect(reviews.getByText('Đã đi xem')).toBeVisible()
  await expect(reviews.getByText('1 đánh giá')).toBeVisible()

  // The organizer answers on the same page.
  const orgContext = await browser.newContext()
  const orgPage = await orgContext.newPage()
  await signIn(orgPage, organizer.email, undefined, `/events/${world.event.slug}`)
  await orgPage.getByRole('button', { name: 'Trả lời', exact: true }).click()
  await orgPage.getByLabel('Câu trả lời của ban tổ chức').fill('Cảm ơn bạn đã đến!')
  await orgPage.getByRole('button', { name: 'Gửi trả lời' }).click()
  await expect(orgPage.getByText('Cảm ơn bạn đã đến!')).toBeVisible()

  // An admin hides it: gone from the page and from the average; the author sees why.
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await signInAdmin(adminPage, '/admin/reviews')
  const row = adminPage.getByRole('row').filter({ hasText: world.title })
  await row.getByRole('button', { name: 'Ẩn' }).click()
  await adminPage.getByRole('dialog').getByRole('textbox').fill('Thử ẩn đánh giá')
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Ẩn đánh giá' }).click()
  await expect(row.getByText('Đã ẩn: Thử ẩn đánh giá')).toBeVisible()

  await fanPage.reload()
  await expect(fanPage.getByText('Đánh giá này đã bị quản trị viên ẩn: Thử ẩn đánh giá')).toBeVisible()
  await expect(fanPage.locator('#danh-gia').getByText('0 đánh giá')).toBeVisible()

  await Promise.all([fanContext.close(), orgContext.close(), adminContext.close()])
})
