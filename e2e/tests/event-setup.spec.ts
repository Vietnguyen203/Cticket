import { at, createCategory, createOrganizer, createSeatedVenue, unique } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

/** "YYYY-MM-DD" in Vietnam, N days from now. */
const vnDate = (daysFromNow: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + daysFromNow * 86_400_000))

/**
 * Organizers reported that creating an event or assigning seats "sometimes"
 * did not work: buttons were disabled without a word, and at a venue without
 * seats the seat plan simply did not show, so a "Ghế ngồi" ticket type could
 * never get seats and the event could never be submitted.
 */
test('the editor says what is missing, and a new venue is used only once it has seats', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  await signIn(page, organizer.email, undefined, '/organizer/events/new')

  await page.getByLabel('Tên sự kiện').fill(`Địa điểm mới ${unique()}`)
  await expect(page.getByText('Còn thiếu: ít nhất một danh mục.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tạo và tiếp tục' })).toBeDisabled()
  await page.getByText(category.name, { exact: true }).click()
  await page.getByRole('button', { name: 'Tạo và tiếp tục' }).click()
  await expect(page).toHaveURL(/tab=schedules/)

  // A new venue: a seated zone without seats cannot be used yet.
  await page.getByRole('combobox').first().selectOption({ label: '+ Nhập địa điểm mới…' })
  await page.getByLabel('Tên địa điểm').fill(`Sân khấu ${unique()}`)
  await page.getByLabel('Thành phố').fill('Đà Nẵng')
  await page.getByLabel('Địa chỉ').fill('1 Bạch Đằng')
  await page.getByRole('button', { name: 'Tạo địa điểm, rồi thêm khu và ghế' }).click()
  await page.getByLabel('Mã khu').fill('A')
  await page.getByLabel('Tên khu').fill('Khu A')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await expect(page.getByText('Khu này chưa có ghế nào')).toBeVisible()
  const done = page.getByRole('button', { name: 'Xong, dùng địa điểm này' })
  await expect(done).toBeDisabled()
  await expect(page.getByText(/Còn thiếu: bấm "Xong, dùng địa điểm này"/)).toBeVisible()
  await page.getByLabel('Thêm hàng ghế').fill('A-B')
  await page.getByLabel('Đến ghế số').fill('5')
  await page.getByRole('button', { name: 'Sinh ghế' }).click()
  await expect(done).toBeEnabled()
  await done.click()

  // Times are typed, 24-hour clock: a wrong one is refused at once, a missing one is named.
  await page.getByLabel('Ngày diễn').fill(vnDate(30))
  await page.getByLabel('Giờ bắt đầu').fill('25')
  await expect(page.getByText('Giờ theo 24 giờ, từ 00:00 đến 23:59 (ví dụ 19:30).')).toBeVisible()
  await expect(page.getByText(/Còn thiếu: giờ bắt đầu/)).toBeVisible()
  await page.getByLabel('Giờ bắt đầu').fill('1930')
  await page.getByLabel('Giờ bắt đầu').blur()
  await expect(page.getByLabel('Giờ bắt đầu')).toHaveValue('19:30')
  // The end is optional (3 hours later); an end before the start is after midnight.
  await page.getByLabel('Giờ kết thúc').fill('0030')
  await expect(page.getByText(/Kết thúc: 00:30 ngày .*, sau nửa đêm\./)).toBeVisible()
  await page.getByRole('button', { name: 'Lưu buổi diễn' }).click()

  // The proposed venue's 10 seats make one seated tier; no standing zone, so no standing tier (it needs a zone).
  await page.getByLabel('Tổng số người tham dự').fill('10')
  await page.getByRole('button', { name: 'Lưu tổng' }).click()
  await expect(page.getByText(/chưa có khu đứng: suất này chỉ bán được vé ghế ngồi/)).toBeVisible()
  // Its one zone gets a tier: all its 10 seats.
  const zoneA = page.getByRole('form', { name: 'Gán hạng cho Khu A' })
  await zoneA.getByLabel('Tên hạng').fill('Hạng VIP')
  await zoneA.getByLabel('Giá (VND)').fill('800000')
  await expect(zoneA.getByLabel('Giá (VND)')).toHaveValue('800.000') // "." between thousands as it is typed
  await zoneA.getByRole('button', { name: 'Gán 10 ghế' }).click()
  await expect(page.getByRole('cell', { name: /Ghế ngồi · Khu A: hàng A–B/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeEnabled()
})

test('a schedule at a venue without seats says why; the organizer adds seats to their own proposal right there', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const post = async (url: string, data: Record<string, unknown>) => {
    const res = await api.post(url, { headers: { Authorization: `Bearer ${organizer.token}` }, data })
    expect(res.ok(), `${url}: ${await res.text()}`).toBe(true)
    return (await res.json()).data
  }
  // As found in the dev data: a seated zone whose seats were never generated.
  const { venue } = await post('venues', { name: `Đề xuất ${unique()}`, addressLine: '2 Trần Phú', city: 'Huế' })
  await post(`venues/${venue.id}/zones`, { code: 'VIP', name: 'Vip', kind: 'SEATED' })
  const { event } = await post('events', { title: `Thiếu ghế ${unique()}`, categoryIds: [category.id] })
  const { schedule } = await post(`events/${event.id}/schedules`, { venueId: venue.id, startAt: at(30, 12).toISOString(), endAt: at(30, 14).toISOString() })
  await post(`schedules/${schedule.id}/ticket-types`, { code: 'VIP', name: 'Hạng VIP', price: 1_000_000, inventoryMode: 'RESERVED' })

  await signIn(page, organizer.email, undefined, `/organizer/events/${event.id}?tab=schedules`)
  // Neither seats nor a standing zone: nothing can be sold there yet.
  await expect(page.getByText(/chưa có ghế nào và chưa có khu đứng: suất này chưa bán được vé nào\./)).toBeVisible()
  await expect(page.getByText(/"Hạng VIP" là ghế ngồi nhưng địa điểm .* chưa có ghế nào/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled()

  await page.getByRole('button', { name: 'Thêm khu / ghế cho địa điểm này' }).click()
  await page.getByLabel('Thêm hàng ghế').fill('A')
  await page.getByRole('button', { name: 'Sinh ghế' }).click()

  // The show reloads: the seat plan by row is open (a seated tier waits for its seats).
  await page.getByLabel('Cả khu:').selectOption({ label: 'Hạng VIP' })
  await page.getByRole('button', { name: 'Lưu gán ghế' }).click()
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeEnabled()
})

test('an approved venue without seats: the organizer is told who can fix it', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })
  const data = async (res: Promise<import('@playwright/test').APIResponse>) => (await (await res).json()).data
  const { venue } = await data(api.post('venues', { ...as(admin.token), data: { name: `Sân ${unique()}`, addressLine: '1 Lê Duẩn', city: 'Hà Nội' } }))
  await data(api.post(`venues/${venue.id}/zones`, { ...as(admin.token), data: { code: 'VIP', name: 'Vip', kind: 'SEATED' } }))
  const { zone: pit } = await data(
    api.post(`venues/${venue.id}/zones`, { ...as(admin.token), data: { code: 'PIT', name: 'Khu đứng sân', kind: 'STANDING', capacity: 300 } }),
  )
  const { event } = await data(api.post('events', { ...as(organizer.token), data: { title: `Sân thiếu ghế ${unique()}`, categoryIds: [category.id] } }))
  await data(
    api.post(`events/${event.id}/schedules`, {
      ...as(organizer.token),
      data: { venueId: venue.id, startAt: at(30, 12).toISOString(), endAt: at(30, 14).toISOString(), capacity: 200 },
    }),
  )

  await signIn(page, organizer.email, undefined, `/organizer/events/${event.id}?tab=schedules`)
  await expect(page.getByText(/chưa có ghế nào: suất này chỉ bán được vé đứng\./)).toBeVisible()
  await expect(page.getByText(/chỉ quản trị viên thêm khu \/ ghế được/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thêm khu / ghế cho địa điểm này' })).toHaveCount(0)
  // Standing tiers are what this venue can sell, in its standing zone (a zone is required).
  // Only the standing zone has places (the seated one has no seats): it gets the tier, within the total of 200.
  await expect(page.getByRole('form', { name: 'Gán hạng cho Vip' })).toHaveCount(0)
  const pitForm = page.getByRole('form', { name: 'Gán hạng cho Khu đứng sân' })
  // The default stays within the total (200 of the zone's 300); more is refused at once.
  await expect(pitForm.getByLabel('Số vé')).toHaveValue('200')
  await pitForm.getByLabel('Số vé').fill('300')
  await expect(pitForm.getByText('Chỉ còn 200 người chưa xếp (tổng số người tham dự).')).toBeVisible()
  await pitForm.getByLabel('Tên hạng').fill('Vé đứng')
  await pitForm.getByLabel('Giá (VND)').fill('300000')
  await pitForm.getByLabel('Số vé').fill('200')
  await pitForm.getByRole('button', { name: 'Gán', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Vé đứng · Khu đứng sân' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gửi duyệt' })).toBeEnabled()
})

