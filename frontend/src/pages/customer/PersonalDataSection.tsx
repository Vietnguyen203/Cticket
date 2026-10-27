import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toApiError } from '../../api/errors'
import { deleteMyAccount, exportMyData, getDeletionCheck, type DeletionBlocker } from '../../api/users'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card, PasswordField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

/** What to do about each reason the account cannot be deleted yet. */
const BLOCKERS: Record<DeletionBlocker, { text: string; link?: [string, string] }> = {
  UPCOMING_TICKETS: {
    text: 'Bạn còn vé cho buổi diễn chưa diễn ra. Xóa được sau khi buổi diễn kết thúc.',
    link: ['/tickets', 'Vé của tôi'],
  },
  OPEN_ORDER: { text: 'Bạn có đơn đang giữ chỗ hoặc chờ thanh toán. Thanh toán hoặc hủy giữ chỗ trước.', link: ['/orders', 'Đơn hàng'] },
  PENDING_REFUND: { text: 'Một khoản hoàn tiền của bạn chưa xong. Đợi tiền về tài khoản rồi xóa.', link: ['/orders', 'Đơn hàng'] },
  ORGANIZER_EVENTS: { text: 'Bạn là ban tổ chức đã tạo sự kiện. Liên hệ quản trị viên ETP để chuyển giao hoặc đóng hồ sơ ban tổ chức.' },
  ADMIN: { text: 'Đây là tài khoản quản trị viên. Nhờ một quản trị viên khác gỡ quyền quản trị trước.' },
}

/** Saves `data` as a file named `name` (the browser's download, no server round trip). */
function saveJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The rights of Luật Bảo vệ dữ liệu cá nhân 2025 over one's own data (Điều 10
 * of the terms of sale): download everything, or delete the account.
 */
export function PersonalDataSection() {
  return (
    <>
      <DownloadCard />
      <DeleteAccountCard />
    </>
  )
}

function DownloadCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const data = await exportMyData()
      saveJson(data, `etp-du-lieu-ca-nhan-${data.exportedAt.slice(0, 10)}.json`)
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Dữ liệu cá nhân của bạn</h2>
          <p className="mt-1 text-sm text-slate-600">
            Tải một file (JSON) gồm thông tin tài khoản, thiết bị đang đăng nhập, đơn hàng, vé, đánh giá, danh sách chờ và thông báo mà ETP đang lưu về bạn.
          </p>
        </div>
        <Button variant="secondary" loading={busy} onClick={() => void download()}>
          Tải dữ liệu của tôi
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </Card>
  )
}

function DeleteAccountCard() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const check = useAsync(getDeletionCheck, 'account-deletion')
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await deleteMyAccount(password)
      // Leave first (this page needs a session), then forget it here and in the other tabs.
      navigate('/', { replace: true })
      await logout('Tài khoản của bạn đã được xóa. Cảm ơn bạn đã dùng ETP Tickets.')
    } catch (err) {
      const apiError = toApiError(err)
      setError(apiError.message)
      if (apiError.code === 'ACCOUNT_DELETION_BLOCKED') check.reload()
      setBusy(false)
    }
  }

  const reasons = check.data?.reasons ?? []

  return (
    <Card className="space-y-3 border-red-200">
      <h2 className="font-semibold text-red-700">Xóa tài khoản</h2>
      <p className="text-sm text-slate-600">
        Xóa vĩnh viễn thông tin cá nhân (họ tên, email, số điện thoại, thiết bị đăng nhập, xác thực hai lớp, nội dung đánh giá) và đăng xuất khỏi mọi thiết bị.
        Đơn hàng, thanh toán và hoàn tiền vẫn được giữ ở dạng ẩn danh để đối soát với ban tổ chức và thực hiện nghĩa vụ kế toán, thuế.{' '}
        <Link to="/dieu-khoan#du-lieu-ca-nhan" target="_blank" className="font-semibold text-brand-700 hover:underline">
          Điều 10, Điều kiện giao dịch chung
        </Link>
      </p>

      {check.error && <Alert>{check.error.message}</Alert>}
      {reasons.length > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <p className="font-semibold">Chưa xóa được tài khoản lúc này:</p>
          <ul className="list-disc space-y-1 pl-5">
            {reasons.map((reason) => (
              <li key={reason}>
                {BLOCKERS[reason]?.text ?? reason}
                {BLOCKERS[reason]?.link && (
                  <>
                    {' '}
                    <Link to={BLOCKERS[reason].link![0]} className="font-semibold underline">
                      {BLOCKERS[reason].link![1]}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.data?.allowed && !open && (
        <Button variant="secondary" className="!border-red-200 !text-red-700 hover:!bg-red-50" onClick={() => setOpen(true)}>
          Xóa tài khoản…
        </Button>
      )}
      {check.data?.allowed && open && (
        <form onSubmit={onDelete} className="space-y-3" noValidate>
          {error && <Alert>{error}</Alert>}
          <PasswordField
            label="Nhập mật khẩu để xác nhận"
            name="delete-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-red-600" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>Tôi hiểu việc xóa tài khoản không hoàn tác được; muốn dùng lại ETP tôi phải đăng ký tài khoản mới.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={!understood || password.length === 0}>
              Xóa vĩnh viễn tài khoản
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false)
                setPassword('')
                setUnderstood(false)
                setError(null)
              }}
            >
              Thôi
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
