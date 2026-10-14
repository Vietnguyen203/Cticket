import { createCategory, createOrganizer, createSeatedVenue, unique } from '../support/api'
import { expect, signIn, signInAdmin, test } from '../support/fixtures'

/** "YYYY-MM-DD" in Vietnam, N days from now. */
const vnDate = (daysFromNow: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + daysFromNow * 86_400_000))

test('organizer builds an event in the pages, submits it; the admin approves; it is on sale', async ({ browser, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const { venue } = await createSeatedVenue(api, admin)
  const title = `Hòa nhạc giao diện ${unique()}`

  const orgContext = await browser.newContext()
  const page = await orgContext.newPage()
  await signIn(page, organizer.email, undefined, '/organizer')

  // 1. Information
  await page.getByRole('link', { name: 'Tạo sự kiện' }).first().click()
  await page.getByLabel('Tên sự kiện').fill(title)
  await page.getByText(category.name, { exact: true }).click()
  await page.getByRole('button', { name: 'Tạo và tiếp tục' }).click()
  await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]{36}\?tab=schedules/)
  const eventId = new URL(page.url()).pathname.split('/').at(-1)!

  // 2. A schedule, 30 days ahead, 19:00 → 21:00 Vietnam time
  await page.getByRole('combobox').first().selectOption({ label: `${venue.name} — ${venue.city}` })
  for (const [label, hour] of [['Bắt đầu (giờ VN)', '19'], ['Kết thúc (giờ VN)', '21']] as const) {
    await page.getByLabel(`${label}: ngày`).fill(vnDate(30))
    await page.getByLabel(`${label}: giờ`).selectOption(hour)
    await page.getByLabel(`${label}: phút`).selectOption('00')
  }
  await page.getByRole('button', { name: 'Thêm suất' }).click()
  await expect(page.getByRole('heading', { name: 'Thêm hạng vé' })).toBeVisible()

  // 3. Ticket types: seated VIP, 50 standing
  await page.getByLabel('Mã', { exact: true }).fill('VIP')
  await page.getByLabel('Tên', { exact: true }).fill('Hạng VIP')
  await page.getByLabel('Giá (VND)').fill('1500000')
  await page.getByRole('button', { name: 'Thêm hạng vé' }).click()
  await expect(page.getByRole('cell', { name: 'Hạng VIP' }).first()).toBeVisible()

  await page.getByLabel('Mã', { exact: true }).fill('GA')
  await page.getByLabel('Tên', { exact: true }).fill('Vé đứng')
  await page.getByLabel('Giá (VND)').fill('300000')
  await page.getByLabel('Loại').selectOption('GENERAL_ADMISSION')
  await page.getByLabel('Số vé').fill('50')
  await page.getByLabel('Khu đứng').selectOption({ label: 'Khu đứng (100 chỗ)' })
  await page.getByRole('button', { name: 'Thêm hạng vé' }).click()
  await expect(page.getByRole('cell', { name: 'Vé đứng' }).first()).toBeVisible()

  // 4. Seat plan: the whole seated zone sells as VIP
  await page.getByLabel('Cả khu:').selectOption({ label: 'Hạng VIP' })
  await page.getByRole('button', { name: 'Lưu gán ghế' }).click()

  // 5. Submit
  const submit = page.getByRole('button', { name: 'Gửi duyệt' })
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Gửi duyệt' }).click()
  await expect(page.getByText('Đã gửi duyệt.')).toBeVisible()
  await expect(page.getByText('Chờ duyệt').first()).toBeVisible()
  await orgContext.close()

  // 6. The admin approves
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await signInAdmin(adminPage, `/admin/events/${eventId}`)
  await adminPage.getByRole('button', { name: 'Duyệt và mở bán' }).click()
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Duyệt và mở bán' }).click()
  await expect(adminPage.getByText('Đang bán').first()).toBeVisible()
  await adminContext.close()

  // 7. Anyone finds it and can pick seats
  const visitor = await browser.newPage()
  await visitor.goto(`/events?q=${encodeURIComponent(title)}`)
  await visitor.getByRole('link', { name: new RegExp(title) }).first().click()
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible()
  await visitor.getByRole('link', { name: 'Chọn chỗ' }).first().click()
  await expect(visitor.getByRole('button', { name: /^Ghế A01, Hạng VIP, còn trống/ })).toBeVisible()
  await visitor.close()
})
