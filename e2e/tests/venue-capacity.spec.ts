import { at, createCategory, createOrganizer, unique } from '../support/api'
import { expect, signIn, signInAdmin, test } from '../support/fixtures'

/**
 * "Sức chứa" of a venue is the ceiling: its zones (seats + standing places)
 * and a show's total attendance (its tickets) never go above it.
 */
test('the venue capacity bounds its zones and the tickets of a show', async ({ browser, page, api, admin }) => {
  const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })
  const data = async (res: Promise<import('@playwright/test').APIResponse>) => (await (await res).json()).data
  const { venue } = await data(api.post('venues', { ...as(admin.token), data: { name: `Sân ${unique()}`, addressLine: '1 Lê Duẩn', city: 'Hà Nội', capacity: 100 } }))

  // The admin builds the zones: 80 standing fit, 30 more do not.
  await signInAdmin(page, `/admin/venues/${venue.id}`)
  await page.getByLabel('Mã khu').fill('PIT')
  await page.getByLabel('Tên khu').fill('Sàn đứng')
  await page.getByLabel('Loại').selectOption('STANDING')
  await page.getByLabel('Sức chứa', { exact: true }).last().fill('80')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await expect(page.getByTestId('venue-places')).toContainText('Các khu: 80 chỗ (0 ghế + 80 đứng) / sức chứa 100 · còn thêm được 20')

  await page.getByLabel('Mã khu').fill('PIT2')
  await page.getByLabel('Tên khu').fill('Sàn đứng 2')
  await page.getByLabel('Loại').selectOption('STANDING')
  await page.getByLabel('Sức chứa', { exact: true }).last().fill('30')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Vượt sức chứa 100 của địa điểm: các khu đã có 80 chỗ, chỉ còn thêm được 20.')

  // The organizer's show cannot be planned for more people than the venue holds.
  const organizer = await createOrganizer(api, admin)
  const category = await createCategory(api, admin)
  const { event } = await data(api.post('events', { ...as(organizer.token), data: { title: `Sức chứa ${unique()}`, categoryIds: [category.id] } }))
  await data(
    api.post(`events/${event.id}/schedules`, {
      ...as(organizer.token),
      data: { venueId: venue.id, startAt: at(30, 12).toISOString(), endAt: at(30, 14).toISOString() },
    }),
  )
  const orgPage = await (await browser.newContext()).newPage()
  await signIn(orgPage, organizer.email, undefined, `/organizer/events/${event.id}?tab=schedules`)
  // In step with the venue: the new show is planned for the venue's capacity, and says so.
  await expect(orgPage.getByLabel('Tổng số người tham dự')).toHaveValue('100')
  await expect(orgPage.getByText(/Sức chứa địa điểm: 100 \(đang đồng bộ\) · các khu: 80 chỗ \(0 ghế \+ 80 đứng\)/)).toBeVisible()
  await expect(orgPage.getByText('Các khu của địa điểm chỉ có 80 chỗ: tối đa xếp được 80 người, 20 người còn lại không có chỗ.')).toBeVisible()
  await orgPage.getByLabel('Tổng số người tham dự').fill('101')
  await expect(orgPage.getByText('Địa điểm chỉ chứa 100 người.')).toBeVisible()
  await expect(orgPage.getByRole('button', { name: 'Lưu tổng' })).toBeDisabled()
  await orgPage.getByLabel('Tổng số người tham dự').fill('80')
  await orgPage.getByRole('button', { name: 'Lưu tổng' }).click()
  await expect(orgPage.getByTestId('allocation')).toContainText('Đã xếp 0 / 80 người')
  await orgPage.getByRole('button', { name: 'Đồng bộ với sức chứa địa điểm (100)' }).click()
  await expect(orgPage.getByTestId('allocation')).toContainText('Đã xếp 0 / 100 người')
})