test('a show in the way is named: a 26-hour show entered by mistake is pointed out', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })
  const data = async (res: Promise<import('@playwright/test').APIResponse>) => (await (await res).json()).data
  const { venue } = await data(api.post('venues', { ...as(admin.token), data: { name: `Cung ${unique()}`, addressLine: '1 Lê Đức Thọ', city: 'Hà Nội' } }))
  const { event } = await data(api.post('events', { ...as(organizer.token), data: { title: `Suất dài ${unique()}`, categoryIds: [category.id] } }))
  // 22:00 → 23:55 the next day (Vietnam time), as found in the dev data.
  await data(
    api.post(`events/${event.id}/schedules`, {
      ...as(organizer.token),
      data: { venueId: venue.id, startAt: `${vnDate(30)}T22:00:00+07:00`, endAt: `${vnDate(31)}T23:55:00+07:00` },
    }),
  )

  await signIn(page, organizer.email, undefined, `/organizer/events/${event.id}?tab=schedules`)
  await expect(page.getByRole('heading', { name: 'Buổi diễn' })).toBeVisible()
  const list = page.getByRole('main')
  await expect(list.getByText(/Suất đang lưu kéo dài 25\.9 giờ/)).toBeVisible()
  // One event, one show: no second line to add.
  await expect(list.getByRole('button', { name: '+ Thêm dòng' })).toHaveCount(0)

  // The line reads 22:00 → 23:55 the same night: "Lưu" fixes the stored show.
  await expect(list.getByLabel('Giờ kết thúc')).toHaveValue('23:55')
  await list.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(list.getByText(/Suất đang lưu kéo dài/)).toHaveCount(0)
  await expect(list.getByText(/Kết thúc: 23:55 ngày/)).toBeVisible()
})

