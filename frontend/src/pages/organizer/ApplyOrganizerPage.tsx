import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, toApiError } from '../../api/errors'
import { applyAsOrganizer, getMyOrganizer } from '../../api/organizer'
import { StatusBadge } from '../../admin/components'
import { hasAny, ORGANIZER_PERMISSIONS } from '../../admin/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, FormPage, FullPageSpinner, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

const STATUS_TEXT = {
  PENDING: 'Đơn đã gửi, đang chờ quản trị viên duyệt.',
  ACTIVE: 'Đã được duyệt: bạn có thể tạo sự kiện.',
  SUSPENDED: 'Hồ sơ đang bị tạm khóa: bạn không quản lý được sự kiện cho tới khi được mở lại.',
  REJECTED: 'Đơn đăng ký đã bị từ chối.',
}

/** A customer applies to sell tickets; an admin approves (Phase 3). */
export function ApplyOrganizerPage() {
  const { user, refreshSession } = useAuth()
  const profile = useAsync(getMyOrganizer, 'my-organizer')
  const [form, setForm] = useState({ organizationName: '', description: '', taxCode: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await applyAsOrganizer({
        organizationName: form.organizationName.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.taxCode.trim() ? { taxCode: form.taxCode.trim() } : {}),
      })
      profile.reload()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  if (profile.loading && profile.data === undefined) return <FullPageSpinner />
  if (profile.error) return <FormPage title="Nhà tổ chức"><Alert>{profile.error.message}</Alert></FormPage>

  const organizer = profile.data
  if (organizer) {
    // Approved, but this session's token predates the ORGANIZER role.
    const needsRefresh = organizer.status === 'ACTIVE' && !hasAny(user, ORGANIZER_PERMISSIONS)
    return (
      <FormPage title={organizer.organizationName} subtitle="Hồ sơ nhà tổ chức của bạn">
        <div className="space-y-4">
          <StatusBadge status={organizer.status} />
          <p className="text-sm text-slate-700">{STATUS_TEXT[organizer.status]}</p>
          {needsRefresh && (
            <Button onClick={() => void refreshSession()} className="w-full">
              Cập nhật quyền ngay
            </Button>
          )}
          {organizer.status === 'ACTIVE' && !needsRefresh && (
            <Link to="/organizer" className="block rounded-lg bg-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-800">
              Vào trang ban tổ chức
            </Link>
          )}
        </div>
      </FormPage>
    )
  }

  return (
    <FormPage title="Trở thành nhà tổ chức" subtitle="Gửi thông tin tổ chức của bạn; sau khi được duyệt, bạn tạo và bán vé sự kiện trên ETP.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error.message}</Alert>}
        <TextField
          label="Tên tổ chức / công ty"
          name="organizationName"
          value={form.organizationName}
          onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
          error={fieldErrors.organizationName}
        />
        <TextField
          label="Mã số thuế (không bắt buộc)"
          name="taxCode"
          inputMode="numeric"
          value={form.taxCode}
          onChange={(e) => setForm({ ...form, taxCode: e.target.value })}
          error={fieldErrors.taxCode ? '10 chữ số, hoặc 10 chữ số-3 chữ số.' : undefined}
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Giới thiệu (không bắt buộc)</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={4}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <Button type="submit" loading={busy} disabled={form.organizationName.trim().length < 2} className="w-full">
          Gửi đăng ký
        </Button>
      </form>
    </FormPage>
  )
}
