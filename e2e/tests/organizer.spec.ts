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

  // 2. The show (one per event), 30 days ahead, 19:00 → 21:00 Vietnam time
  await page.getByRole('combobox').first().selectOption({ label: `${venue.name} — ${venue.city}` })
  await page.getByLabel('Ngày diễn').fill(vnDate(30))
  await page.getByLabel('Giờ bắt đầu').fill('1900') // typed digits, 24-hour clock: the box shows 19:00
  await page.getByLabel('Giờ kết thúc').fill('21:00')
  await page.getByRole('button', { name: 'Lưu buổi diễn' }).click()
  await expect(page.getByText(`Địa điểm: ${venue.name} — ${venue.city}`)).toBeVisible()

  // 3. The total attendance, then the tiers: 20 seated VIP (the seats follow), 50 standing
  await page.getByLabel('Tổng số người tham dự').fill('70')
  await page.getByRole('button', { name: 'Lưu tổng' }).click()
  await expect(page.getByTestId('allocation')).toContainText('Đã xếp 0 / 70 người')

  const seatedForm = page.locator('form', { has: page.getByRole('heading', { name: 'Thêm hạng ghế ngồi' }) })
  await seatedForm.getByLabel('Mã', { exact: true }).fill('VIP')
  await seatedForm.getByLabel('Tên', { exact: true }).fill('Hạng VIP')
  await seatedForm.getByLabel('Giá (VND)').fill('1500000')
  await seatedForm.getByLabel('Số ghế').fill('20')
  await seatedForm.getByRole('button', { name: 'Thêm hạng ghế' }).click()
  await expect(page.getByRole('cell', { name: /Ghế ngồi · Khu A: hàng A–B/ })).toBeVisible()

  const standingForm = page.locator('form', { has: page.getByRole('heading', { name: 'Thêm hạng đứng' }) })
  await standingForm.getByLabel('Mã', { exact: true }).fill('GA')
  await standingForm.getByLabel('Tên', { exact: true }).fill('Vé đứng')
  await standingForm.getByLabel('Giá (VND)').fill('300000')
  await standingForm.getByLabel('Số vé đứng').fill('51')
  await expect(standingForm.getByText('Chỉ còn 50 người chưa xếp.')).toBeVisible()
  await standingForm.getByLabel('Số vé đứng').fill('50')
  await expect(standingForm.getByLabel('Khu đứng')).toHaveValue(/.+/)
  await standingForm.getByRole('button', { name: 'Thêm hạng đứng' }).click()
  await expect(page.getByTestId('allocation')).toContainText('Đã xếp 70 / 70 người')
  await expect(page.getByText('Đã xếp đủ tổng số người tham dự.').first()).toBeVisible()

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
