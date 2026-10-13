import { useNavigate } from 'react-router'
import { createEvent, type EventInput } from '../../api/organizer'
import { PageHeader } from '../../admin/components'
import { Card } from '../../components/ui'
import { EventInfoForm } from '../../organizer/EventInfoForm'

/** Step 1 of a new event: its information. Schedules and tickets come next, in the editor. */
export function NewEventPage() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Tạo sự kiện" subtitle="Bước 1: thông tin. Sau đó thêm suất diễn, hạng vé, gán ghế rồi gửi duyệt." />
      <Card>
        <EventInfoForm
          submitLabel="Tạo và tiếp tục"
          onSubmit={async (input) => {
            const event = await createEvent(input as EventInput)
            navigate(`/organizer/events/${event.id}?tab=schedules`, { replace: true })
          }}
        />
      </Card>
    </>
  )
}
