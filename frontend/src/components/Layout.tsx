import { Link, NavLink, Outlet } from 'react-router'
import { canUseAdmin, canUseOrganizer } from '../admin/permissions'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, FullPageSpinner } from './ui'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`

export function Layout() {
  const { status, user, notice, clearNotice, retry } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2 font-bold text-brand-800">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline">ETP Tickets</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            <NavLink to="/events" className={navClass}>
              Sự kiện
            </NavLink>
            {status === 'authenticated' && (
              <>
                <NavLink to="/tickets" className={navClass}>
                  Vé của tôi
                </NavLink>
                <NavLink to="/orders" className={navClass}>
                  Đơn hàng
                </NavLink>
              </>
            )}
            {status === 'authenticated' && canUseOrganizer(user) && (
              <NavLink to="/organizer" className={navClass}>
                Ban tổ chức
              </NavLink>
            )}
            {status === 'authenticated' && canUseAdmin(user) && (
              <NavLink to="/admin" className={navClass}>
                Quản trị
              </NavLink>
            )}
          </nav>
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
        </div>
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
        Event Ticket Platform — dự án học tập, thanh toán là giả lập.
      </footer>
    </div>
  )
}
