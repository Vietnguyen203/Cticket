import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router'
import { Button } from '../components/ui'
import { reportClientError } from '../utils/clientErrors'

/**
 * Phase 23: a page that failed while drawing shows this instead of a blank
 * screen, and the error is sent to the API (utils/clientErrors.ts).
 */
export function RouteErrorPage() {
  const error = useRouteError()
  useEffect(() => {
    reportClientError(error)
  }, [error])
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-bold text-brand-700">Ối</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">Đã có lỗi khi hiển thị trang này</h1>
      <p className="mt-2 text-sm text-slate-600">Lỗi đã được ghi lại để đội kỹ thuật xử lý. Bạn thử tải lại trang nhé.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => window.location.reload()}>Tải lại trang</Button>
        <Link to="/" reloadDocument className="font-semibold text-brand-700 hover:underline">
          Về trang chủ
        </Link>
      </div>
    </main>
  )
}
