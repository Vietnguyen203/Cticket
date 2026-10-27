import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { E2E_TOTP_SECRET, MAILPIT_URL } from '../stack.mjs'
import { createAdminAccount } from './db'
import { totpCode } from './totp'

/** The terms of sale a buyer accepts at checkout (backend/src/config/constants.js TERMS_VERSION). */
export const TERMS_VERSION = '2026-10-27.2'

/**
 * Background data made through the API (fast, stable); the part a test is
 * about is then done through the pages. Every name / email is unique, so the
 * specs run in parallel on the same database.
 */
export const unique = () => randomUUID().slice(0, 8)
export const PASSWORD = 'E2e-Pass-2026'

const DAY_MS = 86_400_000

async function ok<T = Record<string, any>>(res: Promise<APIResponse>, status = [200, 201]): Promise<T> {
  const r = await res
  if (!status.includes(r.status())) throw new Error(`${r.url()} → ${r.status()} ${await r.text()}`)
  return r.status() === 204 ? ({} as T) : (await r.json()).data
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

// --- email (Mailpit) -----------------------------------------------------------

/** The 6-digit code of the newest email to `email` (waits for it to arrive). */
export async function latestOtp(api: APIRequestContext, email: string): Promise<string> {
  let code: string | undefined
  await expect
    .poll(
      async () => {
        const search = await api.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${email}"` } })
        const [newest] = (await search.json()).messages ?? []
        if (!newest) return undefined
        const message = await (await api.get(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)).json()
        code = /\b(\d{6})\b/.exec(message.Text)?.[1]
        return code
      },
      { message: `an email with a code to ${email}`, timeout: 15_000 },
    )
    .toBeTruthy()
  return code!
}

// --- accounts ------------------------------------------------------------------

export interface Account {
  email: string
  password: string
  token: string
  id: string
}

/** Password, then (Phase 15) the code from the "authenticator app" when the account uses two-factor. */
export async function login(api: APIRequestContext, email: string, password = PASSWORD, totpSecret = E2E_TOTP_SECRET): Promise<Account> {
  let data = await ok(api.post('auth/login', { data: { email, password } }))
  if (data.mfaRequired) data = await ok(api.post('auth/login/2fa', { data: { mfaToken: data.mfaToken, code: totpCode(totpSecret) } }))
  return { email, password, token: data.accessToken, id: data.user.id }
}

/** A new admin of its own (support/db.ts), signed in with two-factor. */
export async function loginAdmin(api: APIRequestContext): Promise<Account> {
  const admin = await createAdminAccount()
  return login(api, admin.email, admin.password)
}

/** Registered, email verified (code from Mailpit), signed in. */
export async function createCustomer(api: APIRequestContext, firstName = 'Khách'): Promise<Account> {
  const email = `customer-${unique()}@e2e.test`
  await ok(api.post('auth/register', { data: { email, password: PASSWORD, firstName, lastName: 'E2E' } }))
  await ok(api.post('auth/otp/verify', { data: { email, purpose: 'EMAIL_VERIFICATION', otp: await latestOtp(api, email) } }))
  return login(api, email)
}

/** A customer who applied as organizer and was approved; signed in again so the token has the role. */
export async function createOrganizer(api: APIRequestContext, admin: Account) {
  const user = await createCustomer(api, 'Ban tổ chức')
  const name = `Nhà tổ chức ${unique()}`
  const { organizer } = await ok(api.post('organizers', { headers: bearer(user.token), data: { organizationName: name } }))
  await ok(api.patch(`organizers/${organizer.id}/status`, { headers: bearer(admin.token), data: { status: 'ACTIVE' } }))
  return { ...(await login(api, user.email)), organizerId: organizer.id as string, organizationName: name }
}

// --- catalog -------------------------------------------------------------------

/** A fixed hour, N days from today (UTC). */
export function at(daysFromNow: number, hour = 12): Date {
  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  return new Date(midnight.getTime() + daysFromNow * DAY_MS + hour * 3_600_000)
}

export async function createCategory(api: APIRequestContext, admin: Account) {
  return (await ok(api.post('categories', { headers: bearer(admin.token), data: { name: `Thể loại ${unique()}` } }))).category
}

/** Seated zone "A" (rows A and B, 10 seats each) + standing zone "PIT" (100). */
export async function createSeatedVenue(api: APIRequestContext, admin: Account) {
  const h = { headers: bearer(admin.token) }
  const { venue } = await ok(
    api.post('venues', { ...h, data: { name: `Nhà hát ${unique()}`, addressLine: '1 Lê Lợi', city: 'Hồ Chí Minh', capacity: 500 } }),
  )
  const { zone: zoneA } = await ok(api.post(`venues/${venue.id}/zones`, { ...h, data: { code: 'A', name: 'Khu A', kind: 'SEATED' } }))
  const { zone: pit } = await ok(
    api.post(`venues/${venue.id}/zones`, { ...h, data: { code: 'PIT', name: 'Khu đứng', kind: 'STANDING', capacity: 100 } }),
  )
  await ok(api.post(`zones/${zoneA.id}/seats/bulk`, { ...h, data: { rows: [{ rowLabel: 'A', from: 1, to: 10 }, { rowLabel: 'B', from: 1, to: 10 }] } }))
  const layout = await ok(api.get(`venues/${venue.id}/layout`))
  const seats = layout.zones.find((z: { code: string }) => z.code === 'A').seats as Array<{ id: string; code: string }>
  return { venue, zoneAId: zoneA.id as string, pitId: pit.id as string, seats }
}

/**
 * A PUBLISHED event, one schedule: CAT 1 (row A, 2.000.000đ), CAT 2 (row B,
 * 1.000.000đ), Đứng (100 standing, 500.000đ).
 */
export async function createPublishedEvent(
  api: APIRequestContext,
  { admin, organizer, daysFromNow = 30, startAt, endAt }: { admin: Account; organizer: Account; daysFromNow?: number; startAt?: Date; endAt?: Date },
) {
  const asOrganizer = { headers: bearer(organizer.token) }
  const category = await createCategory(api, admin)
  const layout = await createSeatedVenue(api, admin)
  const title = `Đêm nhạc E2E ${unique()}`
  const { event } = await ok(api.post('events', { ...asOrganizer, data: { title, categoryIds: [category.id] } }))
  const { schedule } = await ok(
    api.post(`events/${event.id}/schedules`, {
      ...asOrganizer,
      data: {
        venueId: layout.venue.id,
        startAt: (startAt ?? at(daysFromNow, 12)).toISOString(),
        endAt: (endAt ?? at(daysFromNow, 14)).toISOString(),
      },
    }),
  )
  const ticketType = async (data: Record<string, unknown>) =>
    (await ok(api.post(`schedules/${schedule.id}/ticket-types`, { ...asOrganizer, data }))).ticketType
  const cat1 = await ticketType({ code: 'CAT1', name: 'CAT 1', price: 2_000_000, inventoryMode: 'RESERVED' })
  const cat2 = await ticketType({ code: 'CAT2', name: 'CAT 2', price: 1_000_000, inventoryMode: 'RESERVED' })
  const standing = await ticketType({
    code: 'STAND', name: 'Đứng', price: 500_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 100, venueZoneId: layout.pitId,
  })
  await ok(
    api.put(`schedules/${schedule.id}/seat-plan`, {
      ...asOrganizer,
      data: {
        assignments: [
          { ticketTypeId: cat1.id, zoneId: layout.zoneAId, rows: ['A'] },
          { ticketTypeId: cat2.id, zoneId: layout.zoneAId, rows: ['B'] },
        ],
      },
    }),
  )
  await ok(api.patch(`events/${event.id}/status`, { ...asOrganizer, data: { status: 'PENDING_APPROVAL' } }))
  const published = (await ok(api.patch(`events/${event.id}/status`, { headers: bearer(admin.token), data: { status: 'PUBLISHED' } }))).event
  const seat = Object.fromEntries(layout.seats.map((s) => [s.code, s.id])) as Record<string, string>
  return { event: published, title, schedule, cat1, cat2, standing, seat, venue: layout.venue }
}

// --- buying --------------------------------------------------------------------

/** Hold → checkout → pay. */
export async function buy(
  api: APIRequestContext,
  buyer: Account,
  scheduleId: string,
  body: { seatIds?: string[]; items?: Array<{ ticketTypeId: string; quantity: number }> },
) {
  const h = { headers: bearer(buyer.token) }
  const { order } = await ok(api.post(`schedules/${scheduleId}/orders`, { ...h, data: body }))
  await ok(api.post(`orders/${order.id}/checkout`, { ...h, data: { termsVersion: TERMS_VERSION } }))
  const { payment } = await ok(
    api.post('payments', { headers: { ...h.headers, 'Idempotency-Key': randomUUID() }, data: { orderId: order.id } }),
  )
  const { tickets } = await ok(api.get('tickets', { ...h, params: { pageSize: 50 } }))
  type Ticket = { id: string; code: string; orderId: string; seatLabel: string | null }
  return { order, payment, tickets: (tickets as Ticket[]).filter((t) => t.orderId === order.id) }
}

export async function qrTokenOf(api: APIRequestContext, owner: Account, ticketId: string): Promise<string> {
  return (await ok(api.get(`tickets/${ticketId}`, { headers: bearer(owner.token) }))).ticket.qrToken
}

export async function createPromotion(api: APIRequestContext, admin: Account, percent = 10) {
  const code = `E2E${unique().toUpperCase()}`
  await ok(
    api.post('promotions', {
      headers: bearer(admin.token),
      data: {
        code,
        name: `Giảm ${percent}%`,
        discountType: 'PERCENTAGE',
        discountValue: percent,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
      },
    }),
  )
  return code
}

/** The organizer puts `person` on the gate team; signed in again so the token has the STAFF role. */
export async function addStaff(api: APIRequestContext, organizer: Account, eventId: string, person: Account) {
  await ok(api.post(`events/${eventId}/staff`, { headers: bearer(organizer.token), data: { email: person.email } }))
  return login(api, person.email)
}
