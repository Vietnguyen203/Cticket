import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listUsers, resetUserTwoFactor, setUserRoles, setUserStatus, unlockUserLogin, type AdminUser } from '../../api/admin'
import { toApiError } from '../../api/errors'
import type { Role } from '../../api/types'
import { ConfirmDialog, EmptyRow, PageHeader, Pagination, StatusBadge, TableCard } from '../../admin/components'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const ROLE_LABELS: Record<Role, string> = { CUSTOMER: 'Khách hàng', ORGANIZER: 'Ban tổ chức', STAFF: 'Soát vé', ADMIN: 'Quản trị' }
const GRANTABLE: Role[] = ['ORGANIZER', 'STAFF', 'ADMIN']
/** What each role gives, shown under its checkbox. */
const ROLE_HINTS: Partial<Record<Role, string>> = {
  ORGANIZER: 'Tạo và quản lý sự kiện của mình. Hồ sơ nhà tổ chức được tạo / duyệt luôn.',
  STAFF: 'Soát vé ở các sự kiện mà ban tổ chức thêm người này vào.',
  ADMIN: 'Toàn quyền quản trị, như tài khoản admin.',
}
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Hoạt động',
  PENDING_VERIFICATION: 'Chưa xác minh email',
  SUSPENDED: 'Đã khóa',
  INACTIVE: 'Ngừng',
}

