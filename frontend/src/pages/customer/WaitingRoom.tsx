import { useState } from 'react'
import { toApiError } from '../../api/errors'
import type { QueueView } from '../../api/queue'
import { Alert, Button, Card } from '../../components/ui'
import { formatWait, queueProgress, tryNowMessage } from '../../queue/waitingRoom'
import { useCooldown } from '../../utils/useCooldown'

/** "Vào ngay" can be pressed again after this long (the line is checked every 5 s anyway). */
const TRY_AGAIN_SECONDS = 10

/**
 * Phase 21: shown instead of the seat map while I wait for my turn in the
 * event's purchase queue. The page moves on by itself when it is my turn.
 * "Vào ngay": the server looks again at once; with room I go straight in
 * (the seat map appears), otherwise I am told and keep my place.
 */
export function WaitingRoom({
  eventTitle,
  view,
  firstPlace,
  onLeave,
  onTryNow,
}: {
  eventTitle: string
  view: QueueView
  firstPlace: number | null
  onLeave: () => void
  onTryNow: () => Promise<{ admitted: boolean; buying: number | null }>
}) {
  const progress = queueProgress(firstPlace, view.place)
  const [trying, setTrying] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const cooldown = useCooldown(TRY_AGAIN_SECONDS)

  async function tryNow() {
    setTrying(true)
    setRefused(null)
    try {
      const { admitted, buying } = await onTryNow()
      // Admitted: the seat page shows the seat map in place of this one.
      if (!admitted) {
        setRefused(tryNowMessage(buying, view.capacity ?? null))
        cooldown.start()
      }
    } catch (err) {
      setRefused(toApiError(err).message)
      cooldown.start()
    } finally {
      setTrying(false)
    }
  }
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
          <div className="relative h-full overflow-hidden rounded-full bg-brand-600 transition-all duration-700" style={{ width: `${Math.max(progress, 4)}%` }}>
            {/* A light sweep: the line is moving even when the place has not changed yet. */}
            <span className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent_25%,rgb(255_255_255/0.35)_50%,transparent_75%)] bg-[length:200%_100%]" />
          </div>
        </div>

        <ul className="space-y-1 text-left text-sm text-slate-600">
          <li>• Đừng tải lại trang. Nếu lỡ tải lại hay đóng tab, bạn vẫn giữ nguyên vị trí khi quay lại.</li>
          <li>• Tới lượt, sơ đồ ghế tự hiện ra. Bạn có {view.sessionMinutes ?? 10} phút để chọn và giữ chỗ.</li>
        </ul>

        {refused && (
          <div className="text-left">
            <Alert tone="warning">{refused}</Alert>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void tryNow()} loading={trying} disabled={cooldown.remaining > 0}>
            {cooldown.remaining > 0 ? `Vào ngay (thử lại sau ${cooldown.remaining} giây)` : 'Vào ngay'}
          </Button>
          <Button variant="secondary" onClick={onLeave}>
            Rời hàng chờ
          </Button>
        </div>
      </Card>
    </div>
  )
}
