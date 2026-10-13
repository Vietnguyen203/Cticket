import { useState, type FormEvent } from 'react'
import { toApiError } from '../api/errors'
import { addStaff, listStaff, removeStaff } from '../api/organizer'
import { EmptyRow, TableCard } from '../admin/components'
import { Alert, Button, Card, TextField } from '../components/ui'
import { formatDateTime } from '../utils/format'
import { useAsync } from '../utils/useAsync'

/** Gate staff of the event (Phase 10): they may scan tickets of THIS event only. */
export function StaffPanel({ eventId }: { eventId: string }) {
  const staff = useAsync(() => listStaff(eventId), `staff:${eventId}`)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const member = await addStaff(eventId, email.trim())
      setInfo(`Đã thêm ${member.email}. Người này cần đăng nhập lại để có quyền soát vé.`)
      setEmail('')
      staff.reload()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(userId: string) {
    setError(null)
    try {
      await removeStaff(eventId, userId)
      staff.reload()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField label="Email tài khoản nhân viên" name="staffEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
          <Button type="submit" loading={busy} disabled={!email.trim()}>
            Thêm nhân viên
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Người được thêm phải có tài khoản đang hoạt động; họ được cấp quyền soát vé cho sự kiện này.</p>
      </Card>
      {error && <Alert>{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Nhân viên</th>
            <th>Email</th>
            <th>Thêm lúc</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {staff.data?.map((member) => (
            <tr key={member.userId}>
              <td className="font-medium">
                {member.lastName} {member.firstName}
              </td>
              <td className="text-slate-600">{member.email}</td>
              <td className="whitespace-nowrap text-slate-600">{formatDateTime(member.assignedAt)}</td>
              <td className="text-right">
                <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void remove(member.userId)}>
                  Gỡ
                </Button>
              </td>
            </tr>
          ))}
          {staff.data?.length === 0 && <EmptyRow colSpan={4}>Chưa có nhân viên soát vé.</EmptyRow>}
        </tbody>
      </TableCard>
    </div>
  )
}
