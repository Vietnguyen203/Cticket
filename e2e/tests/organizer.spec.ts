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

  // The venue's zones are there already: a tier for each, both confirmed with ONE button.
  // Khu A sells its 20 seats; the standing zone holds 100, but only 50 of the 70 are left after Khu A.
  const zoneA = page.getByRole('group', { name: 'Gán hạng cho Khu A' })
  await zoneA.getByLabel('Tên hạng').fill('Hạng VIP')
  await zoneA.getByLabel('Giá (VND)').fill('1500000')
  const pit = page.getByRole('group', { name: 'Gán hạng cho Khu đứng' })
  await pit.getByLabel('Tên hạng').fill('Vé đứng')
  await pit.getByLabel('Giá (VND)').fill('300000')
  await expect(pit.getByLabel('Số vé')).toHaveValue('50') // what is left after Khu A's 20
  await pit.getByLabel('Số vé').fill('51')
  await expect(page.getByText('Các khu đã nhập giá cộng lại 71 người, chỉ còn 70 người chưa xếp (tổng số người tham dự).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Xác nhận (2 khu)' })).toBeDisabled()
  await pit.getByLabel('Số vé').fill('50')
  await page.getByRole('button', { name: 'Xác nhận (2 khu)' }).click()
  await expect(page.getByRole('cell', { name: /Ghế ngồi · Khu A: hàng A–B/ })).toBeVisible()
  await expect(page.getByTestId('allocation')).toContainText('Đã xếp 70 / 70 người')
  await expect(page.getByText(/^Vé đứng · 300\.000.* · 50 vé$/)).toBeVisible()

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