test('a seated zone larger than the total is assigned in part; "Bỏ gán" frees it; deleting the only show brings its line back', async ({ page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const { venue } = await createSeatedVenue(api, admin) // Khu A: 20 seats, Khu đứng: 100
  const as = { headers: { Authorization: `Bearer ${organizer.token}` } }
  const data = async (res: Promise<import('@playwright/test').APIResponse>) => (await (await res).json()).data
  const { event } = await data(api.post('events', { ...as, data: { title: `Một phần ${unique()}`, categoryIds: [category.id] } }))
  await data(
    api.post(`events/${event.id}/schedules`, {
      ...as,
      data: { venueId: venue.id, startAt: at(30, 12).toISOString(), endAt: at(30, 14).toISOString(), capacity: 15 },
    }),
  )

  await signIn(page, organizer.email, undefined, `/organizer/events/${event.id}?tab=schedules`)
  // 20 seats, 15 people in total: the zone line proposes 15 of its seats (front rows first).
  const zoneA = page.getByRole('form', { name: 'Gán hạng cho Khu A' })
  await expect(zoneA.getByLabel('Số ghế')).toHaveValue('15')
  await zoneA.getByLabel('Tên hạng').fill('Hạng VIP')
  await zoneA.getByLabel('Giá (VND)').fill('1000000')
  await zoneA.getByRole('button', { name: 'Gán 15 ghế' }).click()
  await expect(page.getByRole('cell', { name: /Ghế ngồi · Khu A: hàng A–B/ })).toBeVisible()
  await expect(page.getByTestId('allocation')).toContainText('Đã xếp 15 / 15 người')

  await page.getByRole('button', { name: 'Bỏ gán' }).click()
  await expect(page.getByTestId('allocation')).toContainText('Đã xếp 0 / 15 người')
  await expect(zoneA.getByLabel('Số ghế')).toHaveValue('15')

  // The only show deleted: the line to set one is there again (no reload).
  const showLine = page.locator('li', { has: page.getByLabel('Ngày diễn') })
  await showLine.getByRole('button', { name: 'Xóa', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await expect(page.getByRole('button', { name: 'Lưu buổi diễn' })).toBeVisible()
  await expect(page.getByLabel('Ngày diễn')).toHaveValue('')
})
