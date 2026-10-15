import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { toApiError } from '../../api/errors'
import {
  deleteMyReview,
  deleteReply,
  getMyReview,
  listEventReviews,
  replyToReview,
  saveMyReview,
  type Review,
  type ReviewSort,
} from '../../api/reviews'
import { Pagination } from '../../admin/components'
import { hasAny } from '../../admin/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card } from '../../components/ui'
import { Stars } from '../../components/Stars'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const SORTS: Array<[ReviewSort, string]> = [
  ['newest', 'Mới nhất'],
  ['highest', 'Điểm cao'],
  ['lowest', 'Điểm thấp'],
]
const CANNOT_REVIEW: Record<string, string> = {
  NOT_ATTENDED: 'Chỉ người đã vào cổng xem sự kiện này mới đánh giá được.',
  CLOSED: 'Đã quá 60 ngày sau buổi diễn: không viết hoặc sửa đánh giá được nữa.',
  EVENT_CANCELLED: 'Sự kiện đã bị hủy.',
}

/**
 * Phase 19: the event page's reviews: average and distribution, the list
 * (sort / filter / pages), my review (write, change, delete), and the
 * organizer's replies (the event's organizer and admins answer here).
 */
export function EventReviews({ eventId, slug }: { eventId: string; slug: string }) {
  const { user, status } = useAuth()
  const [query, setQuery] = useState<{ sort: ReviewSort; rating?: number; page: number }>({ sort: 'newest', page: 1 })
  const [round, setRound] = useState(0)
  const list = useAsync(() => listEventReviews(slug, { ...query, pageSize: 10 }), `reviews:${slug}:${JSON.stringify(query)}:${round}:${status}`)
  const reload = () => setRound((r) => r + 1)
  // Coming from "Đánh giá sự kiện" (#danh-gia): scroll here once the reviews are shown.
  const { hash } = useLocation()
  const loaded = Boolean(list.data)
  useEffect(() => {
    if (hash === '#danh-gia' && loaded) document.getElementById('danh-gia')?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, loaded])
  const canWrite = status === 'authenticated' && hasAny(user, ['review:create'])
  const data = list.data
  const summary = data?.summary

  return (
    <section id="danh-gia" className="space-y-4">
      <h2 className="text-lg font-semibold">Đánh giá</h2>
      {summary && (
        <Card className="flex flex-wrap items-center gap-6 !p-4">
          <div className="text-center">
            <p className="text-3xl font-bold">{summary.average != null ? summary.average.toLocaleString('vi-VN') : '—'}</p>
            <Stars value={summary.average ?? 0} />
            <p className="text-xs text-slate-500">{summary.count} đánh giá</p>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            {[5, 4, 3, 2, 1].map((stars) => {
              const n = summary.distribution[stars] ?? 0
              return (
                <button
                  key={stars}
                  type="button"
                  onClick={() => setQuery({ ...query, rating: query.rating === stars ? undefined : stars, page: 1 })}
                  className={`flex w-full items-center gap-2 text-xs ${query.rating === stars ? 'font-semibold text-brand-800' : 'text-slate-600'}`}
                  aria-pressed={query.rating === stars}
                >
                  <span className="w-8 text-right">{stars} ★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                    <span className="block h-full bg-amber-400" style={{ width: `${summary.count ? (n / summary.count) * 100 : 0}%` }} />
                  </span>
                  <span className="w-6 text-left">{n}</span>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      {canWrite && <MyReviewBox eventId={eventId} onChanged={reload} />}

      {data && data.reviews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {SORTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setQuery({ ...query, sort: value, page: 1 })}
              className={`rounded-full border px-3 py-1 ${query.sort === value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
          {query.rating && (
            <button type="button" onClick={() => setQuery({ ...query, rating: undefined, page: 1 })} className="text-brand-700 hover:underline">
              Bỏ lọc {query.rating} ★
            </button>
          )}
        </div>
      )}
      {list.error && <Alert>{list.error.message}</Alert>}
      {data && data.reviews.length === 0 && <p className="text-sm text-slate-500">Chưa có đánh giá nào{query.rating ? ` ${query.rating} sao` : ''}.</p>}
      <div className="space-y-3">
        {data?.reviews.map((review) => (
          <ReviewItem key={review.id} review={review} canReply={data.canReply} onChanged={reload} />
        ))}
      </div>
      <Pagination meta={data?.meta} onPage={(page) => setQuery({ ...query, page })} />
    </section>
  )
}

function ReviewItem({ review, canReply, onChanged }: { review: Review; canReply: boolean; onChanged: () => void }) {
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState(review.reply?.text ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await replyToReview(review.id, text.trim())
      setReplying(false)
      onChanged()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <Card className="space-y-2 !p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <Stars value={review.rating} /> <span className="font-semibold">{review.authorName || 'Khách'}</span>
          {review.attended && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Đã đi xem</span>}
        </span>
        <span className="text-xs text-slate-500">{formatDateTime(review.createdAt)}</span>
      </div>
      {review.comment && <p className="whitespace-pre-line text-slate-800">{review.comment}</p>}
      {review.reply && !replying && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600">Ban tổ chức trả lời</p>
          <p className="whitespace-pre-line text-slate-800">{review.reply.text}</p>
        </div>
      )}
      {canReply && !replying && (
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={() => setReplying(true)} className="font-semibold text-brand-700 hover:underline">
            {review.reply ? 'Sửa câu trả lời' : 'Trả lời'}
          </button>
          {review.reply && (
            <button
              type="button"
              onClick={() => void deleteReply(review.id).then(onChanged, (err) => setError(toApiError(err).message))}
              className="text-red-700 hover:underline"
            >
              Xóa câu trả lời
            </button>
          )}
        </div>
      )}
      {replying && (
        <form onSubmit={submit} className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={3}
            aria-label="Câu trả lời của ban tổ chức"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!text.trim()}>
              Gửi trả lời
            </Button>
            <Button type="button" variant="ghost" onClick={() => setReplying(false)}>
              Thôi
            </Button>
          </div>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </Card>
  )
}

/** Mine: the form when I may write / change it, or why not; a hidden one with the reason. */
function MyReviewBox({ eventId, onChanged }: { eventId: string; onChanged: () => void }) {
  const [round, setRound] = useState(0)
  const mine = useAsync(() => getMyReview(eventId), `my-review:${eventId}:${round}`)
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = mine.data
  if (!data) return null
  const review = data.review
  const refresh = () => {
    setRound((r) => r + 1)
    onChanged()
  }

  function startEditing() {
    setRating(review?.rating ?? 0)
    setComment(review?.comment ?? '')
    setEditing(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveMyReview(eventId, { rating, comment: comment.trim() || null })
      setEditing(false)
      refresh()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError(null)
    try {
      await deleteMyReview(eventId)
      refresh()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  if (!review && !data.canReview) {
    // Most visitors did not go: nothing to say unless it is about the deadline.
    return data.reason === 'CLOSED' ? <p className="text-sm text-slate-500">{CANNOT_REVIEW.CLOSED}</p> : null
  }

  return (
    <Card className="space-y-3 !p-4 text-sm">
      <p className="font-semibold">Đánh giá của bạn</p>
      {review?.status === 'HIDDEN' && <Alert tone="warning">Đánh giá này đã bị quản trị viên ẩn: {review.hiddenReason}</Alert>}
      {editing ? (
        <form onSubmit={submit} className="space-y-3">
          <Stars value={rating} onChange={setRating} />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Buổi diễn thế nào? (không bắt buộc, không chèn link)"
            aria-label="Nhận xét"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={rating === 0}>
              {review ? 'Lưu' : 'Gửi đánh giá'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Thôi
            </Button>
          </div>
        </form>
      ) : review ? (
        <>
          <p>
            <Stars value={review.rating} />
          </p>
          {review.comment && <p className="whitespace-pre-line">{review.comment}</p>}
          <div className="flex gap-3 text-xs">
            {data.canReview && (
              <button type="button" onClick={startEditing} className="font-semibold text-brand-700 hover:underline">
                Sửa
              </button>
            )}
            <button type="button" onClick={() => void remove()} className="text-red-700 hover:underline">
              Xóa
            </button>
          </div>
        </>
      ) : (
        <Button onClick={startEditing}>Viết đánh giá</Button>
      )}
      {data.canReview && data.editableUntil && (
        <p className="text-xs text-slate-500">Bạn có thể viết hoặc sửa tới {formatDateTime(data.editableUntil)}.</p>
      )}
      {error && <Alert>{error}</Alert>}
    </Card>
  )
}
