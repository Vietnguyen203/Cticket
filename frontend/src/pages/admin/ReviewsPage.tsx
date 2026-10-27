import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toApiError } from '../../api/errors'
import { hideReview, listReviewsForAdmin, unhideReview, type Review } from '../../api/reviews'
import { ConfirmDialog, EmptyRow, PageHeader, Pagination, TableCard } from '../../admin/components'
import { Alert, Button } from '../../components/ui'
import { Stars } from '../../components/Stars'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** Phase 19: every review; hide one that breaks the rules (reason, audited), restore it. */
export function ReviewsPage() {
  const [draft, setDraft] = useState('')
  const [filters, setFilters] = useState({ q: '', rating: '', status: '', page: 1 })
  const [hiding, setHiding] = useState<Review | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const list = useAsync(
    () =>
      listReviewsForAdmin({
        q: filters.q || undefined,
        rating: filters.rating ? Number(filters.rating) : undefined,
        status: filters.status || undefined,
        page: filters.page,
      }),
    JSON.stringify(filters),
  )

  function search(e: FormEvent) {
    e.preventDefault()
    setFilters({ ...filters, q: draft.trim(), page: 1 })
  }

  async function restore(review: Review) {
    try {
      await unhideReview(review.id)
      setMessage({ tone: 'success', text: 'Đã hiện lại đánh giá.' })
      list.reload()
    } catch (err) {
      setMessage({ tone: 'error', text: toApiError(err).message })
    }
  }

  return (
    <>
      <PageHeader title="Đánh giá" subtitle="Đánh giá được đăng ngay; ẩn những đánh giá vi phạm (bắt buộc lý do, có ghi audit log)." />
      {message && (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      <form onSubmit={search} className="mb-4 flex flex-wrap gap-2 text-sm">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tìm theo nội dung hoặc tên sự kiện"
          aria-label="Tìm đánh giá"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        <select
          value={filters.rating}
          onChange={(e) => setFilters({ ...filters, rating: e.target.value, page: 1 })}
          aria-label="Số sao"
          className="rounded-lg border border-slate-300 bg-surface px-3 py-2"
        >
          <option value="">Mọi số sao</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} sao
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
          aria-label="Trạng thái"
          className="rounded-lg border border-slate-300 bg-surface px-3 py-2"
        >
          <option value="">Mọi trạng thái</option>
          <option value="PUBLISHED">Đang hiện</option>
          <option value="HIDDEN">Đã ẩn</option>
        </select>
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </form>
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Sự kiện</th>
            <th>Đánh giá</th>
            <th>Người viết</th>
            <th>Ngày</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.reviews.map((review) => (
            <tr key={review.id} className={review.status === 'HIDDEN' ? 'bg-slate-50 text-slate-500' : undefined}>
              <td>
                {review.event && (
                  <Link to={`/events/${review.event.slug}#danh-gia`} className="text-brand-700 hover:underline">
                    {review.event.title}
                  </Link>
                )}
              </td>
              <td className="max-w-md">
                <Stars value={review.rating} />
                {review.comment && <p className="mt-1 whitespace-pre-line text-sm">{review.comment}</p>}
                {review.status === 'HIDDEN' && <p className="mt-1 text-xs text-amber-700">Đã ẩn: {review.hiddenReason}</p>}
              </td>
              <td className="text-xs">
                <p>{review.authorName}</p>
                <p className="text-slate-500">{review.authorEmail}</p>
              </td>
              <td className="whitespace-nowrap text-xs">{formatDateTime(review.createdAt)}</td>
              <td className="whitespace-nowrap text-right">
                {review.status === 'HIDDEN' ? (
                  <Button variant="ghost" onClick={() => void restore(review)}>
                    Hiện lại
                  </Button>
                ) : (
                  <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setHiding(review)}>
                    Ẩn
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {list.data?.reviews.length === 0 && <EmptyRow colSpan={5}>Không có đánh giá nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />

      {hiding && (
        <ConfirmDialog
          open
          title="Ẩn đánh giá này?"
          message="Đánh giá không còn hiện với mọi người và không tính vào điểm trung bình. Người viết vẫn thấy, kèm lý do bạn nhập."
          confirmLabel="Ẩn đánh giá"
          danger
          askReason
          onClose={() => setHiding(null)}
          onConfirm={async (reason) => {
            try {
              await hideReview(hiding.id, reason)
            } catch (err) {
              throw toApiError(err)
            }
            setMessage({ tone: 'success', text: 'Đã ẩn đánh giá.' })
            list.reload()
          }}
        />
      )}
    </>
  )
}
