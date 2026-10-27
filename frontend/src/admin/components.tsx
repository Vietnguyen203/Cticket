import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { PageMeta } from '../api/types'
import { Alert, Button } from '../components/ui'

/** Building blocks of the admin pages. */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
}

/** Status label: Vietnamese text + colour, for every status used in the admin pages. */
const STATUS: Record<string, [string, keyof typeof TONES]> = {
  // organizers / users / venues
  PENDING: ['Chờ duyệt', 'amber'],
  ACTIVE: ['Hoạt động', 'green'],
  SUSPENDED: ['Tạm khóa', 'red'],
  REJECTED: ['Từ chối', 'gray'],
  INACTIVE: ['Ngừng dùng', 'gray'],
  DELETED: ['Đã xóa tài khoản', 'gray'], // users: deleted by their owner
  // PENDING (venues proposed by organizers) shares "Chờ duyệt" above
  // events
  DRAFT: ['Nháp', 'gray'],
  PENDING_APPROVAL: ['Chờ duyệt', 'amber'],
  PUBLISHED: ['Đang bán', 'green'],
  CANCELLED: ['Đã hủy', 'red'],
  FINISHED: ['Đã diễn', 'blue'],
  // promotions
  EXPIRED: ['Hết hạn', 'gray'],
  // schedules
  SCHEDULED: ['Sắp diễn', 'blue'],
}

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, 'gray']
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-transparent ${TONES[tone]}`}>{label}</span>
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {options.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          type="button"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
            value === key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ meta, onPage }: { meta: PageMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Trang {meta.page}/{meta.totalPages} · {meta.total} mục
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Trước
        </Button>
        <Button variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  )
}

/** A white box holding a table; scrolls sideways on small screens. */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_tbody_tr]:align-top [&_tbody]:divide-y [&_tbody]:divide-slate-100">
        {children}
      </table>
    </div>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-slate-500">
        {children}
      </td>
    </tr>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel: string
  danger?: boolean
  /** Ask for a reason (required by the API for rejections, cancellations…). */
  askReason?: boolean
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

const MIN_REASON = 3

/** Native <dialog>: focus trap, Esc to close and a backdrop for free. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, askReason, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      setReason('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        {message && <div className="text-sm text-slate-600">{message}</div>}
        {error && <Alert>{error}</Alert>}
        {askReason && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Lý do</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              minLength={MIN_REASON}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Thôi
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={askReason && reason.trim().length < MIN_REASON}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
