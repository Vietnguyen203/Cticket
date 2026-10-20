import { test as setup, expect } from '@playwright/test'

/**
 * Bug review follow-up: runs once before the specs (project "warmup"). The
 * Vite dev server compiles the app on its first visit (and may reload the
 * page once while it prepares dependencies); without this, the first spec of
 * a fresh run can spend most of its 10-second waits on that and fail.
 */
setup('warm up the web app', async ({ page }) => {
  setup.setTimeout(120_000)
  for (const path of ['/', '/events', '/login']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 })
})
