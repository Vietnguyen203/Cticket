import path from 'node:path'
import { devices, type Page } from '@playwright/test'
import { addStaff, buy, createCustomer, createOrganizer, createPromotion, createPublishedEvent, qrTokenOf } from '../support/api'
import { createAdminAccount, openGates, sql } from '../support/db'
import { expect, signIn, test } from '../support/fixtures'
import { E2E_TOTP_SECRET, ROOT_DIR } from '../stack.mjs'

/**
 * The README screenshots (docs/images), on the E2E stack with made-up data.
 * Not part of `npm test`; run with `npm run screenshots` when the pages change.
 */
const OUT = path.join(ROOT_DIR, 'docs', 'images')
const seat = (code: string) => new RegExp(`^Ghế ${code},`)

/** Mouse out of the way and nothing focused (no hover / focus colours, no chart tooltip), then the picture. */
async function shot(page: Page, name: string) {
  await page.mouse.move(1, 1)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' })
}

const SHOWS = [
  { title: 'Hòa nhạc Mùa Thu Hà Nội', days: 21, category: 'Hòa nhạc', venue: 'Nhà hát Lớn Hà Nội', city: 'Hà Nội' },
  { title: 'Đêm nhạc Rock Sài Gòn', days: 28, category: 'Rock', venue: 'Nhà hát Hòa Bình', city: 'Hồ Chí Minh' },
  { title: 'Liveshow Acoustic Đà Lạt', days: 35, category: 'Acoustic', venue: 'Cung Hòa nhạc Đà Lạt', city: 'Đà Lạt' },
]

