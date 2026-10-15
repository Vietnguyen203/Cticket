import { createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { FAKE_VNPAY_URL } from '../stack.mjs'
import { expect, signIn, test } from '../support/fixtures'

const seat = (code: string) => new RegExp(`^Ghế ${code},`)

/**
 * Phase 17: paying through VNPay. VNPay is the fake one of the E2E stack
 * (support/fake-vnpay.mjs): the browser really leaves the app for its page,
 * VNPay's IPN really reaches the API, and the browser really comes back.
 */
test('VNPay: cancelled at VNPay (reason shown), then paid: back on the order with the ticket', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const buyer = await createCustomer(api)

  await signIn(page, buyer.email, undefined, `/events/${world.event.slug}/schedules/${world.schedule.id}`)
  await page.getByRole('button', { name: seat('A01') }).click()
  await page.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const orderUrl = page.url()
  await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()

  // 1. To VNPay's page (our signed URL is accepted there), and cancel.
  await page.getByRole('button', { name: /^Thanh toán 2\.000\.000.* qua VNPay$/ }).click()
  await expect(page).toHaveURL(new RegExp(`^${FAKE_VNPAY_URL}/paymentv2/vpcpay\\.html\\?`))
  await expect(page.getByText('2.000.000 VND')).toBeVisible()
  await page.getByRole('button', { name: 'Hủy giao dịch' }).click()

  // Back in the app: VNPay's reason, the seat still held.
  await expect(page).toHaveURL(/\/payments\/vnpay\/return\?/)
  await expect(page.getByText('Bạn đã hủy giao dịch trên VNPay.')).toBeVisible()
  await page.getByRole('link', { name: 'Về trang đơn hàng' }).click()
  await expect(page).toHaveURL(orderUrl)
  await expect(page.getByText('Thanh toán không thành công: Bạn đã hủy giao dịch trên VNPay.')).toBeVisible()

  // 2. Again, and pay: straight back to the order, paid, with the ticket.
  await page.getByRole('button', { name: /qua VNPay$/ }).click()
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).click()
  await expect(page).toHaveURL(orderUrl)
  await expect(page.getByText('Thanh toán thành công!')).toBeVisible()
  await expect(page.getByRole('link', { name: /Xem QR/ })).toHaveCount(1)
})
