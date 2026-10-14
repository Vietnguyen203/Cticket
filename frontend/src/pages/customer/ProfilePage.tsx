import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, toApiError } from '../../api/errors'
import type { Role } from '../../api/types'
import { updateMe, type ProfileChanges } from '../../api/users'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { TwoFactorSection } from './TwoFactorSection'

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: 'Khách hàng',
  ORGANIZER: 'Ban tổ chức',
  STAFF: 'Nhân viên soát vé',
  ADMIN: 'Quản trị viên',
}

/** APP-C06: view / edit the profile, log out. */
export function ProfilePage() {
  const { user, setUser, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: user?.phone ?? '',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  // Only what changed; an emptied phone number is removed (null).
  const changes: ProfileChanges = {}
  if (form.firstName.trim() !== user.firstName) changes.firstName = form.firstName.trim()
  if (form.lastName.trim() !== user.lastName) changes.lastName = form.lastName.trim()
  if (form.phone.trim() !== (user.phone ?? '')) changes.phone = form.phone.trim() || null
  const dirty = Object.keys(changes).length > 0

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    setSaved(false)
    try {
      setUser(await updateMe(changes))
      setSaved(true)
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  async function onLogout() {
    // Leave first: once logged out, this page would send the user to the login page.
    navigate('/', { replace: true })
    await logout()
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold">Tài khoản</h1>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto font-medium text-slate-900">{user.email}</p>
          {(user.roles ?? []).map((role) => (
            <span key={role} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
              {ROLE_LABELS[role] ?? role}
            </span>
          ))}
        </div>

        <form onSubmit={onSave} className="mt-6 space-y-4" noValidate>
          {error && <Alert>{error.message}</Alert>}
          {saved && !dirty && <Alert tone="success">Đã lưu thay đổi.</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Họ"
              name="lastName"
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              error={fieldErrors.lastName}
            />
            <TextField
              label="Tên"
              name="firstName"
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              error={fieldErrors.firstName}
            />
          </div>
          <TextField
            label="Số điện thoại"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            error={fieldErrors.phone}
          />
          <Button type="submit" loading={busy} disabled={!dirty}>
            Lưu thay đổi
          </Button>
        </form>
      </Card>

      <TwoFactorSection email={user.email} />

      <Card className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          {user.roles?.includes('ORGANIZER') ? 'Quản lý sự kiện bạn tổ chức.' : 'Muốn bán vé sự kiện của bạn trên ETP?'}
        </p>
        <Link
          to={user.roles?.includes('ORGANIZER') ? '/organizer' : '/organizer/apply'}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          {user.roles?.includes('ORGANIZER') ? 'Trang ban tổ chức' : 'Trở thành nhà tổ chức'}
        </Link>
      </Card>

      <Card className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">Đăng xuất khỏi trình duyệt này (các tab khác cũng sẽ đăng xuất).</p>
        <Button variant="secondary" onClick={onLogout}>
          Đăng xuất
        </Button>
      </Card>
    </div>
  )
}
