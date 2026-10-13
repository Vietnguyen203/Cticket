import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { RequireAuth } from '../auth/RequireAuth'
import { useAuth } from '../auth/AuthContext'
import { hasAny } from './permissions'

function Gate({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { user } = useAuth()
  if (hasAny(user, anyOf)) return children
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-bold text-slate-300">403</p>
      <h1 className="mt-2 text-xl font-semibold">Bạn không có quyền xem trang này</h1>
      <Link to="/" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
        Về trang chủ
      </Link>
    </div>
  )
}

/** Signed in AND holding one of the permissions (the API checks again on every call). */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  return (
    <RequireAuth>
      <Gate anyOf={anyOf}>{children}</Gate>
    </RequireAuth>
  )
}
