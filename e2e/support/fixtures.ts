import { test as base, expect, type APIRequestContext, type BrowserContext, type Page, type Video } from '@playwright/test'
import { API_URL, E2E_TOTP_SECRET } from '../stack.mjs'
import { loginAdmin, PASSWORD, type Account } from './api'
import { createAdminAccount } from './db'
import { totpCode } from './totp'

/**
 * `api`: requests to the E2E API (base /api/v1/); `admin`: an admin of this test, signed in (API).
 * `filmWindows` (automatic): with E2E_VIDEO=1, the windows a test opens itself
 * (browser.newContext: buyer, organizer, admin side by side) are filmed too and
 * attached to the report as "cửa sổ 1", "cửa sổ 2"… The `page` fixture is
 * filmed by the `video` option of playwright.config.ts.
 */
export const test = base.extend<{ api: APIRequestContext; admin: Account; filmWindows: void }>({
  filmWindows: [
    async ({ browser }, use, testInfo) => {
      if (!process.env.E2E_VIDEO) return use()
      const newContext = browser.newContext.bind(browser)
      const contexts: BrowserContext[] = []
      const videos: Video[] = []
      browser.newContext = async (options = {}) => {
        const context = await newContext({ ...options, recordVideo: { dir: testInfo.outputPath('videos') } })
        context.on('page', (page) => {
          const video = page.video()
          if (video) videos.push(video)
        })
        contexts.push(context)
        return context
      }
      try {
        await use()
      } finally {
        browser.newContext = newContext
        // A video is written when its window closes.
        await Promise.all(contexts.map((context) => context.close().catch(() => {})))
        for (const [index, video] of videos.entries()) {
          await testInfo.attach(`cửa sổ ${index + 1}`, { path: await video.path(), contentType: 'video/webm' })
        }
      }
    },
    { auto: true },
  ],
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

/**
 * Sign in through the login page (the real cookie + memory token flow).
 * `totpSecret`: the account uses two-factor; the code step is filled in (it sends itself at 6 digits).
 */
export async function signIn(page: Page, email: string, password = PASSWORD, next = '/', totpSecret?: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  if (totpSecret) await page.getByLabel('Mã xác thực').fill(totpCode(totpSecret))
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

/** A new admin of its own, signed in through the pages with two-factor. Never used before: its codes are free. */
export async function signInAdmin(page: Page, next = '/admin') {
  const admin = await createAdminAccount()
  await signIn(page, admin.email, admin.password, next, E2E_TOTP_SECRET)
  return admin
}
