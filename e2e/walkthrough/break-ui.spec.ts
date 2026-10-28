import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'
import { buy, createCategory, createCustomer, createOrganizer, createPublishedEvent, type Account } from '../support/api'
import { test } from '../support/fixtures'

/**
 * break-ui (.claude/skills/break-ui): the cards, the home carousel and the
 * event poster with demo data and with the realistic worst case, entered
 * through the API (the same boundary as real data). Dev-only: never part of
 * npm test. Screenshots in walkthrough-results/break-ui/.
 */
const OUT = path.resolve('walkthrough-results', 'break-ui')

// Within the API's limits (events.schemas.js, venues.schemas.js, inventory.schemas.js).
const WORST = {
  title:
    'Đêm nhạc Trịnh Công Sơn – Những Bài Ca Không Năm Tháng: Hòa nhạc giao hưởng kỷ niệm 85 năm ngày sinh cùng Dàn nhạc Giao hưởng Mặt Trời và các nghệ sĩ khách mời (Suất diễn đặc biệt)',
  category: 'Hòa nhạc giao hưởng & Nhạc cổ điển thính phòng',
  venue: 'Nhà hát Thành phố Hồ Chí Minh (Nhà hát Lớn Sài Gòn) – Khán phòng chính',
  address: '07 Công Trường Lam Sơn, Phường Bến Nghé, Quận 1 (lối vào khán giả cửa số 3, đường Đồng Khởi)',
  city: 'Thành phố Hồ Chí Minh',
  lineup: [
    'Dàn nhạc Giao hưởng Mặt Trời (Sun Symphony Orchestra) cùng Hợp xướng Thiếu nhi Sài Gòn',
    'Jo',
    'Đặng Thị Ngọc Hân',
    '王菲',
    '🎸 Ban nhạc Ngũ Cung',
    'Christopher Alexander Montgomery III',
    'J',
    'Hà Anh Tuấn',
    'Nguyễn Trần Trung Quân',
    'Mỹ Tâm',
    'Ólafur Arnalds',
    'Nhạc trưởng Lê Phi Phi',
  ],
  price: 1_000_000_000_000, // MAX_PRICE
}

async function worstEvent(api: APIRequestContext, admin: Account, organizer: Account) {
  const asAdmin = { headers: { Authorization: `Bearer ${admin.token}` } }
  const asOrg = { headers: { Authorization: `Bearer ${organizer.token}` } }
  const ok = async (p: Promise<{ ok(): boolean; json(): Promise<any>; text(): Promise<string> }>) => {
    const res = await p
    if (!res.ok()) throw new Error(await res.text())
    return (await res.json()).data
  }
  const { category } = await ok(api.post('categories', { ...asAdmin, data: { name: `${WORST.category} ${Date.now() % 1000}` } }))
  const { venue } = await ok(api.post('venues', { ...asAdmin, data: { name: WORST.venue, addressLine: WORST.address, city: WORST.city, capacity: 500 } }))
  const { zone } = await ok(api.post(`venues/${venue.id}/zones`, { ...asAdmin, data: { code: 'PIT', name: 'Khu đứng', kind: 'STANDING', capacity: 100 } }))
  const { event } = await ok(api.post('events', { ...asOrg, data: { title: WORST.title, categoryIds: [category.id], ageRestriction: 18 } }))
  const start = new Date(Date.now() + 20 * 86_400_000)
  const { schedule } = await ok(
    api.post(`events/${event.id}/schedules`, {
      ...asOrg,
      data: { venueId: venue.id, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3 * 3_600_000).toISOString() },
    }),
  )
  await ok(
    api.post(`schedules/${schedule.id}/ticket-types`, {
      ...asOrg,
      data: { code: 'VVIP', name: 'Hạng Kim Cương (gặp gỡ nghệ sĩ)', price: WORST.price, inventoryMode: 'GENERAL_ADMISSION', capacity: 100, venueZoneId: zone.id },
    }),
  )
  await ok(api.patch(`events/${event.id}`, { ...asOrg, data: { lineup: WORST.lineup.map((artist) => ({ artist })) } }))
  await ok(api.patch(`events/${event.id}/status`, { ...asOrg, data: { status: 'PENDING_APPROVAL' } }))
  return (await ok(api.patch(`events/${event.id}/status`, { ...asAdmin, data: { status: 'PUBLISHED' } }))).event
}

/** Standing only, `capacity` places: 1 left (almost gone), or 0 after a purchase (sold out). */
async function smallEvent(api: APIRequestContext, admin: Account, organizer: Account, title: string, capacity: number) {
  const asAdmin = { headers: { Authorization: `Bearer ${admin.token}` } }
  const asOrg = { headers: { Authorization: `Bearer ${organizer.token}` } }
  const ok = async (p: Promise<{ ok(): boolean; json(): Promise<any>; text(): Promise<string> }>) => {
    const res = await p
    if (!res.ok()) throw new Error(await res.text())
    return (await res.json()).data
  }
  const category = await createCategory(api, admin)
  const { venue } = await ok(api.post('venues', { ...asAdmin, data: { name: `Sân khấu ${title}`, addressLine: '1 Lê Lợi', city: 'Đà Lạt', capacity: 50 } }))
  const { zone } = await ok(api.post(`venues/${venue.id}/zones`, { ...asAdmin, data: { code: 'PIT', name: 'Khu đứng', kind: 'STANDING', capacity } }))
  const { event } = await ok(api.post('events', { ...asOrg, data: { title, categoryIds: [category.id] } }))
  const start = new Date(Date.now() + 10 * 86_400_000)
  const { schedule } = await ok(
    api.post(`events/${event.id}/schedules`, {
      ...asOrg,
      data: { venueId: venue.id, startAt: start.toISOString(), endAt: new Date(start.getTime() + 2 * 3_600_000).toISOString() },
    }),
  )
  const { ticketType } = await ok(
    api.post(`schedules/${schedule.id}/ticket-types`, {
      ...asOrg,
      data: { code: 'GA', name: 'Vé đứng', price: 150_000, inventoryMode: 'GENERAL_ADMISSION', capacity, venueZoneId: zone.id },
    }),
  )
  await ok(api.patch(`events/${event.id}/status`, { ...asOrg, data: { status: 'PENDING_APPROVAL' } }))
  await ok(api.patch(`events/${event.id}/status`, { ...asAdmin, data: { status: 'PUBLISHED' } }))
  return { event, schedule, ticketType }
}

