import { devices, type Browser, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MAILPIT_URL } from '../stack.mjs'
import { latestOtp, login, PASSWORD, qrTokenOf, unique } from '../support/api'
import { expect, signIn, signInAdmin, test } from '../support/fixtures'

/**
 * The ★ steps of docs/ui-test-guide.md, through the pages, on the E2E stack
 * (its own database, email in Mailpit, an admin with a known TOTP secret).
 * Every step: a screenshot and Đạt / Lỗi in walkthrough-results/report.md; a
 * failed step does not stop the run. Not a replacement for the manual pass
 * (real Gmail, an authenticator app, a phone camera): it catches what the
 * pages themselves get wrong. Run: npm run walkthrough.
 */

const OUT = path.resolve('walkthrough-results')
const u = unique()
const vnDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ms))
const vnTime = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
const DAY = 86_400_000

type Result = { id: string; title: string; ok: boolean; note?: string }
const results: Result[] = []

/** `shot`: the page to photograph afterwards (a function: some pages only exist once the step has run). */
// WALK_UNTIL=3.4 stops after that step (to look at one part without the whole run).
let stopped = false

/** The first line of a Playwright error and what it was waiting for, without colours. */
function describe(err: unknown) {
  const lines = (err instanceof Error ? err.message : String(err)).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim())
  const what = lines.find((l) => /^(Locator:|- waiting for|waiting for|Expected|Received)/.test(l))
  return [lines.find(Boolean) ?? 'lỗi', what].filter(Boolean).join(' — ')
}

async function step(id: string, title: string, shot: () => Page | undefined, run: () => Promise<void>) {
  if (stopped) return
  let ok = true
  let note: string | undefined
  try {
    await run()
  } catch (err) {
    ok = false
    note = describe(err)
  }
  if (process.env.WALK_UNTIL === id) stopped = true
  results.push({ id, title, ok, note })
  await shot()?.screenshot({ path: path.join(OUT, `${id.replace(/\s/g, '')}.png`) }).catch(() => undefined)
}

function writeReport() {
  const passed = results.filter((r) => r.ok).length
  const lines = [
    '# Chạy tự động các bước ★ (docs/ui-test-guide.md)',
    '',
    `Môi trường E2E (database riêng, email về Mailpit). ${passed} / ${results.length} bước đạt.`,
    '',
    '| Bước | Nội dung | KQ | Ghi chú | Ảnh |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.title} | ${r.ok ? 'Đạt' : '**Lỗi**'} | ${(r.note ?? '').replace(/\|/g, '/')} | ${r.id.replace(/\s/g, '')}.png |`),
  ]
  writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'))
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2))
}

async function register(browser: Browser, firstName: string, email: string, api: Parameters<typeof latestOtp>[0], mobile = false) {
  const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : {})
  const page = await context.newPage()
  await page.goto('/register')
  await page.getByLabel('Họ').fill('Thử')
  await page.getByLabel('Tên').fill(firstName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Nhập lại mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
  await page.getByLabel('Mã xác minh').fill(await latestOtp(api, email))
  await page.getByRole('button', { name: 'Xác minh' }).click()
  // Signed in once the app has left the code page and the header shows the account's links.
  // (On a phone those links sit behind "Menu": there the account's own page answering is the sign.)
  await expect(page).not.toHaveURL(/\/verify-email/)
  if (mobile) {
    await page.goto('/tickets')
    await expect(page.getByRole('heading', { name: 'Vé của tôi' })).toBeVisible()
  } else {
    await expect(page.getByRole('banner').getByRole('link', { name: 'Vé của tôi' })).toBeVisible()
  }
  return page
}

