import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { canUseAdmin, canUseOrganizer, canUseStaff } from '../admin/permissions'
import { useAuth } from '../auth/AuthContext'
import { CloseIcon, MenuIcon, SearchIcon } from './icons'
import { Alert, Button, FullPageSpinner } from './ui'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium transition duration-150 ${
    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
  }`

/** The site's mark: the favicon and the name. */
function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2 whitespace-nowrap font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>
      <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0" />
      <span className={`text-[17px] ${compact ? 'hidden sm:inline' : ''}`}>
        ETP <span className={dark ? 'text-brand-300' : 'text-brand-700'}>Tickets</span>
      </span>
    </span>
  )
}

export function Layout() {
  const { status, user, notice, clearNotice, retry } = useAuth()
  const { pathname } = useLocation()
  // The phone menu is open for the page it was opened on: moving to another page closes it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null)
  const menuOpen = menuOpenOn === pathname
  const closeMenu = () => setMenuOpenOn(null)
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

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpenOn(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-white focus:px-4 focus:py-2 focus:shadow-raised">
        Bỏ qua menu
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="mr-3 rounded-control" aria-label="ETP Tickets, trang chủ">
            <Logo compact />
          </Link>
          <nav aria-label="Chính" className="hidden flex-1 items-center gap-1 lg:flex">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} className={navClass}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1 lg:hidden" />
          <Link
            to="/events"
            aria-label="Tìm sự kiện"
            className="flex h-10 w-10 items-center justify-center rounded-control text-slate-600 transition hover:bg-slate-100 hover:text-ink"
          >
            <SearchIcon />
          </Link>
          {signedIn && user ? (
            <NavLink
              to="/account"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium transition hover:bg-slate-100 ${isActive ? 'bg-brand-50 text-brand-800' : 'text-ink'}`
              }
            >
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold uppercase text-white">
                {user.firstName.slice(0, 1)}
              </span>
              <span className="hidden max-w-28 truncate sm:block">{user.firstName}</span>
              <span className="sr-only sm:hidden">{user.firstName}</span>
            </NavLink>
          ) : (
            status === 'anonymous' && (
              <div className="flex items-center gap-2">
                <Link to="/register" className="hidden rounded-control px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-100 sm:block">
                  Đăng ký
                </Link>
                <Link to="/login" className="whitespace-nowrap rounded-control bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-800">
                  Đăng nhập
                </Link>
              </div>
            )
          )}
          <button
            type="button"
            onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
            aria-expanded={menuOpen}
            aria-controls="menu-dien-thoai"
            aria-label="Menu"
            className="flex h-10 w-10 items-center justify-center rounded-control text-ink hover:bg-slate-100 lg:hidden"
          >
            {menuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
          </button>
        </div>
        {menuOpen && (
          <>
            <button type="button" aria-label="Đóng menu" onClick={closeMenu} className="fixed inset-0 top-16 z-10 cursor-default bg-ink/30 lg:hidden" />
            <nav
              id="menu-dien-thoai"
              aria-label="Chính"
              className="absolute inset-x-0 top-16 z-20 border-b border-line bg-white px-4 pb-4 pt-2 shadow-raised lg:hidden"
            >
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} onClick={closeMenu} className={(state) => `block ${navClass(state)} !py-3 !text-base`}>
                  {label}
                </NavLink>
              ))}
              {!signedIn && status === 'anonymous' && (
                <NavLink to="/register" onClick={closeMenu} className={(state) => `block ${navClass(state)} !py-3 !text-base`}>
                  Đăng ký tài khoản
                </NavLink>
              )}
            </nav>
          </>
        )}
      </header>

      {notice && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
          <Alert tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span>{notice}</span>
              <button type="button" onClick={clearNotice} className="font-semibold underline underline-offset-2">
                Đóng
              </button>
            </div>
          </Alert>
        </div>
      )}

      <main id="noi-dung" className="flex-1">
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

      <footer className="mt-16 bg-ink text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr] sm:px-6">
          <div className="max-w-sm space-y-3">
            <Logo dark />
            <p className="text-sm leading-relaxed text-slate-400">
              Vé hòa nhạc, sân khấu và sự kiện: chọn chỗ ngồi ưng ý, thanh toán an toàn và nhận vé có mã QR ngay.
            </p>
          </div>
          <nav aria-label="Khám phá" className="space-y-2 text-sm">
            <p className="font-semibold text-white">Khám phá</p>
            <Link to="/events" className="block hover:text-white">
              Tất cả sự kiện
            </Link>
            <Link to="/organizer/apply" className="block hover:text-white">
              Trở thành ban tổ chức
            </Link>
          </nav>
          <nav aria-label="Tài khoản" className="space-y-2 text-sm">
            <p className="font-semibold text-white">Tài khoản</p>
            <Link to="/tickets" className="block hover:text-white">
              Vé của tôi
            </Link>
            <Link to="/orders" className="block hover:text-white">
              Đơn hàng
            </Link>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500 sm:px-6">
            Event Ticket Platform — dự án học tập, thanh toán qua VNPay sandbox.
          </p>
        </div>
      </footer>
    </div>
  )
}
