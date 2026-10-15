import type { User } from '../api/types'

/**
 * Admin menu: an entry shows when the user has ANY of its permissions.
 * Hiding a menu is only tidiness: the API checks every permission itself.
 */
export interface MenuEntry {
  to: string
  label: string
  anyOf: string[]
}

export const ADMIN_MENU: MenuEntry[] = [
  { to: '/admin', label: 'Tổng quan', anyOf: ['report:read:any', 'event:approve', 'organizer:manage', 'venue:manage', 'category:manage', 'user:manage', 'order:manage', 'audit:read'] },
  { to: '/admin/reports', label: 'Doanh thu', anyOf: ['report:read:any'] },
  { to: '/admin/events', label: 'Sự kiện', anyOf: ['event:approve', 'event:manage:any'] },
  { to: '/admin/organizers', label: 'Nhà tổ chức', anyOf: ['organizer:manage'] },
  { to: '/admin/venues', label: 'Địa điểm', anyOf: ['venue:manage'] },
  { to: '/admin/categories', label: 'Danh mục', anyOf: ['category:manage'] },
  { to: '/admin/users', label: 'Người dùng', anyOf: ['user:manage'] },
  { to: '/admin/orders', label: 'Đơn hàng', anyOf: ['order:manage'] },
  { to: '/admin/promotions', label: 'Mã giảm giá', anyOf: ['promotion:manage'] },
  { to: '/admin/reviews', label: 'Đánh giá', anyOf: ['review:manage'] }, // Phase 19
  { to: '/admin/audit', label: 'Audit log', anyOf: ['audit:read'] },
]

/** Organizer area (Phase 12.2): the organizer's own events. */
export const ORGANIZER_PERMISSIONS = ['event:create', 'event:update:own']

export const ORGANIZER_MENU: MenuEntry[] = [
  { to: '/organizer', label: 'Sự kiện của tôi', anyOf: ORGANIZER_PERMISSIONS },
  { to: '/organizer/events/new', label: 'Tạo sự kiện', anyOf: ['event:create'] },
]

export function hasAny(user: User | null, permissions: string[]): boolean {
  const granted = user?.permissions ?? []
  return permissions.some((permission) => granted.includes(permission))
}

/** Any admin page at all: shows the "Quản trị" link in the header. */
export const canUseAdmin = (user: User | null) => ADMIN_MENU.some((entry) => hasAny(user, entry.anyOf))

/**
 * The "Ban tổ chức" link: accounts with the ORGANIZER role (an approved
 * organizer profile). Admins hold every permission but no organizer profile,
 * so permissions alone would show it to them for nothing.
 */
export const canUseOrganizer = (user: User | null) => Boolean(user?.roles?.includes('ORGANIZER'))

/** Gate staff (the role, like canUseOrganizer: an admin holds checkin:* but scans for no event). */
export const canUseStaff = (user: User | null) => Boolean(user?.roles?.includes('STAFF'))
