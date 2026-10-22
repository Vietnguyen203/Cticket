import { parseTime24 } from '../utils/dateTimeParts'

/**
 * Why a button of the event editor is disabled, in words: a disabled button
 * that says nothing looked like "it does not work" (organizers reported that
 * creating an event or a schedule "sometimes" failed when a field was left
 * half filled).
 */

/** "Tạo và tiếp tục" / "Lưu thông tin": the title and at least one category, where they can still change. */
export function missingForEvent(
  form: { title: string; categoryIds: string[] },
  locked: { title: boolean; categoryIds: boolean },
): string[] {
  const missing: string[] = []
  if (!locked.title && !form.title.trim()) missing.push('tên sự kiện')
  if (!locked.categoryIds && form.categoryIds.length === 0) missing.push('ít nhất một danh mục')
  return missing
}

/**
 * "Thêm suất": a venue, the date and a start time typed as 24-hour HH:mm. The
 * end time is optional (empty: 3 hours later), but if typed it must be valid.
 */
export function missingForSchedule(
  form: { venueId: string; date: string; start: string; end: string },
  newVenueOpen: boolean,
): string[] {
  const missing: string[] = []
  if (newVenueOpen) missing.push('bấm "Xong, dùng địa điểm này" ở phần địa điểm mới')
  else if (!form.venueId) missing.push('địa điểm')
  if (!form.date) missing.push('ngày diễn')
  if (!parseTime24(form.start)) missing.push('giờ bắt đầu (HH:mm, 24 giờ)')
  if (form.end.trim() && !parseTime24(form.end)) missing.push('giờ kết thúc đúng dạng HH:mm (hoặc để trống)')
  return missing
}
