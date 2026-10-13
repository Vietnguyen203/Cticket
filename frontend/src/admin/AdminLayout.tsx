import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ADMIN_MENU, hasAny } from './permissions'

/** Admin area: menu on the left (a toggle on phones), the page on the right. */
export function AdminLayout() {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const entries = ADMIN_MENU.filter((entry) => hasAny(user, entry.anyOf))
  // No admin page at all for this account: just the page (it shows "403").
  if (entries.length === 0) return <Outlet />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:py-8">
      <aside className="md:w-56 md:shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold md:hidden"
        >
          Menu quản trị <span aria-hidden="true">{menuOpen ? '▲' : '▼'}</span>
        </button>
        <nav className={`${menuOpen ? 'mt-2 block' : 'hidden'} space-y-1 rounded-xl border border-slate-200 bg-white p-2 md:block`}>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Quản trị</p>
          {entries.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.to === '/admin'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1">
        <Outlet />
      </section>
    </div>
  )
}
