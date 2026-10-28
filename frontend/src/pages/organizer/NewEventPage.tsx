import { useState } from 'react'
import { useNavigate } from 'react-router'
import { createEvent, type EventInput } from '../../api/organizer'
import { PageHeader } from '../../admin/components'
import { Card } from '../../components/ui'
import { EventInfoForm } from '../../organizer/EventInfoForm'
import { QueueFields } from '../../organizer/PurchaseQueueCard'
import { DEFAULT_QUEUE_FORM, queueInput, queueProblems } from '../../organizer/purchaseQueueForm'

/**
 * Step 1 of a new event: its information, and (Phase 21) its purchase queue,
 * so a rush can be planned from the start. Schedules and tickets come next,
 * in the editor (where the queue can still be changed, also while selling).
 */
export function NewEventPage() {
  const navigate = useNavigate()
  const [queue, setQueue] = useState(DEFAULT_QUEUE_FORM)
  return (
    <>
      <PageHeader title="Tạo sự kiện" subtitle="Bước 1: thông tin. Sau đó thêm suất diễn, hạng vé, gán ghế rồi gửi duyệt." />
      <Card>
        <EventInfoForm
          submitLabel="Tạo và tiếp tục"
          onSubmit={async (input) => {
            const problems = queueProblems(queue)
            if (queue.enabled && (problems.capacity || problems.minutes)) throw new Error(`Hàng chờ mua vé: ${problems.capacity ?? problems.minutes}`)
            const event = await createEvent({ ...(input as EventInput), ...(queue.enabled ? queueInput(queue) : {}) })
            navigate(`/organizer/events/${event.id}?tab=schedules`, { replace: true })
          }}
        >
          <fieldset className="space-y-3 rounded-card border border-line p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Hàng chờ mua vé (không bắt buộc)</legend>
            <p className="text-sm text-slate-600">
              Bật khi dự kiến đông khách lúc mở bán: chỉ một số người được chọn chỗ cùng lúc, người đến sau xếp hàng và tự vào theo thứ tự. Sửa
              được sau, kể cả khi đang bán.
            </p>
            <QueueFields form={queue} onChange={setQueue} />
          </fieldset>
        </EventInfoForm>
      </Card>
    </>
  )
}
