import { createOrganizer, createPublishedEvent } from '../support/api'
import { expect, signIn, test } from '../support/fixtures'

/**
 * "Nghệ sĩ khách mời": the organizer lists who takes part (names only: an
 * event has many programmes and acts); buyers see them on the event page.
 */
test('the organizer lists the guest artists; the event page shows them', async ({ browser, page, api, admin }) => {
  const organizer = await createOrganizer(api, admin)
  const world = await createPublishedEvent(api, { admin, organizer })

  await signIn(page, organizer.email, undefined, `/organizer/events/${world.event.id}?tab=schedules`)
  const card = page.locator('form', { has: page.getByRole('heading', { name: 'Nghệ sĩ khách mời' }) })

  await card.getByLabel('Nghệ sĩ 1', { exact: true }).fill('Hà Anh Tuấn')
  await card.getByRole('button', { name: '+ Thêm nghệ sĩ' }).click()
  await card.getByLabel('Nghệ sĩ 2', { exact: true }).fill('Phương Linh')
  await card.getByRole('button', { name: '+ Thêm nghệ sĩ' }).click()
  await card.getByLabel('Nghệ sĩ 3', { exact: true }).fill('Ban nhạc khách mời')
  await card.getByRole('button', { name: 'Xóa nghệ sĩ 3' }).click()
  await expect(card.getByText('Có thay đổi chưa lưu.')).toBeVisible()
  await card.getByRole('button', { name: 'Lưu danh sách nghệ sĩ' }).click()
  await expect(card.getByText('Đã lưu danh sách nghệ sĩ.')).toBeVisible()

  // A buyer (signed out) sees them on the event page.
  const visitor = await browser.newPage()
  await visitor.goto(`/events/${world.event.slug}`)
  const artists = visitor.getByRole('list', { name: 'Nghệ sĩ khách mời' }).getByRole('listitem')
  await expect(artists).toHaveText(['Hà Anh Tuấn', 'Phương Linh'])
  await visitor.close()
})
