import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { canUseAdmin, canUseOrganizer, canUseStaff } from '../admin/permissions'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, FullPageSpinner } from './ui'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`

export function Layout() {
  const { status, user, notice, clearNotice, retry } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const signedIn = status === 'authenticated'
  const links: Array<[string, string]> = [
    ['/events', 'Sự kiện'],
    ...(signedIn
      ? ([
          ['/tickets', 'Vé của tôi'],
          ['/orders', 'Đơn hàng'],
          ['/waitlist', 'Danh sách chờ'], // Phase 18.4
        ] as Array<[string, string]>)
      : []),
    ...(signedIn && canUseOrganizer(user) ? ([['/organizer', 'Ban tổ chức']] as Array<[string, string]>) : []),
    ...(signedIn && canUseStaff(user) ? ([['/staff', 'Soát vé']] as Array<[string, string]>) : []),
    ...(signedIn && canUseAdmin(user) ? ([['/admin', 'Quản trị']] as Array<[string, string]>) : []),
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2 font-bold text-brand-800">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline">ETP Tickets</span>
          </Link>
          {/* Wide screens: the links in the bar. Phones: a ☰ button opens them as a list. */}
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} className={navClass}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1 sm:hidden" />
          {status === 'authenticated' && user ? (
            <NavLink to="/account" className={navClass}>
              <span className="block max-w-28 truncate">{user.firstName}</span>
            </NavLink>
          ) : (
            status === 'anonymous' && (
              <Link to="/login" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                Đăng nhập
              </Link>
            )
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Menu"
            className="rounded-lg px-3 py-2 text-xl leading-none text-slate-700 hover:bg-slate-100 sm:hidden"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
        {menuOpen && (
          <nav className="border-t border-slate-200 bg-white px-4 py-2 sm:hidden">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={(state) => `block ${navClass(state)} !py-3 !text-base`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {notice && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4">
          <Alert tone="warning">
            <div className="flex items-center justify-between gap-4">
              <span>{notice}</span>
              <button type="button" onClick={clearNotice} className="font-semibold underline">
                Đóng
              </button>
            </div>
          </Alert>
        </div>
      )}

      <main className="flex-1">
        {status === 'loading' ? (
          <FullPageSpinner />
        ) : status === 'unreachable' ? (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <Alert>Không kết nối được máy chủ. Kiểm tra mạng (hoặc Docker) rồi thử lại.</Alert>
            <Button className="mt-4" onClick={retry}>
              Thử lại
            </Button>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Event Ticket Platform — dự án học tập, thanh toán qua VNPay sandbox.
      </footer>
    </div>
  )
}