test('the ★ steps of the UI test guide', async ({ browser, api }) => {
  test.setTimeout(25 * 60_000)
  mkdirSync(OUT, { recursive: true })
  const mail = (who: string) => `${who}-${u}@e2e.test`
  const [emailA, emailB, emailBtc, emailStaff] = ['khacha', 'khachb', 'btc', 'soatve'].map(mail)
  const category = `Hòa nhạc test ${u}`
  const venueName = `Nhà hát Test ${u}`
  const title1 = `Đêm nhạc Test ${u}`
  const title2 = `Đêm soát vé ${u}`
  const promo = `T10${u.slice(0, 5).toUpperCase()}`
  let pageA!: Page
  let pageB!: Page
  let pageBtc!: Page
  let pageStaff!: Page
  const adminPage = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()
  let event1Id = ''
  let event2Id = ''
  let slug1 = ''
  let slug2 = ''
  let map1 = ''
  let order1 = ''
  let order2 = ''
  let order3 = ''

  try {
    // --- Phiên 1: tài khoản
    await step('1.1-1.2', 'Khách A đăng ký, nhận mã (Mailpit), xác minh, đã đăng nhập', () => pageA, async () => {
      pageA = await register(browser, 'An', emailA, api)
      await expect(pageA.getByRole('banner').getByRole('link', { name: 'Vé của tôi' })).toBeVisible()
    })
    await step('1.5', 'Sai mật khẩu và email không tồn tại: cùng một thông báo', () => guest, async () => {
      const tryLogin = async (email: string) => {
        await guest.goto('/login')
        await guest.getByLabel('Email').fill(email)
        await guest.getByLabel('Mật khẩu', { exact: true }).fill('sai-mat-khau-1')
        await guest.getByRole('button', { name: 'Đăng nhập' }).click()
        await expect(guest.getByRole('alert')).toBeVisible()
        await expect(guest).toHaveURL(/\/login/)
        return guest.getByRole('alert').innerText()
      }
      expect(await tryLogin(emailA)).toBe(await tryLogin(`khong-co-${u}@e2e.test`))
    })
    await step('1.11', 'Khách B đăng ký và đăng nhập', () => pageB, async () => {
      pageB = await register(browser, 'Bình', emailB, api)
    })

    // --- Phiên 2: quản trị chuẩn bị
    await signInAdmin(adminPage, '/admin/categories')
    await step('2.1', 'Tạo danh mục', () => adminPage, async () => {
      await adminPage.getByLabel('Tên danh mục mới').fill(category)
      await adminPage.getByRole('button', { name: 'Thêm', exact: true }).click()
      await expect(adminPage.getByRole('cell', { name: category })).toBeVisible()
    })
    await step('2.2', 'Tạo địa điểm sức chứa 150', () => adminPage, async () => {
      await adminPage.goto('/admin/venues')
      await adminPage.getByRole('button', { name: 'Thêm địa điểm' }).click()
      await adminPage.getByLabel('Tên địa điểm').fill(venueName)
      await adminPage.getByLabel('Địa chỉ').fill('1 Lê Lợi')
      await adminPage.getByLabel('Thành phố').fill('TP. Hồ Chí Minh')
      await adminPage.getByLabel('Sức chứa (không bắt buộc)').fill('150')
      await adminPage.getByRole('button', { name: 'Tạo và thêm khu / ghế' }).click()
      await expect(adminPage.getByTestId('venue-places')).toContainText('sức chứa 150')
    })
    await step('2.3', 'Khu A: 5 hàng × 10 ghế', () => adminPage, async () => {
      await adminPage.getByLabel('Mã khu').fill('A')
      await adminPage.getByLabel('Tên khu').fill('Khu A')
      await adminPage.getByRole('button', { name: 'Thêm', exact: true }).click()
      await adminPage.getByLabel('Thêm hàng ghế').fill('A-E')
      await adminPage.getByLabel('Từ ghế số').fill('1')
      await adminPage.getByLabel('Đến ghế số').fill('10')
      await adminPage.getByRole('button', { name: 'Sinh ghế' }).click()
      await expect(adminPage.getByText('Khu ngồi · 50 ghế')).toBeVisible()
    })
    await step('2.4', 'Khu đứng 100 chỗ; thêm 10 chỗ nữa bị từ chối (vượt sức chứa)', () => adminPage, async () => {
      const addStanding = async (code: string, name: string, capacity: string) => {
        await adminPage.getByLabel('Mã khu').fill(code)
        await adminPage.getByLabel('Tên khu').fill(name)
        await adminPage.getByLabel('Loại').selectOption('STANDING')
        await adminPage.getByLabel('Sức chứa', { exact: true }).last().fill(capacity)
        await adminPage.getByRole('button', { name: 'Thêm', exact: true }).click()
      }
      await addStanding('GA', 'Khu đứng', '100')
      await expect(adminPage.getByTestId('venue-places')).toContainText('150 chỗ (50 ghế + 100 đứng) / sức chứa 150')
      await addStanding('GA2', 'Khu đứng 2', '10')
      await expect(adminPage.getByRole('alert')).toContainText('Vượt sức chứa 150 của địa điểm')
    })
    await step('2.5', 'Tạo mã giảm giá 10%', () => adminPage, async () => {
      await adminPage.goto('/admin/promotions')
      await adminPage.getByRole('button', { name: 'Tạo mã', exact: true }).click()
      await adminPage.getByLabel('Mã (khách nhập)').fill(promo)
      await adminPage.getByLabel('Tên', { exact: true }).fill('Giảm 10% thử')
      await adminPage.getByLabel('Giảm (%)').fill('10')
      await adminPage.getByLabel('Bắt đầu (giờ VN): ngày').fill(vnDate(Date.now()))
      await adminPage.getByLabel('Bắt đầu (giờ VN): giờ').fill('00:00')
      await adminPage.getByLabel('Hết hạn (giờ VN): ngày').fill(vnDate(Date.now() + 60 * DAY))
      await adminPage.getByLabel('Hết hạn (giờ VN): giờ').fill('23:00')
      await adminPage.getByRole('button', { name: 'Tạo mã', exact: true }).click()
      await expect(adminPage.getByRole('cell', { name: promo })).toBeVisible()
    })

    // --- Phiên 3: ban tổ chức
    await step('3.1', 'Đăng ký ban tổ chức', () => pageBtc, async () => {
      pageBtc = await register(browser, 'Tổ chức', emailBtc, api)
      await pageBtc.goto('/organizer/apply')
      await pageBtc.getByLabel('Tên tổ chức / công ty').fill(`Công ty Thử ${u}`)
      await pageBtc.getByRole('button', { name: 'Gửi đăng ký' }).click()
      await expect(pageBtc.getByText('Đơn đã gửi, đang chờ quản trị viên duyệt.')).toBeVisible()
    })
    await step('3.2', 'Admin duyệt nhà tổ chức', () => adminPage, async () => {
      await adminPage.goto('/admin/organizers')
      const row = adminPage.getByRole('row').filter({ hasText: `Công ty Thử ${u}` })
      await row.getByRole('button', { name: 'Duyệt' }).click()
      await adminPage.getByRole('dialog').getByRole('button', { name: 'Duyệt' }).click()
      await expect(adminPage.getByText(`Đã cập nhật Công ty Thử ${u}.`)).toBeVisible()
    })
    await step('3.3', 'Ban tổ chức cập nhật quyền', () => pageBtc, async () => {
      await pageBtc.reload()
      await expect(pageBtc.getByText('Đã được duyệt: bạn có thể tạo sự kiện.')).toBeVisible()
      // The reload itself may already bring the new role (a refresh re-reads roles): no button then.
      const refresh = pageBtc.getByRole('button', { name: 'Cập nhật quyền ngay' })
      if (await refresh.isVisible()) await refresh.click()
      await expect(pageBtc.getByRole('link', { name: 'Vào trang ban tổ chức' })).toBeVisible()
    })
    const createEvent = async (title: string, standard: boolean) => {
      await pageBtc.goto('/organizer/events/new')
      await pageBtc.getByLabel('Tên sự kiện').fill(title)
      await pageBtc.getByLabel('Mô tả').fill('Mô tả sự kiện thử.')
      await pageBtc.getByText(category, { exact: true }).click()
      if (standard) await pageBtc.getByLabel('Chính sách hủy đơn của khách').selectOption('STANDARD')
      await pageBtc.getByRole('button', { name: 'Tạo và tiếp tục' }).click()
      await expect(pageBtc).toHaveURL(/tab=schedules/)
      return new URL(pageBtc.url()).pathname.split('/').at(-1)!
    }
    const saveShow = async (date: string, start: string, end: string) => {
      await pageBtc.getByRole('combobox').first().selectOption({ label: `${venueName} — TP. Hồ Chí Minh` })
      await pageBtc.getByLabel('Ngày diễn').fill(date)
      await pageBtc.getByLabel('Giờ bắt đầu').fill(start)
      if (end) await pageBtc.getByLabel('Giờ kết thúc').fill(end)
      await pageBtc.getByRole('button', { name: 'Lưu buổi diễn' }).click()
      await expect(pageBtc.getByText(`Địa điểm: ${venueName}`)).toBeVisible()
    }
    const submitAndApprove = async (eventId: string) => {
      await pageBtc.getByRole('button', { name: 'Gửi duyệt' }).click()
      await pageBtc.getByRole('dialog').getByRole('button', { name: 'Gửi duyệt' }).click()
      await expect(pageBtc.getByText('Đã gửi duyệt.')).toBeVisible()
      await adminPage.goto(`/admin/events/${eventId}`)
      await adminPage.getByRole('button', { name: 'Duyệt và mở bán' }).click()
      await adminPage.getByRole('dialog').getByRole('button', { name: 'Duyệt và mở bán' }).click()
      await expect(adminPage.getByText('Đang bán').first()).toBeVisible()
    }
    await step('3.4', 'Tạo sự kiện 1 (chính sách Tiêu chuẩn)', () => pageBtc, async () => {
      event1Id = await createEvent(title1, true)
    })
    await step('3.8', 'Buổi diễn 30 ngày sau, 19:00 → 21:00 (gõ 1900)', () => pageBtc, async () => {
      await saveShow(vnDate(Date.now() + 30 * DAY), '1900', '21:00')
    })
    await step('3.9', 'Tổng người tham dự: điền sẵn 150, lưu 100', () => pageBtc, async () => {
      await expect(pageBtc.getByLabel('Tổng số người tham dự')).toHaveValue('150')
      await pageBtc.getByLabel('Tổng số người tham dự').fill('100')
      await pageBtc.getByRole('button', { name: 'Lưu tổng' }).click()
      await expect(pageBtc.getByTestId('allocation')).toContainText('Đã xếp 0 / 100 người')
    })
    await step('3.10', 'Gán VIP cho Khu A (50 ghế)', () => pageBtc, async () => {
      const zone = pageBtc.getByRole('form', { name: 'Gán hạng cho Khu A' })
      await zone.getByLabel('Tên hạng').fill('VIP')
      await zone.getByLabel('Giá (VND)').fill('1500000')
      await zone.getByRole('button', { name: 'Gán 50 ghế' }).click()
      await expect(pageBtc.getByRole('cell', { name: /Khu A: hàng A–E/ })).toBeVisible()
    })
    await step('3.11', 'Gán Vé đứng cho Khu đứng: mặc định 50, 100 bị báo, gán 50', () => pageBtc, async () => {
      const zone = pageBtc.getByRole('form', { name: 'Gán hạng cho Khu đứng' })
      await zone.getByLabel('Tên hạng').fill('Vé đứng')
      await zone.getByLabel('Giá (VND)').fill('300000')
      await expect(zone.getByLabel('Số vé')).toHaveValue('50')
      await zone.getByLabel('Số vé').fill('100')
      await expect(zone.getByText(/Chỉ còn 50 người chưa xếp|Khu còn/)).toBeVisible()
      await zone.getByLabel('Số vé').fill('50')
      await zone.getByRole('button', { name: 'Gán', exact: true }).click()
      await expect(pageBtc.getByTestId('allocation')).toContainText('Đã xếp 100 / 100 người')
    })
    await step('3.12', 'Gửi duyệt, admin duyệt và mở bán', () => pageBtc, async () => {
      await submitAndApprove(event1Id)
    })
    await step('3.13-3.14', 'Sự kiện 2: buổi diễn 2 giờ nữa, tổng 2, gán 2 vé đứng', () => pageBtc, async () => {
      event2Id = await createEvent(title2, false)
      const at = Date.now() + 2 * 3_600_000
      await saveShow(vnDate(at), vnTime(at), '')
      await pageBtc.getByLabel('Tổng số người tham dự').fill('2')
      await pageBtc.getByRole('button', { name: 'Lưu tổng' }).click()
      const zone = pageBtc.getByRole('form', { name: 'Gán hạng cho Khu đứng' })
      await zone.getByLabel('Tên hạng').fill('Vé đứng')
      await zone.getByLabel('Giá (VND)').fill('200000')
      await expect(zone.getByLabel('Số vé')).toHaveValue('2')
      await zone.getByRole('button', { name: 'Gán', exact: true }).click()
      await expect(pageBtc.getByTestId('allocation')).toContainText('Đã xếp 2 / 2 người')
    })
    await step('3.15', 'Sự kiện 2: gửi duyệt, admin duyệt', () => pageBtc, async () => {
      await submitAndApprove(event2Id)
    })

    // --- Phiên 4: tìm và xem
    await step('4.1', 'Trang chủ có sự kiện 1', () => pageA, async () => {
      await pageA.goto('/')
      await expect(pageA.getByText(title1).first()).toBeVisible()
    })
    await step('4.2', 'Tìm theo tên', () => pageA, async () => {
      await pageA.getByRole('main').getByLabel('Tìm sự kiện').fill(title1)
      await pageA.getByRole('main').getByRole('button', { name: 'Tìm' }).click()
      await expect(pageA).toHaveURL(/\/events\?q=/)
      await expect(pageA.getByRole('link', { name: new RegExp(title1) })).toHaveCount(1)
    })
    await step('4.5', 'Chi tiết sự kiện: giá từ 300.000, chính sách Tiêu chuẩn', () => pageA, async () => {
      await pageA.getByRole('link', { name: new RegExp(title1) }).first().click()
      await expect(pageA.getByRole('heading', { name: title1 })).toBeVisible()
      slug1 = new URL(pageA.url()).pathname.split('/').at(-1)!
      await expect(pageA.getByText('Giá vé từ', { exact: true }).first().locator('..')).toContainText('300.000')
      await expect(pageA.getByText('Chính sách hủy: Tiêu chuẩn')).toBeVisible()
    })

    // --- Phiên 5: mua vé
    const seat = (code: string) => new RegExp(`^Ghế ${code},`)
    await step('5.1', 'A và B mở sơ đồ ghế, "Cập nhật trực tiếp"', () => pageA, async () => {
      await pageA.getByRole('link', { name: 'Chọn chỗ' }).first().click()
      await expect(pageA.getByText('Cập nhật trực tiếp')).toBeVisible()
      map1 = new URL(pageA.url()).pathname
      await pageB.goto(map1)
      await expect(pageB.getByText('Cập nhật trực tiếp')).toBeVisible()
    })
    await step('5.2', 'B chọn A03', () => pageB, async () => {
      await pageB.getByRole('button', { name: seat('A03') }).click()
      await expect(pageB.getByRole('button', { name: seat('A03') })).toHaveAttribute('aria-pressed', 'true')
    })
    await step('5.3', 'A giữ A03, A04 + 1 vé đứng: tổng 3.300.000', () => pageA, async () => {
      await pageA.getByRole('button', { name: seat('A03') }).click()
      await pageA.getByRole('button', { name: seat('A04') }).click()
      await pageA.getByRole('button', { name: 'Thêm Vé đứng' }).click()
      await pageA.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
      await expect(pageA).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
      order1 = pageA.url().split('/').at(-1)!
      await expect(pageA.getByRole('timer')).toContainText('Ghế được giữ cho bạn trong')
      await expect(pageA.getByRole('row', { name: /Tổng cộng/ })).toContainText('3.300.000')
    })
    await step('5.4', 'Sơ đồ của B đổi ngay, A03 bị bỏ khỏi lựa chọn kèm thông báo', () => pageB, async () => {
      await expect(pageB.getByRole('button', { name: /^Ghế A03, .*đang có người giữ/ })).toBeVisible()
      await expect(pageB.getByText('Ghế A03 vừa có người khác giữ, đã bỏ khỏi lựa chọn của bạn.')).toBeVisible()
    })
    await step('5.6', 'Mã giảm giá sai bị báo', () => pageA, async () => {
      await pageA.getByLabel('Mã giảm giá').fill('SAIMA99')
      await pageA.getByRole('button', { name: 'Áp dụng' }).click()
      await expect(pageA.getByRole('alert')).toBeVisible()
    })
    await step('5.7', 'Mã đúng: giảm 330.000, tổng 2.970.000', () => pageA, async () => {
      await pageA.getByLabel('Mã giảm giá').fill(promo)
      await pageA.getByRole('button', { name: 'Áp dụng' }).click()
      await expect(pageA.getByText(`Mã ${promo}: giảm 330.000`)).toBeVisible()
      await expect(pageA.getByRole('row', { name: /Tổng cộng/ })).toContainText('2.970.000')
    })
    await step('5.8', 'Thẻ bị từ chối, ghế vẫn giữ', () => pageA, async () => {
      await pageA.getByRole('checkbox', { name: /Tôi đã đọc và đồng ý/ }).check()
      await pageA.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
      await pageA.getByRole('button', { name: 'Giả lập thẻ bị từ chối' }).click()
      await expect(pageA.getByText('Thanh toán bị từ chối. Ghế vẫn được giữ')).toBeVisible()
    })
    await step('5.9', 'Thanh toán thành công: 3 vé có QR', () => pageA, async () => {
      await pageA.getByRole('button', { name: 'Giả lập thanh toán thành công' }).click()
      await expect(pageA.getByText('Thanh toán thành công!')).toBeVisible()
      await expect(pageA.getByRole('link', { name: /Xem QR/ })).toHaveCount(3)
    })
    await step('5.10', 'Email xác nhận có PDF vé đính kèm (Mailpit)', () => pageA, async () => {
      await expect(async () => {
        const search = await api.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${emailA}"` } })
        const messages = ((await search.json()).messages ?? []) as Array<{ Attachments: number }>
        expect(messages.some((m) => m.Attachments > 0)).toBe(true)
      }).toPass({ timeout: 20_000 })
    })
    await step('5.11', 'Xem QR: vé còn hiệu lực, mã QR, mã vé', () => pageA, async () => {
      await pageA.getByRole('link', { name: /Xem QR/ }).first().click()
      await expect(pageA.getByRole('img', { name: /Mã QR của vé TKT-/ })).toBeVisible()
      await expect(pageA.getByText('Còn hiệu lực').first()).toBeVisible()
    })
    await step('5.12', 'Tải vé PDF (một vé, cả đơn)', () => pageA, async () => {
      const [one] = await Promise.all([pageA.waitForEvent('download'), pageA.getByRole('button', { name: 'Tải vé PDF' }).click()])
      expect(one.suggestedFilename()).toMatch(/^Ve-TKT-.*\.pdf$/)
      await pageA.goto(`/orders/${order1}`)
      const [all] = await Promise.all([pageA.waitForEvent('download'), pageA.getByRole('button', { name: 'Tải vé PDF' }).click()])
      expect(all.suggestedFilename()).toMatch(/^Ve-.*\.pdf$/)
    })

    // --- Phiên 7: hàng chờ
    await step('7.1', 'Bật hàng chờ N = 1', () => pageBtc, async () => {
      await pageBtc.goto(`/organizer/events/${event1Id}`)
      await pageBtc.getByLabel('Bật hàng chờ').check()
      await pageBtc.getByLabel('Số người được mua cùng lúc').fill('1')
      await pageBtc.getByRole('button', { name: 'Lưu hàng chờ' }).click()
      await expect(pageBtc.getByTestId('queue-stats')).toContainText('đang mua 0 / 1')
    })
    await step('7.2', 'A có lượt mua', () => pageA, async () => {
      await pageA.goto(map1)
      await expect(pageA.getByText('Đến lượt bạn mua vé')).toBeVisible()
    })
    await step('7.3', 'B xếp hàng ở vị trí 1', () => pageB, async () => {
      await pageB.goto(map1)
      await expect(pageB.getByRole('heading', { name: 'Bạn đang trong hàng chờ mua vé' })).toBeVisible()
      await expect(pageB.getByTestId('queue-place')).toHaveText('1')
    })
    await step('7.6', 'A mua C01; trang của B tự vào lượt', () => pageB, async () => {
      await pageA.getByRole('button', { name: seat('C01') }).click()
      await pageA.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
      await expect(pageA).toHaveURL(/\/orders\//)
      order2 = pageA.url().split('/').at(-1)!
      await pageA.getByRole('checkbox', { name: /Tôi đã đọc và đồng ý/ }).check()
      await pageA.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
      await pageA.getByRole('button', { name: 'Giả lập thanh toán thành công' }).click()
      await expect(pageA.getByRole('link', { name: /Xem QR/ }).first()).toBeVisible()
      await expect(pageB.getByText('Đến lượt bạn mua vé')).toBeVisible({ timeout: 20_000 })
    })
    await step('7.7', 'B giữ C02', () => pageB, async () => {
      await pageB.getByRole('button', { name: seat('C02') }).click()
      await pageB.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
      await expect(pageB.getByRole('timer')).toContainText('Ghế được giữ cho bạn trong')
      // Not in the guide (7.8): B lets it go, so the next steps start clean.
      await pageB.getByRole('button', { name: 'Hủy giữ chỗ' }).click()
    })
    await step('7.9', 'Tắt hàng chờ: B vào thẳng sơ đồ', () => pageB, async () => {
      await pageBtc.getByLabel('Bật hàng chờ').uncheck()
      await pageBtc.getByRole('button', { name: 'Lưu hàng chờ' }).click()
      await pageB.goto(map1)
      await expect(pageB.getByText('Cập nhật trực tiếp')).toBeVisible()
      await expect(pageB.getByRole('heading', { name: 'Bạn đang trong hàng chờ mua vé' })).toHaveCount(0)
    })

    const authLog: string[] = []
    pageB.on('response', (r) => {
      if (r.url().includes('/api/v1/auth/') && r.status() >= 400) authLog.push(`${new Date().toISOString().slice(11, 19)} ${r.status()} ${r.url().split('/api/v1/')[1]}`)
    })
    pageB.on('framenavigated', (f) => {
      if (f === pageB.mainFrame() && f.url().includes('/login')) authLog.push(`${new Date().toISOString().slice(11, 19)} → ${f.url().split('5180')[1]}`)
    })
    // --- Phiên 8: danh sách chờ (sự kiện 2: 2 vé)
    let map2 = ''
    await step('8.1', 'A giữ cả 2 vé đứng của sự kiện 2', () => pageA, async () => {
      await pageA.goto(`/events?q=${encodeURIComponent(title2)}`)
      await pageA.getByRole('link', { name: new RegExp(title2) }).first().click()
      slug2 = new URL(pageA.url()).pathname.split('/').at(-1)!
      await pageA.getByRole('link', { name: 'Chọn chỗ' }).first().click()
      map2 = new URL(pageA.url()).pathname
      await pageA.getByRole('button', { name: 'Thêm Vé đứng' }).click()
      await pageA.getByRole('button', { name: 'Thêm Vé đứng' }).click()
      await pageA.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
      await expect(pageA).toHaveURL(/\/orders\//)
      order3 = pageA.url().split('/').at(-1)!
    })
    await step('8.2-8.3', 'B thấy hết vé, vào danh sách chờ ở vị trí 1', () => pageB, async () => {
      await pageB.goto(map2)
      await expect(pageB.getByText('Hết vé? Vào danh sách chờ')).toBeVisible()
      await pageB.getByRole('button', { name: 'Báo tôi khi có vé' }).click()
      await expect(pageB.getByText('Đã vào danh sách chờ, bạn đứng thứ 1.')).toBeVisible()
    })
    await step('8.4', 'A hủy giữ chỗ', () => pageA, async () => {
      await pageA.goto(`/orders/${order3}`)
      await pageA.getByRole('button', { name: 'Hủy giữ chỗ' }).click()
      await expect(pageA.getByRole('button', { name: 'Tiếp tục thanh toán' })).toHaveCount(0)
    })
    await step('8.5', 'B nhận lời mời "Có vé cho bạn"', () => pageB, async () => {
      await pageB.goto('/waitlist')
      await expect(async () => {
        await pageB.reload()
        await expect(pageB.getByText('Có vé cho bạn')).toBeVisible({ timeout: 1500 })
      }).toPass({ timeout: 90_000 })
    })
    if (authLog.length) results.at(-1)!.note = `${results.at(-1)!.note ?? ''} [B: ${authLog.join('; ')}]`
    await step('8.7', 'B đặt từ lời mời và thanh toán', () => pageB, async () => {
      await pageB.getByRole('link', { name: 'Đặt ngay' }).click()
      await pageB.getByRole('button', { name: 'Thêm Vé đứng' }).click()
      await pageB.getByRole('button', { name: 'Thêm Vé đứng' }).click()
      await pageB.getByRole('button', { name: 'Giữ chỗ (10 phút)' }).click()
      await pageB.getByRole('checkbox', { name: /Tôi đã đọc và đồng ý/ }).check()
      await pageB.getByRole('button', { name: 'Tiếp tục thanh toán' }).click()
      await pageB.getByRole('button', { name: 'Giả lập thanh toán thành công' }).click()
      await expect(pageB.getByRole('link', { name: /Xem QR/ })).toHaveCount(2)
      await pageB.goto('/waitlist')
      await expect(pageB.getByText('Đã đặt')).toBeVisible()
    })

    // --- Phiên 9: hủy, hoàn tiền
    await step('9.1-9.2', 'A hủy đơn C01: hoàn 1.200.000 (80%), phí 300.000', () => pageA, async () => {
      await pageA.goto(`/orders/${order2}`)
      await expect(pageA.getByText(/hoàn 1\.200\.000.*\(80%\), phí hủy 300\.000/)).toBeVisible()
      await pageA.getByRole('button', { name: 'Hủy đơn và hoàn tiền' }).click()
      await pageA.getByRole('dialog').getByRole('button', { name: 'Hủy đơn' }).click()
      await expect(pageA.getByText('Đã hoàn tiền', { exact: true })).toBeVisible()
    })
    await step('9.4', 'Admin hoàn tiền đơn 3 vé', () => adminPage, async () => {
      await adminPage.goto(`/admin/orders/${order1}`)
      await adminPage.getByRole('button', { name: 'Hoàn tiền' }).click()
      await adminPage.getByRole('dialog').getByLabel('Lý do').fill('Thử hoàn tiền')
      await adminPage.getByRole('dialog').getByRole('button', { name: 'Hoàn tiền' }).click()
      await expect(adminPage.getByText('Đã hoàn tiền').first()).toBeVisible()
    })
    await step('9.5', 'Báo cáo doanh thu của ban tổ chức', () => pageBtc, async () => {
      await pageBtc.goto(`/organizer/events/${event1Id}?tab=sales`)
      await expect(pageBtc.locator('p', { hasText: /^Hoàn tiền$/ }).first()).toBeVisible()
    })

    // --- Phiên 10: soát vé (điện thoại; mã dán vào ô "Mã QR" thay cho camera)
    await step('10.1', 'Nhân viên đăng ký trên điện thoại: chưa có menu "Soát vé"', () => pageStaff, async () => {
      pageStaff = await register(browser, 'Hùng', emailStaff, api, true)
      await pageStaff.getByRole('button', { name: 'Menu' }).click()
      await expect(pageStaff.getByRole('navigation').getByRole('link', { name: 'Soát vé' })).toHaveCount(0)
    })
    await step('10.2', 'Ban tổ chức thêm nhân viên soát vé', () => pageBtc, async () => {
      await pageBtc.goto(`/organizer/events/${event2Id}?tab=staff`)
      await pageBtc.getByLabel('Email tài khoản nhân viên').fill(emailStaff)
      await pageBtc.getByRole('button', { name: 'Thêm nhân viên' }).click()
      await expect(pageBtc.getByRole('cell', { name: emailStaff })).toBeVisible()
    })
    await step('10.3-10.4', 'Nhân viên thấy sự kiện 2, mở trang quét ở "Cổng 1"', () => pageStaff, async () => {
      await pageStaff.reload()
      await pageStaff.getByRole('button', { name: 'Menu' }).click()
      await pageStaff.getByRole('navigation').getByRole('link', { name: 'Soát vé' }).click()
      await pageStaff.getByLabel('Tên cổng của máy này').fill('Cổng 1')
      await pageStaff.locator('section', { has: pageStaff.getByRole('heading', { name: title2 }) }).getByRole('link', { name: 'Quét vé' }).click()
      await expect(pageStaff.getByText('Cổng: Cổng 1')).toBeVisible()
    })
    await step('10.5-10.6', 'Quét vé của B: "Mời vào", quét lại: "Vé đã được sử dụng"', () => pageStaff, async () => {
      const b = await login(api, emailB)
      const tickets = (await (await api.get('tickets', { headers: { Authorization: `Bearer ${b.token}` } })).json()).data.tickets as Array<{
        id: string
        eventTitle?: string
        event?: { title: string }
      }>
      const ticket = tickets.find((t) => (t.eventTitle ?? t.event?.title) === title2) ?? tickets[0]
      const qr = await qrTokenOf(api, b, ticket.id)
      const scan = async () => {
        await pageStaff.getByLabel('Mã QR').fill(qr)
        await pageStaff.getByRole('button', { name: 'Kiểm tra' }).click()
      }
      const result = pageStaff.getByRole('button', { name: /Chạm để quét tiếp/ })
      await scan()
      await expect(result).toContainText('Mời vào')
      await result.click()
      await pageStaff.waitForTimeout(3_100)
      await scan()
      await expect(result).toContainText('Vé đã được sử dụng')
      await expect(result).toContainText('Tại: Cổng 1')
    })

    // --- Phiên 11: đánh giá
    await step('11.2', 'B đánh giá 4 sao: nhãn "Đã đi xem"', () => pageB, async () => {
      await pageB.goto('/tickets')
      await pageB.getByRole('link', { name: 'Đánh giá sự kiện' }).first().click()
      await pageB.getByRole('button', { name: 'Viết đánh giá' }).click()
      await pageB.getByRole('radio', { name: '4 sao' }).click()
      await pageB.getByLabel('Nhận xét').fill('Âm thanh tốt, vào cổng nhanh.')
      await pageB.getByRole('button', { name: 'Gửi đánh giá' }).click()
      await expect(pageB.locator('#danh-gia').getByText('Đã đi xem')).toBeVisible()
    })
    await step('11.3', 'Ban tổ chức trả lời', () => pageBtc, async () => {
      await pageBtc.goto(`/events/${slug2}`)
      await pageBtc.getByRole('button', { name: 'Trả lời', exact: true }).click()
      await pageBtc.getByLabel('Câu trả lời của ban tổ chức').fill('Cảm ơn bạn đã đến!')
      await pageBtc.getByRole('button', { name: 'Gửi trả lời' }).click()
      await expect(pageBtc.getByText('Cảm ơn bạn đã đến!')).toBeVisible()
    })
    await step('11.4', 'Admin ẩn đánh giá: người viết thấy lý do', () => adminPage, async () => {
      await adminPage.goto('/admin/reviews')
      const row = adminPage.getByRole('row').filter({ hasText: title2 })
      await row.getByRole('button', { name: 'Ẩn' }).click()
      await adminPage.getByRole('dialog').getByRole('textbox').fill('Thử ẩn đánh giá')
      await adminPage.getByRole('dialog').getByRole('button', { name: 'Ẩn đánh giá' }).click()
      await expect(row.getByText('Đã ẩn: Thử ẩn đánh giá')).toBeVisible()
      await pageB.reload()
      await expect(pageB.getByText('Đánh giá này đã bị quản trị viên ẩn: Thử ẩn đánh giá')).toBeVisible()
    })

    // --- Phiên 12: sửa sự kiện đang bán
    await step('12.1-12.2', 'Sửa mô tả khi đang bán: "Có thay đổi chưa lưu", "Đã lưu", trang công khai đổi theo', () => pageBtc, async () => {
      await pageBtc.goto(`/organizer/events/${event1Id}`)
      await pageBtc.getByLabel('Mô tả').fill('Mô tả mới sau khi mở bán.')
      await expect(pageBtc.getByText('Có thay đổi chưa lưu.').first()).toBeVisible()
      await pageBtc.getByRole('button', { name: 'Lưu thông tin' }).click()
      await expect(pageBtc.getByText('Đã lưu.').first()).toBeVisible()
      await guest.goto(`/events/${slug1}`)
      await expect(guest.getByText('Mô tả mới sau khi mở bán.')).toBeVisible()
    })
    await step('12.6', 'Nghệ sĩ khách mời: lưu 2 tên, trang công khai hiện', () => pageBtc, async () => {
      await pageBtc.goto(`/organizer/events/${event1Id}?tab=schedules`)
      const card = pageBtc.locator('form', { has: pageBtc.getByRole('heading', { name: 'Nghệ sĩ khách mời' }) })
      await card.getByLabel('Nghệ sĩ 1', { exact: true }).fill('Hà Anh Tuấn')
      await card.getByRole('button', { name: '+ Thêm nghệ sĩ' }).click()
      await card.getByLabel('Nghệ sĩ 2', { exact: true }).fill('Phương Linh')
      await card.getByRole('button', { name: 'Lưu danh sách nghệ sĩ' }).click()
      await expect(card.getByText('Đã lưu danh sách nghệ sĩ.')).toBeVisible()
      await guest.goto(`/events/${slug1}`)
      await expect(guest.getByRole('list', { name: 'Nghệ sĩ khách mời' }).getByRole('listitem')).toHaveText(['Hà Anh Tuấn', 'Phương Linh'])
    })
    await step('12.7', 'Khách A mở trang sửa sự kiện: không được', () => pageA, async () => {
      await pageA.goto(`/organizer/events/${event1Id}`)
      await expect(pageA.getByText(/không có quyền|Không tìm thấy/i).first()).toBeVisible()
    })

    // --- Phiên 13: quản trị
    await step('13.2', 'Admin khóa khách B: B bị đăng xuất', () => adminPage, async () => {
      await adminPage.goto('/admin/users')
      await adminPage.getByLabel('Tìm người dùng').fill(emailB)
      await adminPage.getByRole('button', { name: 'Tìm', exact: true }).click()
      const row = adminPage.getByRole('row').filter({ hasText: emailB })
      await row.getByRole('button', { name: 'Khóa', exact: true }).click()
      const dialog = adminPage.getByRole('dialog')
      await dialog.getByRole('textbox').fill('Thử khóa tài khoản')
      await dialog.getByRole('button', { name: 'Khóa tài khoản' }).click()
      await expect(row.getByRole('button', { name: 'Mở khóa', exact: true })).toBeVisible()
      await pageB.goto('/tickets')
      await expect(pageB).toHaveURL(/\/login/, { timeout: 15_000 })
    })
    await step('13.3', 'Admin mở khóa: B đăng nhập lại được', () => adminPage, async () => {
      await adminPage.getByRole('row').filter({ hasText: emailB }).getByRole('button', { name: 'Mở khóa', exact: true }).click()
      await signIn(pageB, emailB, PASSWORD, '/tickets')
      await expect(pageB.getByRole('heading', { name: 'Vé của tôi' })).toBeVisible()
    })

    // --- Phiên 14: phân quyền
    await step('14.1', 'Khách A không vào được trang quản trị', () => pageA, async () => {
      await pageA.goto('/admin/reports')
      await expect(pageA.getByText('Bạn không có quyền xem trang này')).toBeVisible()
    })
    await step('14.2', 'Chưa đăng nhập: "Vé của tôi" → đăng nhập → quay lại', () => guest, async () => {
      const fresh = await (await browser.newContext()).newPage()
      await fresh.goto('/tickets')
      await expect(fresh).toHaveURL(/\/login\?next=%2Ftickets/)
      await fresh.getByLabel('Email').fill(emailA)
      await fresh.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
      await fresh.getByRole('button', { name: 'Đăng nhập' }).click()
      await expect(fresh).toHaveURL(/\/tickets$/)
      await fresh.close()
    })

    // --- Phiên 15: điện thoại 375 px
    await step('15.1', 'Điện thoại 375 px: không trang nào cuộn ngang (trang chủ, sự kiện, sơ đồ, đơn)', () => guest, async () => {
      const phone = await (await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 740 } })).newPage()
      await signIn(phone, emailA)
      const wide: string[] = []
      for (const url of ['/', `/events/${slug1}`, map1, `/orders/${order1}`]) {
        await phone.goto(url)
        await phone.waitForLoadState('networkidle')
        const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (over > 1) wide.push(`${url} (+${over}px)`)
      }
      await phone.screenshot({ path: path.join(OUT, '15.1-order.png') })
      expect(wide, `cuộn ngang: ${wide.join(', ')}`).toEqual([])
    })
  } finally {
    writeReport()
  }
  // The run itself passes; the report says which steps did not.
})
