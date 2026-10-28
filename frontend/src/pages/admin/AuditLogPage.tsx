import { useState, type FormEvent } from 'react'
import { listAuditActions, listAuditLogs, type AuditFilters, type AuditLog } from '../../api/admin'
import { EmptyRow, PageHeader, Pagination, TableCard } from '../../admin/components'
import { Alert, Button } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'
import { fromVnInput } from '../../utils/vnTime'

const ENTITY_TYPES: Record<string, string> = {
  event: 'Sự kiện',
  order: 'Đơn hàng',
  user: 'Người dùng',
  organizer: 'Nhà tổ chức',
  venue: 'Địa điểm',
  ticket: 'Vé',
  schedule: 'Suất diễn',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** AUD-02: who changed what, when (read only: the database refuses edits of this table). */
export function AuditLogPage() {
  const actions = useAsync(listAuditActions, 'audit-actions')
  const [draft, setDraft] = useState({ entityType: '', action: '', entityId: '', from: '', to: '' })
  const [filters, setFilters] = useState<AuditFilters>({ page: 1 })
  const [open, setOpen] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const list = useAsync(() => listAuditLogs({ ...filters, pageSize: 30 }), JSON.stringify(filters))

  function apply(e: FormEvent) {
    e.preventDefault()
    if (draft.entityId && !UUID.test(draft.entityId.trim())) return setProblem('Mã đối tượng phải là UUID (ví dụ id của sự kiện, đơn hàng).')
    setProblem(null)
    setFilters({
      entityType: draft.entityType || undefined,
      action: draft.action || undefined,
      entityId: draft.entityId.trim() || undefined,
      from: draft.from ? fromVnInput(`${draft.from}T00:00`) : undefined,
      to: draft.to ? fromVnInput(`${draft.to}T23:59`) : undefined,
      page: 1,
    })
  }

  return (
    <>
      <PageHeader title="Audit log" subtitle="" />
      <form onSubmit={apply} className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })} aria-label="Loại đối tượng" className="rounded-lg border border-slate-300 bg-surface px-3 py-2">
          <option value="">Mọi đối tượng</option>
          {Object.entries(ENTITY_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} aria-label="Hành động" className="rounded-lg border border-slate-300 bg-surface px-3 py-2">
          <option value="">Mọi hành động</option>
          {actions.data?.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
        <input value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })} placeholder="Id đối tượng" aria-label="Id đối tượng" className="rounded-lg border border-slate-300 bg-surface px-3 py-2" />
        <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="Từ ngày" className="rounded-lg border border-slate-300 bg-surface px-3 py-2" />
        <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="Đến ngày" className="rounded-lg border border-slate-300 bg-surface px-3 py-2" />
        <Button type="submit" variant="secondary">
          Lọc
        </Button>
      </form>
      {problem && <Alert>{problem}</Alert>}
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Lúc</th>
            <th>Người làm</th>
            <th>Hành động</th>
            <th>Đối tượng</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.auditLogs.map((log) => (
            <Row key={log.id} log={log} open={open === log.id} onToggle={() => setOpen(open === log.id ? null : log.id)} />
          ))}
          {list.data?.auditLogs.length === 0 && <EmptyRow colSpan={5}>Không có mục nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
    </>
  )
}

function Row({ log, open, onToggle }: { log: AuditLog; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td className="whitespace-nowrap text-slate-600">{formatDateTime(log.createdAt)}</td>
        <td className="text-slate-600">{log.userEmail ?? <span className="text-slate-500">hệ thống</span>}</td>
        <td className="font-mono text-xs">{log.action}</td>
        <td className="text-xs text-slate-600">
          {ENTITY_TYPES[log.entityType] ?? log.entityType}
          <p className="font-mono text-[11px] text-slate-500">{log.entityId}</p>
        </td>
        <td className="text-right">
          <Button variant="ghost" onClick={onToggle} aria-expanded={open}>
            {open ? 'Ẩn' : 'Chi tiết'}
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-slate-50">
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-slate-500">Trước</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface p-2 ring-1 ring-slate-200">{JSON.stringify(log.oldValue, null, 2) ?? '—'}</pre>
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-500">Sau</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface p-2 ring-1 ring-slate-200">{JSON.stringify(log.newValue, null, 2) ?? '—'}</pre>
              </div>
            </div>
            {log.ipAddress && <p className="mt-2 text-xs text-slate-500">IP: {log.ipAddress}</p>}
          </td>
        </tr>
      )}
    </>
  )
}
