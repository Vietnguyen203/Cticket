import { latestOtp, PASSWORD, unique } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

test('register → email code (Mailpit) → signed in; log out; log in again', async ({ page, api }) => {
  const email = `new-${unique()}@e2e.test`

  await page.goto('/register')
  await page.getByLabel('Họ').fill('Nguyễn')
  await page.getByLabel('Tên').fill('Lan')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Nhập lại mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng ký' }).click()

  await expect(page).toHaveURL(/\/verify-email/)
  await page.getByLabel('Mã xác minh').fill(await latestOtp(api, email))
  await page.getByRole('button', { name: 'Xác minh' }).click()

  // Signed in straight away: the name is in the header.
  await expect(page.getByRole('link', { name: 'Lan' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('link', { name: 'Vé của tôi' })).toBeVisible()

  // The refresh token is an httpOnly cookie: page scripts cannot read it, and nothing is in localStorage.
  expect(await page.evaluate(() => document.cookie)).not.toContain('etp_refresh')
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /token/i.test(k)))).toEqual([])
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'etp_refresh')).toMatchObject({ httpOnly: true, sameSite: 'Strict' })

  // A reload keeps the session (one refresh with the cookie).
  await page.reload()
  await expect(page.getByRole('link', { name: 'Lan' })).toBeVisible()

  await page.getByRole('link', { name: 'Lan' }).click()
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible()
  expect((await page.context().cookies()).find((c) => c.name === 'etp_refresh')).toBeUndefined()

  await signIn(page, email)
  await expect(page.getByRole('link', { name: 'Lan' })).toBeVisible()
})

test('a wrong password is refused with a message, no session', async ({ page, api }) => {
  const email = `wrong-${unique()}@e2e.test`
  await api.post('auth/register', { data: { email, password: PASSWORD, firstName: 'Minh', lastName: 'E2E' } })
  await api.post('auth/otp/verify', { data: { email, purpose: 'EMAIL_VERIFICATION', otp: await latestOtp(api, email) } })

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill('not-the-password')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})
