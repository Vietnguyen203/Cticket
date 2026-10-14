import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createCategory, deleteCategory, getCategoryUsage, updateCategory } from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { listCategories } from '../../api/events'
import type { Category } from '../../api/types'
import { ConfirmDialog, EmptyRow, PageHeader, TableCard } from '../../admin/components'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

export function CategoriesPage() {
  const [round, setRound] = useState(0)
  const list = useAsync(listCategories, `categories:${round}`)
  const usage = useAsync(getCategoryUsage, `category-usage:${round}`)
  const [name, setName] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const reload = () => setRound((r) => r + 1)

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createCategory({ name: name.trim() })
      setName('')
      reload()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Danh mục"
        subtitle="Nhóm sự kiện (âm nhạc, thể thao…). Đổi tên áp dụng ngay cho mọi sự kiện dùng danh mục đó. Xóa một danh mục thì nó được gỡ khỏi các sự kiện đang dùng."
      />
      <Card className="mb-4">
        <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField label="Tên danh mục mới" name="name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Thêm
          </Button>
        </form>
      </Card>
      {(error ?? list.error ?? usage.error) && (
        <div className="mb-4">
          <Alert>{(error ?? list.error ?? usage.error)?.message}</Alert>
        </div>
      )}
      <TableCard>
        <thead>
          <tr>
            <th>Tên</th>
            <th>Số sự kiện</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.map((category) => {
            const events = usage.data?.[category.id] ?? 0
            return (
              <tr key={category.id}>
                <td>
                  <p className="font-medium">{category.name}</p>
                  {category.description && <p className="text-xs text-slate-500">{category.description}</p>}
                </td>
                <td className="tabular-nums">{usage.data ? events : '…'}</td>
                <td className="whitespace-nowrap text-right !py-1.5">
                  <Button variant="ghost" onClick={() => setEditing(category)}>
                    Sửa
                  </Button>
                  <Button variant="ghost" className="text-red-600 hover:bg-red-50" disabled={!usage.data} onClick={() => setDeleting(category)}>
                    Xóa
                  </Button>
                </td>
              </tr>
            )
          })}
          {list.data?.length === 0 && <EmptyRow colSpan={3}>Chưa có danh mục nào.</EmptyRow>}
        </tbody>
      </TableCard>

      {editing && (
        <EditCategoryDialog
          category={editing}
          events={usage.data?.[editing.id] ?? 0}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Xóa danh mục "${deleting?.name ?? ''}"?`}
        message={deleteMessage(deleting ? (usage.data?.[deleting.id] ?? 0) : 0)}
        confirmLabel="Xóa"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteCategory(deleting.id)
          } catch (err) {
            throw toApiError(err)
          }
          reload()
        }}
      />
    </>
  )
}

/** What deleting does to the events that use the category (they keep everything else). */
function deleteMessage(events: number): string {
  if (events === 0) return 'Chưa có sự kiện nào dùng danh mục này.'
  return `${events} sự kiện đang dùng danh mục này sẽ bị gỡ danh mục. Sự kiện chỉ có danh mục này sẽ không còn danh mục nào cho tới khi ban tổ chức chọn lại. Không hoàn tác được.`
}

/** Name and description (the slug follows the name on the server). */
function EditCategoryDialog({ category, events, onClose, onSaved }: { category: Category; events: number; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [form, setForm] = useState({ name: category.name, description: category.description ?? '' })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const changes = {
    ...(form.name.trim() !== category.name ? { name: form.name.trim() } : {}),
    ...(form.description.trim() !== (category.description ?? '') ? { description: form.description.trim() || null } : {}),
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateCategory(category.id, changes)
      onSaved()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,30rem)] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Sửa danh mục</h2>
        {error && <Alert>{error.message}</Alert>}
        <TextField label="Tên" name="categoryName" value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Mô tả (không bắt buộc)</span>
          <textarea
            value={form.description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        {events > 0 && <p className="text-xs text-slate-500">{events} sự kiện đang dùng danh mục này sẽ hiện tên mới ngay.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Thôi
          </Button>
          <Button type="submit" loading={busy} disabled={!form.name.trim() || Object.keys(changes).length === 0}>
            Lưu
          </Button>
        </div>
      </form>
    </dialog>
  )
}
