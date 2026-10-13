import { createCustomer, createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

// The pages hide what a user may not use; the API refuses it anyway (403 / 404).

test('a customer has no admin menu and gets 403 on admin pages', async ({ page, api }) => {
  const customer = await createCustomer(api)
  await signIn(page, customer.email)
  await expect(page.getByRole('link', { name: 'Quản trị' })).toHaveCount(0)
  await page.goto('/admin/reports')
  await expect(page.getByText('Bạn không có quyền xem trang này')).toBeVisible()
})

test('an organizer cannot open another organizer’s event, nor the platform reports', async ({ page, api, admin }) => {
  const owner = await createOrganizer(api, admin)
  const other = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer: owner })

  await signIn(page, other.email)
  await page.goto(`/organizer/events/${world.event.id}?tab=sales`)
  await expect(page.getByText('Không tìm thấy nội dung bạn cần.')).toBeVisible()
  await expect(page.getByText(world.title)).toHaveCount(0)

  await page.goto(`/admin/reports/events/${world.event.id}`)
  await expect(page.getByText('Bạn không có quyền xem trang này')).toBeVisible()
})

test('signed-out visitors are sent to the login page, then back', async ({ page, api }) => {
  const customer = await createCustomer(api)
  await page.goto('/tickets')
  await expect(page).toHaveURL(/\/login\?next=%2Ftickets/)
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(customer.password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).toHaveURL(/\/tickets$/)
  await expect(page.getByRole('heading', { name: 'Vé của tôi' })).toBeVisible()
})
