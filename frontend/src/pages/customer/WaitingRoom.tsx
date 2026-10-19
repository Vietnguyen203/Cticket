import type { QueueView } from '../../api/queue'
import { Button, Card } from '../../components/ui'
import { formatWait, queueProgress } from '../../queue/waitingRoom'

/**
 * Phase 21: shown instead of the seat map while I wait for my turn in the
 * event's purchase queue. The page moves on by itself when it is my turn.
 */
export function WaitingRoom({
  eventTitle,
  view,
  firstPlace,
  onLeave,
}: {
  eventTitle: string
  view: QueueView
  firstPlace: number | null
  onLeave: () => void
}) {
  const progress = queueProgress(firstPlace, view.place)
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <Card className="space-y-5 text-center">
        <div>
          <p className="text-sm text-slate-500">{eventTitle}</p>
          <h1 className="mt-1 text-xl font-bold">Bạn đang trong hàng chờ mua vé</h1>
          <p className="mt-1 text-sm text-slate-600">
            Đang có nhiều người mua cùng lúc. Mỗi lần chỉ {view.capacity ?? 'một số'} người được chọn chỗ, bạn sẽ được vào theo thứ tự.
          </p>
        </div>

        {view.place !== null ? (
          <div aria-live="polite">
            <p className="text-sm text-slate-500">Vị trí của bạn</p>
            <p className="text-5xl font-bold text-brand-700" data-testid="queue-place">
              {view.place.toLocaleString('vi-VN')}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {view.ahead === 0 ? 'Bạn là người tiếp theo' : `Còn ${(view.ahead ?? 0).toLocaleString('vi-VN')} người phía trước`}
              {view.estimatedWaitSeconds !== null && ` · ước tính ${formatWait(view.estimatedWaitSeconds)}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Đang xếp chỗ cho bạn…</p>
        )}

        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-600 transition-all duration-700" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>

        <ul className="space-y-1 text-left text-sm text-slate-600">
          <li>• Đừng tải lại trang. Nếu lỡ tải lại hay đóng tab, bạn vẫn giữ nguyên vị trí khi quay lại.</li>
          <li>• Tới lượt, sơ đồ ghế tự hiện ra. Bạn có {view.sessionMinutes ?? 10} phút để chọn và giữ chỗ.</li>
        </ul>

        <Button variant="secondary" onClick={onLeave}>
          Rời hàng chờ
        </Button>
      </Card>
    </div>
  )
}
