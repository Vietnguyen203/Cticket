import { useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import { listCategories } from '../api/events'
import type { EventInput } from '../api/organizer'
import type { EventDetail } from '../api/types'
import { ImageField } from '../components/ImageField'
import { Alert, Button, TextField } from '../components/ui'
import { useAsync } from '../utils/useAsync'

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
export function EventInfoForm({ event, onSubmit, submitLabel }: { event?: EventDetail; onSubmit: (input: Partial<EventInput>) => Promise<void>; submitLabel: string }) {
  const categories = useAsync(listCategories, 'categories')
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
    for (const key of Object.keys(all) as Array<keyof EventInput>) {
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
          label="Ảnh bìa (ngang, ví dụ 1920×640)"
          name="bannerUrl"
          value={form.bannerUrl}
          disabled={locked('bannerUrl')}
          onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
          error={fieldErrors.bannerUrl ? 'Link ảnh không hợp lệ.' : undefined}
        />
        <ImageField
          label="Ảnh nhỏ (cho danh sách, ví dụ 800×450)"
          name="thumbnailUrl"
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
      <fieldset disabled={locked('categoryIds')}>
        <legend className="mb-2 text-sm font-medium text-slate-700">Danh mục (chọn ít nhất một)</legend>
        <div className="flex flex-wrap gap-2">
          {categories.data?.map((category) => (
            <label
              key={category.id}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${
                form.categoryIds.includes(category.id) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              <input type="checkbox" className="sr-only" checked={form.categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />
              {category.name}
            </label>
          ))}
        </div>
        {fieldErrors.categoryIds && <p className="mt-1 text-sm text-red-600">Chọn ít nhất một danh mục.</p>}
      </fieldset>
      <Button type="submit" loading={busy} disabled={!form.title.trim() || form.categoryIds.length === 0 || nothingToSave}>
        {submitLabel}
      </Button>
    </form>
  )
}