test('break-ui: demo vs worst case', async ({ browser, api, admin }) => {
  test.setTimeout(8 * 60_000)
  mkdirSync(OUT, { recursive: true })
  const organizer = await createOrganizer(api, admin)
  const demo = await createPublishedEvent(api, { admin, organizer })
  const worst = await worstEvent(api, admin, organizer)
  await smallEvent(api, admin, organizer, 'Acoustic còn 1 vé', 1)
  const gone = await smallEvent(api, admin, organizer, 'Acoustic đã hết vé', 1)
  await buy(api, await createCustomer(api), gone.schedule.id, { items: [{ ticketTypeId: gone.ticketType.id, quantity: 1 }] })

  const shoot = async (page: Page, name: string) => {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(900)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 0) console.log(`OVERFLOW ${name}: +${over}px`)
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  }
  const views: Array<[string, { width: number; height: number }, number, 'light' | 'dark']> = [
    ['320', { width: 320, height: 720 }, 1, 'light'],
    ['1280', { width: 1280, height: 900 }, 1, 'light'],
    ['1280-dark', { width: 1280, height: 900 }, 1, 'dark'],
    ['zoom200', { width: 640, height: 450 }, 2, 'light'], // a 1280px window at 200 % zoom
  ]
  for (const [tag, viewport, deviceScaleFactor, colorScheme] of views) {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor, colorScheme })).newPage()
    await page.goto(`/events?q=${encodeURIComponent('Trịnh Công Sơn')}`)
    await shoot(page, `cards-worst-${tag}`)
    await page.goto(`/events?q=${encodeURIComponent('Acoustic')}`)
    await shoot(page, `cards-stock-${tag}`)
    // Category and stock badges of a card never overlap.
    for (const card of await page.locator('main a[href^="/events/"]').all()) {
      const badges = await card.locator('div.absolute.inset-x-3 > span').all()
      if (badges.length === 2) {
        const [a, b] = [await badges[0].boundingBox(), await badges[1].boundingBox()]
        console.log(`CHECK ${tag} card badges: ${a!.x + a!.width <= b!.x ? 'apart' : 'OVERLAP'}`)
      }
    }
    await page.goto(`/events?q=${encodeURIComponent(demo.title)}`)
    await shoot(page, `cards-demo-${tag}`)
    await page.goto(`/events/${worst.slug}`)
    await shoot(page, `poster-worst-${tag}`)
    // The phone's buy bar (below lg): the whole price is shown, the button can be reached.
    if (viewport.width < 1024) {
      const price = page.locator('.safe-bottom p.font-bold')
      const cut = await price.evaluate((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > window.innerWidth)
      const button = await page.locator('.safe-bottom').getByRole('link', { name: 'Chọn suất diễn' }).boundingBox()
      console.log(`CHECK ${tag} buy bar price "${(await price.textContent())?.trim()}" ${cut ? 'CUT' : 'whole'}, button ${Math.round(button!.width)}x${Math.round(button!.height)} inside viewport: ${button!.x >= 0 && button!.x + button!.width <= viewport.width ? 'ok' : 'OUT'}`)
    }
    await page.goto(`/events/${demo.event.slug}`)
    await shoot(page, `poster-demo-${tag}`)
    await page.goto('/')
    // The carousel: bring the worst event's slide forward.
    await page.getByRole('button', { name: /^Sự kiện \d+: Đêm nhạc Trịnh Công Sơn/ }).click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(OUT, `carousel-worst-${tag}.png`) })
    // Measured, not only seen: the slide's title starts below the header and is not cut by the band.
    const titleBox = await page.locator('[aria-roledescription="slide"]:not([aria-hidden="true"]) h2').boundingBox()
    const bandBox = await page.locator('[aria-roledescription="carousel"]').boundingBox()
    // Inside the band (whose top is just under the header in the page; the page may have scrolled).
    const inside = titleBox!.y >= bandBox!.y && titleBox!.y + titleBox!.height <= bandBox!.y + bandBox!.height
    console.log(`CHECK ${tag} carousel title ${Math.round(titleBox!.y - bandBox!.y)}px below the band top, ${Math.round(titleBox!.height)}px tall, inside the band: ${inside ? 'ok' : 'CUT'}`)
    await shoot(page, `home-${tag}`)
    // "Theo thành phố": every city name readable (wrapped, never cut to one line) and its full name in title.
    for (const city of await page.locator('span[title].line-clamp-2').all()) {
      const clipped = await city.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
      console.log(`CHECK ${tag} city "${await city.getAttribute('title')}" ${clipped ? 'CLAMPED' : 'whole'}`)
    }
    await page.close()
  }
})
