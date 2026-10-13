import { addStaff, buy, createCustomer, createOrganizer, createPublishedEvent, qrTokenOf } from '../support/api'
import { openGates } from '../support/db'
import { expect, signIn, test } from '../support/fixtures'

// Phone size (project "mobile"). There is no camera in the test browser: the
// scan goes through the paste box, the same path a handheld scanner uses.
test('gate staff on a phone: in once, refused the second time, listed in the history', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const buyer = await createCustomer(api)
  const { tickets } = await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.A01] })
  const qr = await qrTokenOf(api, buyer, tickets[0].id)
  await openGates(world.schedule.id)
  const staff = await addStaff(api, organizer, world.event.id, await createCustomer(api, 'Hùng'))

  await signIn(page, staff.email)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('navigation').getByRole('link', { name: 'Soát vé' }).click()
  await page.getByLabel('Tên cổng của máy này').fill('Cổng E2E')
  await page.locator('section', { has: page.getByRole('heading', { name: world.title }) }).getByRole('link', { name: 'Quét vé' }).click()
  await expect(page.getByRole('heading', { name: world.title })).toBeVisible()
  await expect(page.getByText('Cổng: Cổng E2E')).toBeVisible()

  const scan = async () => {
    await page.getByLabel('Mã QR').fill(qr)
    await page.getByRole('button', { name: 'Kiểm tra' }).click()
  }
  const result = page.getByRole('button', { name: /Chạm để quét tiếp/ })

  await scan()
  await expect(result).toContainText('Mời vào')
  await expect(result).toContainText(tickets[0].code)
  await expect(result).toContainText('Đã vào 1 / 1')
  await result.click()

  // The same code is sent once per 3 s (a QR stays in front of the camera): wait, then scan again.
  await page.waitForTimeout(3_100)
  await scan()
  await expect(result).toContainText('Vé đã được sử dụng')
  await expect(result).toContainText('Tại: Cổng E2E')
  await result.click()

  await page.getByRole('link', { name: /lịch sử/ }).click()
  await expect(page.getByText('Đã vào 1 / 1 vé')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(tickets[0].code) })).toContainText('Cổng E2E')
})
