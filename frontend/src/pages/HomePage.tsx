import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext'

/** Placeholder until step 11.2 (event list, search). */
export function HomePage() {
  const { status, user } = useAuth()

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-500 px-6 py-12 text-white sm:px-10">
        <h1 className="text-3xl font-bold sm:text-4xl">
          {status === 'authenticated' && user ? `Chào ${user.firstName}!` : 'Vé sự kiện, giữ chỗ trong tích tắc'}
        </h1>
        <p className="mt-3 max-w-xl text-brand-50">
          Chọn ghế trên sơ đồ trực tiếp, thanh toán và nhận vé có mã QR. Danh sách sự kiện sẽ có ở bước tiếp theo.
        </p>
        {status === 'anonymous' && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/register" className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50">
              Tạo tài khoản
            </Link>
            <Link to="/login" className="rounded-lg border border-white/60 px-4 py-2.5 text-sm font-semibold hover:bg-white/10">
              Đăng nhập
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}
