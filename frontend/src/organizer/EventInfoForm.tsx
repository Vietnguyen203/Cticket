import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, toApiError } from '../api/errors'
import { listCategories } from '../api/events'
import type { EventInput } from '../api/organizer'
import type { EventDetail } from '../api/types'
import { ImageField } from '../components/ImageField'
import { Alert, Button, TextField } from '../components/ui'
import { hasAny } from '../admin/permissions'
import { useAuth } from '../auth/AuthContext'
import { useAsync } from '../utils/useAsync'
import { missingForEvent } from './missing'

/** Once PUBLISHED, only these may still change (backend EDITABLE_WHEN_PUBLISHED). */
const EDITABLE_WHEN_PUBLISHED = new Set(['description', 'bannerUrl', 'thumbnailUrl'])

function initialForm(event?: EventDetail) {
  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    bannerUrl: event?.bannerUrl ?? '',
    thumbnailUrl: event?.thumbnailUrl ?? '',
    ageRestriction: event?.ageRestriction != null ? String(event.ageRestriction) : '',
    categoryIds: event?.categories.map((c) => c.id) ?? [],
  }
}

/** Title, description, images (links), age, categories. New event, or the info tab of the editor. */
export function EventInfoForm({
  event,
  onSubmit,
  submitLabel,
  children,
}: {
  event?: EventDetail
  onSubmit: (input: Partial<EventInput>) => Promise<void>
  submitLabel: string
  /** More fields, shown above the button (the new-event page: the purchase queue). */
  children?: ReactNode
}) {
  const [categoryRound, setCategoryRound] = useState(0)
  const categories = useAsync(listCategories, `categories:${categoryRound}`)
  // Admins fix category names from here (in a new tab), then reload the list.
  const canManageCategories = hasAny(useAuth().user, ['category:manage'])
  const [form, setForm] = useState(() => initialForm(event))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = event?.status ?? 'DRAFT'
  // DRAFT: everything; PUBLISHED: description and images; otherwise nothing (withdraw to DRAFT first).
  const locked = (field: string) => (status === 'PUBLISHED' ? !EDITABLE_WHEN_PUBLISHED.has(field) : status !== 'DRAFT')

  function input(): Partial<EventInput> {
    const all: EventInput = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      bannerUrl: form.bannerUrl.trim() || null,
      thumbnailUrl: form.thumbnailUrl.trim() || null,
      ageRestriction: form.ageRestriction ? Number(form.ageRestriction) : null,
      categoryIds: form.categoryIds,
    }
    if (!event) return all
    // Only what changed, and only what may change in this status.
    const before = initialForm(event)
    const changed: Partial<EventInput> = {}
    // The fields of this form (the purchase queue has its own card: PurchaseQueueCard).
    for (const key of Object.keys(all) as Array<keyof ReturnType<typeof initialForm>>) {
      const was = key === 'categoryIds' ? before.categoryIds.join() : String(before[key] ?? '')
      const now = key === 'categoryIds' ? all.categoryIds.join() : String(all[key] ?? '')
      if (was !== now && !locked(key)) Object.assign(changed, { [key]: all[key] })
    }
    return changed
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    setSaved(false)
    try {
      await onSubmit(input())
      setSaved(true)
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  const nothingToSave = event !== undefined && Object.keys(input()).length === 0
  const missing = missingForEvent(form, { title: locked('title'), categoryIds: locked('categoryIds') })
  const toggleCategory = (id: string) =>
    setForm((f) => ({ ...f, categoryIds: f.categoryIds.includes(id) ? f.categoryIds.filter((c) => c !== id) : [...f.categoryIds, id] }))

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error.message}</Alert>}
      {saved && nothingToSave && <Alert tone="success">Đã lưu.</Alert>}
      {status === 'PUBLISHED' && <Alert tone="info">Sự kiện đang bán: chỉ sửa được mô tả và hình ảnh.</Alert>}
      {status === 'PENDING_APPROVAL' && <Alert tone="info">Đang chờ duyệt: muốn sửa thì rút lại về nháp trước.</Alert>}
      <TextField label="Tên sự kiện" name="title" value={form.title} disabled={locked('title')} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fieldErrors.title} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Mô tả</span>
        <textarea
          value={form.description}
          disabled={locked('description')}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={6}
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100"
        />
      </label>
      <div className="grid gap-4">
        <ImageField
          label="Ảnh bìa (trang sự kiện, khung ngang 16:9)"
          name="bannerUrl"
          previewTitle={form.title}
          value={form.bannerUrl}
          disabled={locked('bannerUrl')}
          onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
          error={fieldErrors.bannerUrl ? 'Link ảnh không hợp lệ.' : undefined}
        />
        <ImageField
          label="Ảnh nhỏ (thẻ trong danh sách, khung 16:9)"
          name="thumbnailUrl"
          previewTitle={form.title}
          value={form.thumbnailUrl}
          disabled={locked('thumbnailUrl')}
          onChange={(thumbnailUrl) => setForm((f) => ({ ...f, thumbnailUrl }))}
          error={fieldErrors.thumbnailUrl ? 'Link ảnh không hợp lệ.' : undefined}
        />
      </div>
      <TextField
        label="Độ tuổi tối thiểu (để trống nếu không giới hạn)"
        name="ageRestriction"
        type="number"
        min={0}
        max={99}
        value={form.ageRestriction}
        disabled={locked('ageRestriction')}
        onChange={(e) => setForm({ ...form, ageRestriction: e.target.value })}
        error={fieldErrors.ageRestriction}
        className="sm:w-1/2"
      />
      <p className="text-sm text-slate-500">
        {' '}
        <Link to="/dieu-khoan#huy-va-hoan-tien" target="_blank" className="font-semibold text-brand-700 hover:underline">
          Xem Điều kiện giao dịch chung (Điều 5, Điều 6)
        </Link>
      </p>
      <fieldset disabled={locked('categoryIds')}>
        <legend className="mb-2 flex w-full flex-wrap items-center gap-x-3 text-sm font-medium text-slate-700">
          Danh mục (chọn ít nhất một)
          {canManageCategories && (
            <>
              <a href="/admin/categories" target="_blank" rel="noreferrer" className="font-normal text-brand-700 hover:underline">
                Quản lý danh mục ↗
              </a>
              <button type="button" onClick={() => setCategoryRound((r) => r + 1)} className="font-normal text-brand-700 hover:underline">
                Tải lại danh sách
              </button>
            </>
          )}
        </legend>
        <div className="flex flex-wrap gap-2">
          {categories.data?.length === 0 && (
            <p className="text-sm text-amber-700">
              {canManageCategories
                ? 'Chưa có danh mục nào: tạo ở "Quản lý danh mục", rồi "Tải lại danh sách".'
                : 'Chưa có danh mục nào để chọn: nhờ quản trị viên tạo danh mục trước.'}
            </p>
          )}
          {categories.error && <p className="text-sm text-red-600">Không tải được danh mục: {categories.error.message}</p>}
          {categories.data?.map((category) => (
            <label
              key={category.id}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${
                form.categoryIds.includes(category.id) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 bg-surface text-slate-700'
              }`}
            >
              <input type="checkbox" className="sr-only" checked={form.categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />
              {category.name}
            </label>
          ))}
        </div>
        {fieldErrors.categoryIds && <p className="mt-1 text-sm text-red-600">Chọn ít nhất một danh mục.</p>}
      </fieldset>
      {children}
      {/* Required only where it can still change: a published event keeps its title and categories (some older ones have none). */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={busy}
          disabled={missing.length > 0 || nothingToSave}
        >
          {submitLabel}
        </Button>
        {missing.length > 0 && !busy && <span className="text-sm text-amber-700">Còn thiếu: {missing.join(', ')}.</span>}
        {event && !nothingToSave && !busy && <span className="text-sm font-medium text-amber-700">Có thay đổi chưa lưu.</span>}
      </div>
    </form>
  )
}
