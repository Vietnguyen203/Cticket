import { describe, expect, test } from 'vitest'
import type { User } from '../api/types'
import { ADMIN_MENU, canUseAdmin, hasAny } from './permissions'

const userWith = (permissions: string[]): User => ({
  id: 'u1', email: 'a@example.com', firstName: 'A', lastName: 'B', phone: null, status: 'ACTIVE',
  emailVerifiedAt: null, createdAt: '2026-10-13T00:00:00Z', permissions,
})

describe('admin permissions', () => {
  test('a menu entry needs ANY of its permissions', () => {
    expect(hasAny(userWith(['venue:manage']), ['venue:manage', 'category:manage'])).toBe(true)
    expect(hasAny(userWith(['ticket:read:own']), ['venue:manage'])).toBe(false)
    expect(hasAny(null, ['venue:manage'])).toBe(false)
  })

  test('customers, organizers and staff do not see the admin area; a venue manager sees only venues', () => {
    expect(canUseAdmin(userWith(['booking:create', 'ticket:read:own', 'event:create', 'checkin:create']))).toBe(false)
    const venueManager = userWith(['venue:manage'])
    expect(canUseAdmin(venueManager)).toBe(true)
    expect(ADMIN_MENU.filter((entry) => hasAny(venueManager, entry.anyOf)).map((entry) => entry.to)).toEqual(['/admin', '/admin/venues'])
  })
})