test('README screenshots', async ({ browser, api, admin }) => {
  test.setTimeout(240_000)
  const organizer = await createOrganizer(api, admin)
  await sql(`UPDATE organizers SET organization_name = 'Công ty Sự kiện Ánh Sao' WHERE id = $1`, [organizer.organizerId])
  await sql(`UPDATE users SET first_name = 'Minh', last_name = 'Trần' WHERE id = $1`, [organizer.id])
  const reviewer = await createAdminAccount({ firstName: 'Quản trị' })
  await sql(`UPDATE users SET last_name = 'viên' WHERE email = $1`, [reviewer.email])

  // Three shows on sale with readable names, renamed in the database before
  // anyone reads a list or a page (so nothing stale is cached).
  const worlds = []
  for (const show of SHOWS) {
    const world = await createPublishedEvent(api, { admin, organizer, daysFromNow: show.days })
    await sql(`UPDATE events SET title = $2, description = $3 WHERE id = $1`, [
      world.event.id,
      show.title,
      'Một đêm nhạc với dàn nhạc và các ca sĩ khách mời. Ghế ngồi theo khu, vé đứng ở sàn.',
    ])
    await sql(`UPDATE categories SET name = $2 WHERE id = (SELECT category_id FROM event_categories WHERE event_id = $1 LIMIT 1)`, [
      world.event.id,
      show.category,
    ])
    await sql(`UPDATE venues SET name = $2, city = $3 WHERE id = $1`, [world.venue.id, show.venue, show.city])
    // Guest artists ("Nghệ sĩ khách mời"), as the organizer enters them.
    await sql(`UPDATE events SET lineup = $2::jsonb WHERE id = $1`, [
      world.event.id,
      JSON.stringify(['Hà Anh Tuấn', 'Phương Linh', 'Dàn nhạc Giao hưởng Việt Nam'].map((artist) => ({ artist, time: null, note: null }))),
    ])
    worlds.push(world)
  }
  const main = worlds[0]

  // Sales: a few seats sold, two held by someone else, standing tickets.
  for (const seats of [['A01', 'A02'], ['A03'], ['B01', 'B02', 'B03']]) {
    await buy(api, await createCustomer(api), main.schedule.id, {
      seatIds: seats.map((code) => main.seat[code]),
      items: [{ ticketTypeId: main.standing.id, quantity: 2 }],
    })
  }
  const holder = await createCustomer(api)
  await api.post(`schedules/${main.schedule.id}/orders`, {
    headers: { Authorization: `Bearer ${holder.token}` },
    data: { seatIds: [main.seat.B05, main.seat.B06] },
  })
  for (const world of worlds.slice(1)) {
    await buy(api, await createCustomer(api), world.schedule.id, { items: [{ ticketTypeId: world.standing.id, quantity: 3 }] })
  }
  const code = await createPromotion(api, admin, 10)

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })

  // 1. Home (signed out)
  const visitor = await desktop.newPage()
  await visitor.goto('/')
  await expect(visitor.getByText(SHOWS[0].title).first()).toBeVisible()
  await shot(visitor, '01-home')
  await visitor.close()

  // 2. Seat map, two seats picked
  const buyer = await createCustomer(api, 'Lan')
  const page = await desktop.newPage()
  await signIn(page, buyer.email, undefined, `/events/${main.event.slug}/schedules/${main.schedule.id}`)
  await expect(page.getByText('Cập nhật trực tiếp')).toBeVisible()
  await page.getByRole('button', { name: seat('A05') }).click()
  await page.getByRole('button', { name: seat('A06') }).click()
  await page.getByRole('button', { name: 'Thêm Đứng' }).click()
  await shot(page, '02-seat-map')

  // 3. Held order with a promotion code
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(page).toHaveURL(/\/orders\//)
  await page.getByLabel('Mã giảm giá').fill(code)
  await page.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.getByText(`Mã ${code}`)).toBeVisible()
  await shot(page, '03-order')

  // 4. Paid → a ticket with its QR code
  await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
  // Through VNPay (the E2E stack's fake VNPay page).
  await page.getByRole('button', { name: /qua VNPay$/ }).click()
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).click()
  await expect(page.getByText('Thanh toán thành công!')).toBeVisible()
  await page.getByRole('link', { name: /Xem QR/ }).first().click()
  await expect(page.getByRole('img', { name: /Mã QR của vé/ })).toBeVisible()
  await shot(page, '04-ticket')
  const ticketId = page.url().split('/').at(-1)!
  const qr = await qrTokenOf(api, buyer, ticketId)
  await page.close()

  // 5. Admin dashboard
  const adminPage = await desktop.newPage()
  await signIn(adminPage, reviewer.email, reviewer.password, '/admin', E2E_TOTP_SECRET)
  await expect(adminPage.getByText('Bán chạy 30 ngày')).toBeVisible()
  await shot(adminPage, '05-admin-dashboard')
  await adminPage.close()

  // 6. Organizer: sales of the show, 7. its schedule, ticket types, seat blocking
  const orgPage = await desktop.newPage()
  await signIn(orgPage, organizer.email, undefined, `/organizer/events/${main.event.id}?tab=sales`)
  await expect(orgPage.getByText('Doanh thu theo ngày')).toBeVisible()
  await shot(orgPage, '06-organizer-sales')
  await orgPage.goto(`/organizer/events/${main.event.id}?tab=schedules`)
  await expect(orgPage.getByText('Khóa / mở ghế')).toBeVisible()
  await shot(orgPage, '07-organizer-schedules')
  await desktop.close()

  // 8. Gate staff on a phone: "Mời vào" (last: opening the gates moves the show to today)
  await openGates(main.schedule.id)
  const staff = await addStaff(api, organizer, main.event.id, await createCustomer(api, 'Hùng'))
  const phone = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const gate = await phone.newPage()
  await signIn(gate, staff.email, undefined, `/staff/scan/${main.schedule.id}`)
  await gate.getByLabel('Mã QR').fill(qr)
  await gate.getByRole('button', { name: 'Kiểm tra' }).click()
  await expect(gate.getByText('Mời vào')).toBeVisible()
  await gate.screenshot({ path: path.join(OUT, '08-gate-phone.png') })
  await phone.close()
})
