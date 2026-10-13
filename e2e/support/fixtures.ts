import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_URL } from '../stack.mjs'
import { loginAdmin, PASSWORD, type Account } from './api'

/** `api`: requests to the E2E API (base /api/v1/); `admin`: the seeded admin, signed in. */
export const test = base.extend<{ api: APIRequestContext; admin: Account }>({
  api: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: `${API_URL}/api/v1/` })
    await use(api)
    await api.dispose()
  },
  admin: async ({ api }, use) => {
    await use(await loginAdmin(api))
  },
})

export { expect }

/** Sign in through the login page (the real cookie + memory token flow). */
export async function signIn(page: Page, email: string, password = PASSWORD, next = '/') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}
