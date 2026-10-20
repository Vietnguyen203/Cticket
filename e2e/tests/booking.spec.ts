import { createCustomer, createOrganizer, createPromotion, createPublishedEvent } from '../support/api'
import { makeHoldDue } from '../support/db'
import { expect, signIn, test } from '../support/fixtures'

const seat = (code: string) => new RegExp(`^Ghế ${code},`)

test('buy 2 seats + 1 standing: hold, wrong then right code, declined card, paid, tickets with QR', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const code = await createPromotion(api, admin, 10)
  const buyer = await createCustomer(api)

  await signIn(page, buyer.email)
  await page.goto(`/events/${world.event.slug}`)
  await expect(page.getByRole('heading', { name: world.title })).toBeVisible()
  await page.getByRole('link', { name: 'Chọn chỗ' }).first().click()

  await expect(page.getByText('Cập nhật trực tiếp')).toBeVisible()
  await page.getByRole('button', { name: seat('A01') }).click()
  await page.getByRole('button', { name: seat('A02') }).click()
  await page.getByRole('button', { name: 'Thêm Đứng' }).click()
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()

  // The held order: 2 × 2.000.000 + 500.000, counting down.
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('timer')).toContainText('Ghế được giữ cho bạn trong')
  await expect(page.getByRole('row', { name: /Tổng cộng/ })).toContainText('4.500.000')

  await page.getByLabel('Mã giảm giá').fill('KHONGCO1')
  await page.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Mã giảm giá').fill(code)
  await page.getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.getByText(`Mã ${code}: giảm 450.000`)).toBeVisible()
  await expect(page.getByRole('row', { name: /Tổng cộng/ })).toContainText('4.050.000')

  await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
  await page.getByRole('button', { name: 'Giả lập thẻ bị từ chối' }).click()
  await expect(page.getByText('Thanh toán bị từ chối. Ghế vẫn được giữ')).toBeVisible()
  // VNPay is offered too (fake VNPay, tests/vnpay.spec.ts); this one pays with the simulator.
  await page.getByRole('button', { name: 'Giả lập thanh toán thành công' }).click()
  await expect(page.getByText('Thanh toán thành công!')).toBeVisible()

  // 3 tickets, each with its QR code.
  const tickets = page.getByRole('link', { name: /Xem QR/ })
  await expect(tickets).toHaveCount(3)
  await tickets.first().click()
  await expect(page.getByRole('img', { name: /Mã QR của vé TKT-/ })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Vé của tôi' }).click()
  await expect(page.getByText(world.title)).toHaveCount(3)
})

test('real time: what one buyer holds changes colour at once on another buyer’s map', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const [alice, bob] = [await createCustomer(api, 'Alice'), await createCustomer(api, 'Bob')]
  const mapUrl = `/events/${world.event.slug}/schedules/${world.schedule.id}`

  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()
  await signIn(alicePage, alice.email, undefined, mapUrl)
  await signIn(bobPage, bob.email, undefined, mapUrl)
  await expect(alicePage.getByText('Cập nhật trực tiếp')).toBeVisible()
  await expect(bobPage.getByText('Cập nhật trực tiếp')).toBeVisible()

  // Bob picks A03 but has not held it yet.
  await bobPage.getByRole('button', { name: seat('A03') }).click()

  // Alice holds A03 and A04.
  await alicePage.getByRole('button', { name: seat('A03') }).click()
  await alicePage.getByRole('button', { name: seat('A04') }).click()
  await alicePage.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(alicePage).toHaveURL(/\/orders\//)

  // Bob's page, never reloaded: both seats are taken, and A03 left his selection with a notice.
  await expect(bobPage.getByRole('button', { name: /^Ghế A04, .*đang có người giữ/ })).toBeVisible()
  await expect(bobPage.getByRole('button', { name: /^Ghế A03, .*đang có người giữ/ })).toBeVisible()
  await expect(bobPage.getByText('Ghế A03 vừa có người khác giữ, đã bỏ khỏi lựa chọn của bạn.')).toBeVisible()

  await aliceContext.close()
  await bobContext.close()
})

test('a hold that runs out: the order says so and the seat is on sale again', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const buyer = await createCustomer(api)
  const mapUrl = `/events/${world.event.slug}/schedules/${world.schedule.id}`

  await signIn(page, buyer.email, undefined, mapUrl)
  await page.getByRole('button', { name: seat('B05') }).click()
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(page).toHaveURL(/\/orders\//)
  const orderId = page.url().split('/').at(-1)!

  await makeHoldDue(orderId) // instead of waiting 10 minutes
  await page.reload()
  await expect(page.getByText('Đã hết thời gian giữ chỗ, ghế đã được mở bán lại.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục thanh toán' })).toHaveCount(0)

  await page.goto(mapUrl)
  await expect(page.getByRole('button', { name: /^Ghế B05, .*còn trống/ })).toBeVisible()
})
