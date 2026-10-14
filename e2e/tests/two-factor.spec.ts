import { createCustomer } from '../support/api'
import { createAdminAccount } from '../support/db'
import { expect, signIn, test } from '../support/fixtures'
import { totpCode } from '../support/totp'

/** Phase 15: two-factor authentication, through the pages. */

async function logOut(page: import('@playwright/test').Page) {
  await page.goto('/account')
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/account'))
}

test('a new admin must set up two-factor at the first login, then gets in with a recovery code', async ({ page }) => {
  const admin = await createAdminAccount({ twoFactor: false })

  await page.goto('/login?next=%2Fadmin')
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()

  // Set-up: the QR code, or the key typed by hand (what the test's "phone" reads).
  await expect(page.getByRole('heading', { name: 'Thiết lập xác thực hai lớp' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Mã QR để quét bằng ứng dụng xác thực' })).toBeVisible()
  const secret = ((await page.getByLabel('Khóa thiết lập').textContent()) ?? '').replace(/\s/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  await page.getByLabel('Mã xác thực').fill('000000')
  await expect(page.getByRole('alert')).toContainText('Mã xác thực không đúng. Còn 4 lần thử.')
  await page.getByLabel('Mã xác thực').fill(totpCode(secret))

  // 10 recovery codes, shown once; going on needs "I saved them".
  await expect(page.getByRole('heading', { name: 'Lưu mã khôi phục' })).toBeVisible()
  const codes = await page.getByRole('list', { name: 'Mã khôi phục' }).getByRole('listitem').allTextContents()
  expect(codes).toHaveLength(10)
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
  await page.getByLabel('Tôi đã lưu các mã này ở nơi an toàn').check()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.waitForURL(/\/admin$/)

  await page.goto('/account')
  await expect(page.getByText('Bắt buộc với quản trị viên.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tắt' })).toHaveCount(0)
  await logOut(page)

  // No phone: one of the recovery codes.
  await page.goto('/login?next=%2Fadmin')
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('heading', { name: 'Xác thực hai lớp' })).toBeVisible()
  await page.getByRole('button', { name: 'Không có điện thoại? Dùng mã khôi phục' }).click()
  await page.getByLabel('Mã khôi phục').fill(codes[0])
  await page.getByRole('button', { name: 'Xác nhận' }).click()
  await page.waitForURL(/\/admin$/)
})

test('a customer turns two-factor on from the account page; the next login asks for a code', async ({ page, api }) => {
  const customer = await createCustomer(api, 'Lan')
  await signIn(page, customer.email, undefined, '/account')

  await page.getByRole('button', { name: 'Bật xác thực hai lớp' }).click()
  await page.getByLabel('Mật khẩu hiện tại').fill(customer.password)
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  const secret = ((await page.getByLabel('Khóa thiết lập').textContent()) ?? '').replace(/\s/g, '')
  await page.getByLabel('Mã xác thực').fill(totpCode(secret))
  await page.getByLabel('Tôi đã lưu các mã này ở nơi an toàn').check()
  await page.getByRole('button', { name: 'Xong' }).click()
  await expect(page.getByText(/Đang bật từ .*Còn 10 mã khôi phục\./)).toBeVisible()

  await logOut(page)
  // The code of the next 30-second step: the one of this step was just used for the set-up.
  await page.goto('/login?next=%2Faccount')
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(customer.password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.getByLabel('Mã xác thực').fill(totpCode(secret, 1))
  await page.waitForURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Xác thực hai lớp' })).toBeVisible()
})
