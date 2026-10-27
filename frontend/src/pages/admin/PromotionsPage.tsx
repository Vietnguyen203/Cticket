import { useState, type FormEvent } from 'react'
import { createPromotion, listPromotions, updatePromotion, type Promotion, type PromotionInput, type PromotionStatus } from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { DateTimeField } from '../../components/DateTimeField'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'
import { fromVnInput, toVnInput } from '../../utils/vnTime'

type Filter = 'ALL' | PromotionStatus

const discountText = (p: Promotion) =>
  p.discountType === 'PERCENTAGE'
    ? `${p.discountValue}%${p.maxDiscount ? ` (tối đa ${formatVnd(p.maxDiscount)})` : ''}`
    : formatVnd(p.discountValue)

/** PRO-02: discount codes (percentage or amount, usage limits, validity period). */
export function PromotionsPage() {
  const [status, setStatus] = useState<Filter>('ALL')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null)
  const list = useAsync(() => listPromotions({ status: status === 'ALL' ? undefined : status, page, pageSize: 20 }), `${status}:${page}`)

  return (
    <>
      <PageHeader
        title="Mã giảm giá"
        subtitle="Hai khách cùng dùng lượt cuối thì chỉ một người được (khóa dòng mã khi checkout)."
        actions={editing === null && <Button onClick={() => setEditing('new')}>Tạo mã</Button>}
      />
      {editing && (
        <PromotionForm
          key={editing === 'new' ? 'new' : editing.id}
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['ALL', 'Tất cả'],
          ['ACTIVE', 'Đang dùng'],
          ['INACTIVE', 'Tạm dừng'],
          ['EXPIRED', 'Hết hạn'],
        ]}
      />
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Mã</th>
            <th>Giảm</th>
            <th>Đã dùng</th>
            <th>Hiệu lực</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.promotions.map((p) => (
            <tr key={p.id}>
              <td>
                <p className="font-mono font-semibold">{p.code}</p>
                <p className="text-xs text-slate-500">{p.name}</p>
              </td>
              <td className="whitespace-nowrap">
                {discountText(p)}
                {p.minOrderAmount > 0 && <p className="text-xs text-slate-500">đơn từ {formatVnd(p.minOrderAmount)}</p>}
              </td>
              <td className="whitespace-nowrap text-slate-600">
                {p.usedCount}
                {p.usageLimit ? ` / ${p.usageLimit}` : ''}
                {p.perUserLimit ? <p className="text-xs">{p.perUserLimit} lần / người</p> : null}
              </td>
              <td className="whitespace-nowrap text-xs text-slate-600">
                {formatDateTime(p.startsAt)}
                <br />→ {formatDateTime(p.expiresAt)}
              </td>
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td className="text-right">
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  Sửa
                </Button>
              </td>
            </tr>
          ))}
          {list.data?.promotions.length === 0 && <EmptyRow colSpan={6}>Chưa có mã nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

function PromotionForm({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: promotion?.code ?? '',
    name: promotion?.name ?? '',
    discountType: promotion?.discountType ?? 'PERCENTAGE',
    discountValue: promotion ? String(promotion.discountValue) : '',
    maxDiscount: promotion?.maxDiscount ? String(promotion.maxDiscount) : '',
    minOrderAmount: promotion ? String(promotion.minOrderAmount) : '0',
    usageLimit: promotion?.usageLimit ? String(promotion.usageLimit) : '',
    perUserLimit: promotion?.perUserLimit ? String(promotion.perUserLimit) : '',
    startsAt: toVnInput(promotion?.startsAt),
    expiresAt: toVnInput(promotion?.expiresAt),
    status: promotion?.status ?? 'ACTIVE',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const optional = (value: string) => (value.trim() ? Number(value) : null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const startsAt = fromVnInput(form.startsAt)
    const expiresAt = fromVnInput(form.expiresAt)
    if (!startsAt || !expiresAt) return setFieldErrors({ startsAt: 'Chọn đủ ngày giờ bắt đầu và hết hạn.' })
    const input: PromotionInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      discountType: form.discountType as PromotionInput['discountType'],
      discountValue: Number(form.discountValue),
      maxDiscount: form.discountType === 'PERCENTAGE' ? optional(form.maxDiscount) : null,
      minOrderAmount: Number(form.minOrderAmount || 0),
      usageLimit: optional(form.usageLimit),
      perUserLimit: optional(form.perUserLimit),
      startsAt,
      expiresAt,
      status: form.status as PromotionStatus,
    }
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      if (promotion) {
        const { code: _code, ...changes } = input
        void _code
        await updatePromotion(promotion.id, changes)
      } else {
        await createPromotion(input)
      }
      onSaved()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
        <h2 className="font-semibold sm:col-span-3">{promotion ? `Sửa mã ${promotion.code}` : 'Tạo mã giảm giá'}</h2>
        {error && (
          <div className="sm:col-span-3">
            <Alert>{error.message}</Alert>
          </div>
        )}
        <TextField label="Mã (khách nhập)" name="code" placeholder="TET2027" value={form.code} disabled={promotion !== null} onChange={set('code')} error={fieldErrors.code} />
        <TextField label="Tên" name="promoName" value={form.name} onChange={set('name')} error={fieldErrors.name} className="sm:col-span-2" />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Kiểu giảm</span>
          <select value={form.discountType} onChange={set('discountType')} className="block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5">
            <option value="PERCENTAGE">Phần trăm (%)</option>
            <option value="FIXED_AMOUNT">Số tiền (VND)</option>
          </select>
        </label>
        <TextField
          label={form.discountType === 'PERCENTAGE' ? 'Giảm (%)' : 'Giảm (VND)'}
          name="discountValue"
          type="number"
          min={1}
          value={form.discountValue}
          onChange={set('discountValue')}
          error={fieldErrors.discountValue}
        />
        <TextField
          label="Giảm tối đa (VND, không bắt buộc)"
          name="maxDiscount"
          type="number"
          min={1}
          disabled={form.discountType !== 'PERCENTAGE'}
          value={form.maxDiscount}
          onChange={set('maxDiscount')}
          error={fieldErrors.maxDiscount}
        />
        <TextField label="Đơn tối thiểu (VND)" name="minOrderAmount" type="number" min={0} value={form.minOrderAmount} onChange={set('minOrderAmount')} error={fieldErrors.minOrderAmount} />
        <TextField label="Tổng số lượt (trống: không giới hạn)" name="usageLimit" type="number" min={1} value={form.usageLimit} onChange={set('usageLimit')} error={fieldErrors.usageLimit} />
        <TextField label="Lượt / người (trống: không giới hạn)" name="perUserLimit" type="number" min={1} value={form.perUserLimit} onChange={set('perUserLimit')} error={fieldErrors.perUserLimit} />
        <DateTimeField label="Bắt đầu (giờ VN)" name="startsAt" value={form.startsAt} onChange={(startsAt) => setForm((f) => ({ ...f, startsAt }))} error={fieldErrors.startsAt} />
        <DateTimeField label="Hết hạn (giờ VN)" name="expiresAt" value={form.expiresAt} onChange={(expiresAt) => setForm((f) => ({ ...f, expiresAt }))} error={fieldErrors.expiresAt} />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Trạng thái</span>
          <select value={form.status} onChange={set('status')} className="block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5">
            <option value="ACTIVE">Đang dùng</option>
            <option value="INACTIVE">Tạm dừng</option>
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" loading={busy} disabled={!form.code || !form.name || !form.discountValue}>
            {promotion ? 'Lưu' : 'Tạo mã'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Thôi
          </Button>
        </div>
      </form>
    </Card>
  )
}
