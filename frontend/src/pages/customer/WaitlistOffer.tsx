import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toApiError } from '../../api/errors'
import type { TicketTypeAvailability } from '../../api/types'
import { joinWaitlist } from '../../api/waitlist'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card } from '../../components/ui'

const MAX_TICKETS_PER_ORDER = 8

/**
 * Phase 18.4, on the seat map: sold-out ticket types (for this viewer) get
 * "Báo tôi khi có vé". When places free up, the earliest people get an email
 * and 30 minutes in which those places are kept for them.
 */
export function WaitlistOffer({ scheduleId, ticketTypes }: { scheduleId: string; ticketTypes: TicketTypeAvailability[] }) {
  const soldOut = ticketTypes.filter((tt) => tt.status === 'ACTIVE' && tt.available === 0)
  if (soldOut.length === 0) return null
  return (
    <Card className="space-y-3 !p-4">
      <p className="text-sm font-semibold">Hết vé? Vào danh sách chờ</p>
      <p className="text-xs text-slate-500">
        Khi có vé trả lại (đơn hết hạn, khách hủy…), người đăng ký sớm nhất nhận email và được giữ vé 30 phút để đặt.
      </p>
      {soldOut.map((tt) => (
        <SoldOutRow key={tt.id} scheduleId={scheduleId} ticketType={tt} />
      ))}
    </Card>
  )
}

function SoldOutRow({ scheduleId, ticketType }: { scheduleId: string; ticketType: TicketTypeAvailability }) {
  const { status } = useAuth()
  const location = useLocation()
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const max = Math.min(ticketType.maxPerOrder, MAX_TICKETS_PER_ORDER)

  async function join() {
    setBusy(true)
    setResult(null)
    try {
      const entry = await joinWaitlist(scheduleId, ticketType.id, quantity)
      setResult({ tone: 'success', text: `Đã vào danh sách chờ, bạn đứng thứ ${entry.position ?? 1}.` })
    } catch (err) {
      setResult({ tone: 'error', text: toApiError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          <span className="font-medium">{ticketType.name}</span>
          {ticketType.waitlistKept ? (
            <span className="block text-xs text-amber-700">{ticketType.waitlistKept} vé đang được giữ cho người trong danh sách chờ</span>
          ) : null}
        </span>
        {status === 'authenticated' ? (
          <span className="flex items-center gap-2">
            <select
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-label={`Số vé ${ticketType.name} muốn mua`}
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
            >
              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} vé
                </option>
              ))}
            </select>
            <Button variant="secondary" loading={busy} onClick={() => void join()}>
              Báo tôi khi có vé
            </Button>
          </span>
        ) : (
          <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="text-sm font-semibold text-brand-700 hover:underline">
            Đăng nhập để vào danh sách chờ
          </Link>
        )}
      </div>
      {result && (
        <Alert tone={result.tone}>
          {result.text}{' '}
          {result.tone === 'success' && (
            <Link to="/waitlist" className="font-semibold underline">
              Xem danh sách chờ
            </Link>
          )}
        </Alert>
      )}
    </div>
  )
}
