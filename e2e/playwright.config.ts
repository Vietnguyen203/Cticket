import { defineConfig, devices } from '@playwright/test'
import { API_URL, FRONTEND_DIR, WEB_PORT, WEB_URL } from './stack.mjs'

/**
 * E2E tests of the web app. `npm test` starts a fresh API (own database,
 * Redis db, mail to Mailpit) and the Vite dev server, runs the specs, stops
 * both. Docker must be running postgres, redis and mailpit.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.mobile\.spec\.ts$/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /\.mobile\.spec\.ts$/ },
  ],
  webServer: [
    {
      command: 'node start-api.mjs',
      url: `${API_URL}/health/live`,
      timeout: 120_000,
      reuseExistingServer: false,
      // API logs (warnings for every refused request) would drown the test output; errors still show.
      // E2E_API_LOGS=1 shows them (with E2E_API_LOG_LEVEL=warn|info).
      stdout: process.env.E2E_API_LOGS ? 'pipe' : 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npm --prefix "${FRONTEND_DIR}" run dev -- --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: API_URL },
    },
  ],
})
