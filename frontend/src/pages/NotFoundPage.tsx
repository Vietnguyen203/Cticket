import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-bold text-brand-700">404</p>
      <h1 className="mt-2 text-xl font-semibold">Không tìm thấy trang</h1>
      <Link to="/" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
        Về trang chủ
      </Link>
    </div>
  )
}
