import { useState } from 'react'
import { Link } from 'react-router'
import { cancelPaidOrder, getCancellationTerms, type CancellationTerms } from '../../api/orders'
import { toApiError } from '../../api/errors'
import { ConfirmDialog } from '../../admin/components'
import { Button, Card } from '../../components/ui'
import { CANCEL_REFUSALS, refundPolicyOf } from '../../payments/refundPolicy'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/**
 * Phase 18.3: on a paid order, what cancelling now would give back (the
 * event's refund policy), and the button. The amount shown is the amount sent:
 * if a tier ended meanwhile, the API refuses and the new terms are shown.
 */
export function CancelOrderCard({ orderId, onCancelled }: { orderId: string; onCancelled: () => void }) {
  const loaded = useAsync(() => getCancellationTerms(orderId), `cancellation:${orderId}`)
  const [changed, setChanged] = useState<CancellationTerms | null>(null)
  const [confirming, setConfirming] = useState(false)
  const terms = changed ?? loaded.data
  if (!terms) return null
  const policy = refundPolicyOf(terms.policy)

  if (!terms.allowed) {
    // Paid orders of events without a policy: say it once, quietly.
    return (
      <Card className="text-sm text-slate-600">
        <p>
          <span className="font-semibold text-slate-800">Chính sách hủy: {policy.label}.</span> {CANCEL_REFUSALS[terms.reason ?? ''] ?? ''}{' '}
          <Link to="/dieu-khoan#huy-va-hoan-tien" className="font-semibold text-brand-700 hover:underline">
            Điều kiện hủy và hoàn tiền
          </Link>
        </p>
      </Card>
    )
  }

  return (
    <Card className="space-y-3 text-sm">
      <h2 className="font-semibold">Hủy đơn</h2>
      <p className="text-slate-700">
        Chính sách <strong>{policy.label}</strong>: hủy bây giờ được hoàn <strong>{formatVnd(terms.refundAmount ?? 0)}</strong> ({terms.percent}%)
        {terms.fee ? `, phí hủy ${formatVnd(terms.fee)}` : ''}.
        {terms.tierEndsAt && ` Mức này áp dụng tới ${formatDateTime(terms.tierEndsAt)}.`}
      </p>
      {changed && <p className="text-amber-700">Mức hoàn vừa thay đổi vì đã qua mốc thời gian. Kiểm tra lại số tiền trước khi hủy.</p>}
      <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setConfirming(true)}>
        Hủy đơn và hoàn tiền
      </Button>
      {confirming && (
        <ConfirmDialog
          open
          title="Hủy đơn này?"
          message={`Bạn được hoàn ${formatVnd(terms.refundAmount ?? 0)}${terms.fee ? ` (phí hủy ${formatVnd(terms.fee)})` : ''}. Vé của đơn hết hiệu lực ngay, ghế được mở bán lại. Không hoàn tác được. Lượt mã giảm giá đã dùng không được trả lại.`}
          confirmLabel="Hủy đơn"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await cancelPaidOrder(orderId, terms.refundAmount ?? 0)
            } catch (err) {
              const apiError = toApiError(err)
              if (apiError.code === 'REFUND_TERMS_CHANGED') {
                setConfirming(false)
                setChanged({ ...terms, ...(apiError.details as Partial<CancellationTerms>) })
                return
              }
              throw apiError
            }
            onCancelled()
          }}
        />
      )}
    </Card>
  )
}