/** USR-03/04/05: find users, suspend / reactivate, set roles. */
export function UsersPage() {
  const { user: me } = useAuth()
  const [draft, setDraft] = useState('')
  const [filters, setFilters] = useState({ q: '', role: '', status: '', page: 1 })
  const [suspending, setSuspending] = useState<AdminUser | null>(null)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [editingRoles, setEditingRoles] = useState<AdminUser | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const list = useAsync(
    () =>
      listUsers({
        q: filters.q || undefined,
        role: (filters.role || undefined) as Role | undefined,
        status: filters.status || undefined,
        page: filters.page,
        pageSize: 20,
      }),
    JSON.stringify(filters),
  )

  /** Phase 18.1 */
  async function unlockLogin(user: AdminUser) {
    try {
      await unlockUserLogin(user.id)
      setMessage({ tone: 'success', text: `${user.email} đăng nhập lại được ngay.` })
      list.reload()
    } catch (err) {
      setMessage({ tone: 'error', text: toApiError(err).message })
    }
  }

  async function reactivate(user: AdminUser) {
    try {
      await setUserStatus(user.id, 'ACTIVE')
      setMessage({ tone: 'success', text: `Đã mở khóa ${user.email}.` })
      list.reload()
    } catch (err) {
      setMessage({ tone: 'error', text: toApiError(err).message })
    }
  }

  return (
    <>
      <PageHeader title="Người dùng" subtitle="Khóa tài khoản vi phạm (đăng xuất ngay trên mọi thiết bị) và phân quyền." />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setFilters({ ...filters, q: draft.trim(), page: 1 })
        }}
        role="search"
        className="mb-4 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]"
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Email hoặc tên" aria-label="Tìm người dùng" className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })} aria-label="Vai trò" className="rounded-lg border border-slate-300 bg-white px-3 py-2">
          <option value="">Mọi vai trò</option>
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })} aria-label="Trạng thái" className="rounded-lg border border-slate-300 bg-white px-3 py-2">
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </form>
      {message && (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Người dùng</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
            <th>2FA</th>
            <th>Tạo lúc</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.users.map((user) => {
            const isMe = user.id === me?.id
            return (
              <tr key={user.id}>
                <td>
                  <p className="font-medium">{[user.lastName, user.firstName].filter(Boolean).join(' ') || '—'}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.map((role) => (
                      <span key={role} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {ROLE_LABELS[role] ?? role}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  {user.status === 'PENDING_VERIFICATION' ? (
                    <span className="text-xs text-slate-500">{STATUS_LABELS[user.status]}</span>
                  ) : (
                    <StatusBadge status={user.status} />
                  )}
                  {user.loginLockedUntil && (
                    <p className="mt-1 text-xs text-amber-700" title="Nhập sai mật khẩu nhiều lần">
                      Tạm khóa đăng nhập tới {formatDateTime(user.loginLockedUntil)}
                    </p>
                  )}
                </td>
                <td className="text-xs">
                  {user.twoFactorEnabled ? <span className="font-semibold text-emerald-700">Bật</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap text-slate-600">{formatDateTime(user.createdAt)}</td>
                <td className="whitespace-nowrap text-right">
                  {isMe ? (
                    <span className="text-xs text-slate-400">Bạn</span>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => setEditingRoles(user)}>
                        Phân quyền
                      </Button>
                      {user.loginLockedUntil && (
                        <Button variant="ghost" onClick={() => void unlockLogin(user)}>
                          Mở khóa đăng nhập
                        </Button>
                      )}
                      {user.twoFactorEnabled && (
                        <Button variant="ghost" onClick={() => setResetting(user)}>
                          Đặt lại 2FA
                        </Button>
                      )}
                      {user.status === 'SUSPENDED' ? (
                        <Button variant="ghost" onClick={() => void reactivate(user)}>
                          Mở khóa
                        </Button>
                      ) : (
                        <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setSuspending(user)}>
                          Khóa
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
          {list.data?.users.length === 0 && <EmptyRow colSpan={6}>Không có người dùng nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />

      {suspending && (
        <ConfirmDialog
          open
          title={`Khóa tài khoản ${suspending.email}?`}
          message="Người này bị đăng xuất ngay trên mọi thiết bị và không đăng nhập được cho tới khi mở khóa."
          confirmLabel="Khóa tài khoản"
          danger
          askReason
          onClose={() => setSuspending(null)}
          onConfirm={async (reason) => {
            try {
              await setUserStatus(suspending.id, 'SUSPENDED', reason)
            } catch (err) {
              throw toApiError(err)
            }
            setMessage({ tone: 'success', text: `Đã khóa ${suspending.email}.` })
            list.reload()
          }}
        />
      )}
      {resetting && (
        <ConfirmDialog
          open
          title={`Đặt lại xác thực hai lớp của ${resetting.email}?`}
          message="Dùng khi người này mất điện thoại và mã khôi phục. Xác thực hai lớp bị tắt, họ bị đăng xuất khỏi mọi thiết bị và nhận email báo; quản trị viên sẽ phải thiết lập lại ở lần đăng nhập tới."
          confirmLabel="Đặt lại 2FA"
          danger
          askReason
          onClose={() => setResetting(null)}
          onConfirm={async (reason) => {
            try {
              await resetUserTwoFactor(resetting.id, reason)
            } catch (err) {
              throw toApiError(err)
            }
            setMessage({ tone: 'success', text: `Đã đặt lại xác thực hai lớp của ${resetting.email}.` })
            list.reload()
          }}
        />
      )}
      {editingRoles && (
        <RolesDialog
          user={editingRoles}
          onClose={() => setEditingRoles(null)}
          onSaved={(updated) => {
            setMessage({ tone: 'success', text: `Đã cập nhật quyền của ${updated.email}.` })
            list.reload()
          }}
        />
      )}
    </>
  )
}

function RolesDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: (user: AdminUser) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [roles, setRoles] = useState<Role[]>(user.roles.filter((r) => r !== 'CUSTOMER'))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await setUserRoles(user.id, roles))
      onClose()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const removing = user.roles.some((r) => r !== 'CUSTOMER' && !roles.includes(r))

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,26rem)] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Phân quyền: {user.email}</h2>
        {error && <Alert>{error}</Alert>}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" checked disabled /> Khách hàng (luôn có)
          </label>
          {GRANTABLE.map((role) => (
            <label key={role} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={roles.includes(role)}
                onChange={(e) => setRoles(e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))}
              />
              <span>
                {ROLE_LABELS[role]}
                {ROLE_HINTS[role] && <span className="block text-xs text-slate-500">{ROLE_HINTS[role]}</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {removing
            ? 'Bỏ bớt quyền: người này bị đăng xuất ngay để quyền mất hiệu lực.'
            : 'Quyền mới có hiệu lực khi người này đăng nhập lại hoặc làm mới phiên.'}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Thôi
          </Button>
          <Button type="submit" loading={busy}>
            Lưu
          </Button>
        </div>
      </form>
    </dialog>
  )
}
