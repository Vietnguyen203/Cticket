import { useState, type FormEvent } from 'react'
import { createCategory, deleteCategory, updateCategory } from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { listCategories } from '../../api/events'
import type { Category } from '../../api/types'
import { ConfirmDialog, EmptyRow, PageHeader, TableCard } from '../../admin/components'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

export function CategoriesPage() {
  const list = useAsync(listCategories, 'categories')
  const [name, setName] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createCategory({ name: name.trim() })
      setName('')
      list.reload()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRename(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setError(null)
    try {
      await updateCategory(editing.id, { name: editing.name.trim() })
      setEditing(null)
      list.reload()
    } catch (err) {
      setError(toApiError(err))
    }
  }

  return (
    <>
      <PageHeader title="Danh mục" subtitle="Nhóm sự kiện (âm nhạc, thể thao…). Không xóa được danh mục đang có sự kiện." />
      <Card className="mb-4">
        <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField label="Tên danh mục mới" name="name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Thêm
          </Button>
        </form>
      </Card>
      {error && (
        <div className="mb-4">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <TableCard>
        <thead>
          <tr>
            <th>Tên</th>
            <th>Đường dẫn (slug)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.map((category) => (
            <tr key={category.id}>
              <td>
                {editing?.id === category.id ? (
                  <form onSubmit={onRename} className="flex gap-2">
                    <input
                      autoFocus
                      aria-label="Tên mới"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                    <Button type="submit" disabled={!editing.name.trim()}>
                      Lưu
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                      Thôi
                    </Button>
                  </form>
                ) : (
                  <span className="font-medium">{category.name}</span>
                )}
              </td>
              <td className="text-slate-500">{category.slug}</td>
              <td className="whitespace-nowrap text-right">
                <Button variant="ghost" onClick={() => setEditing({ id: category.id, name: category.name })}>
                  Sửa
                </Button>
                <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setDeleting(category)}>
                  Xóa
                </Button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <EmptyRow colSpan={3}>Chưa có danh mục nào.</EmptyRow>}
        </tbody>
      </TableCard>

      <ConfirmDialog
        open={deleting !== null}
        title={`Xóa danh mục "${deleting?.name ?? ''}"?`}
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
          list.reload()
        }}
      />
    </>
  )
}
