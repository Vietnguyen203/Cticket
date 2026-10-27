import { readFile } from 'node:fs/promises'
import { buy, createCustomer, createOrganizer, createPublishedEvent, PASSWORD } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

test('my personal data: download it, and delete the account (only once nothing is pending)', async ({ page, api, admin }) => {
  const customer = await createCustomer(api)
  await signIn(page, customer.email, PASSWORD, '/account')

  // The file holds my account.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải dữ liệu của tôi' }).click()])
  expect(download.suggestedFilename()).toMatch(/^etp-du-lieu-ca-nhan-\d{4}-\d{2}-\d{2}\.json$/)
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.account.email).toBe(customer.email)

  // Nothing pending: delete, with the password and the "not undoable" box.
  await page.getByRole('button', { name: 'Xóa tài khoản…' }).click()
  const confirm = page.getByRole('button', { name: 'Xóa vĩnh viễn tài khoản' })
  await page.getByLabel('Nhập mật khẩu để xác nhận').fill('Sai-mat-khau-1')
  await expect(confirm).toBeDisabled()
  await page.getByRole('checkbox', { name: /không hoàn tác được/ }).check()
  await confirm.click()
  await expect(page.getByRole('alert')).toContainText('Mật khẩu không đúng.')
  await page.getByLabel('Nhập mật khẩu để xác nhận').fill(PASSWORD)
  await confirm.click()

  // Signed out, on the home page, told once.
  await expect(page.getByText('Tài khoản của bạn đã được xóa.', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible()
  await page.goto('/login')
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)

  // A buyer with a ticket still to come cannot delete yet, and is told why.
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })
  const buyer = await createCustomer(api)
  await buy(api, buyer, world.schedule.id, { seatIds: [world.seat.A01] })
  await signIn(page, buyer.email, PASSWORD, '/account')
  await expect(page.getByText('Bạn còn vé cho buổi diễn chưa diễn ra.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Xóa tài khoản…' })).toHaveCount(0)
})
