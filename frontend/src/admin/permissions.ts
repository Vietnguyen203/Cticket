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
  { to: '/admin', label: 'Tổng quan', anyOf: ['event:approve', 'organizer:manage', 'venue:manage', 'category:manage'] },
  { to: '/admin/events', label: 'Duyệt sự kiện', anyOf: ['event:approve', 'event:manage:any'] },
  { to: '/admin/organizers', label: 'Nhà tổ chức', anyOf: ['organizer:manage'] },
  { to: '/admin/venues', label: 'Địa điểm', anyOf: ['venue:manage'] },
  { to: '/admin/categories', label: 'Danh mục', anyOf: ['category:manage'] },
]

export function hasAny(user: User | null, permissions: string[]): boolean {
  const granted = user?.permissions ?? []
  return permissions.some((permission) => granted.includes(permission))
}

/** Any admin page at all: shows the "Quản trị" link in the header. */
export const canUseAdmin = (user: User | null) => ADMIN_MENU.some((entry) => hasAny(user, entry.anyOf))
