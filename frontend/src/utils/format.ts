/** Shows / sales happen in Vietnam: times are always shown in Vietnam time, whatever the device's time zone. */
const TIME_ZONE = 'Asia/Ho_Chi_Minh'

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dayMonth = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' })
const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' })

export const formatVnd = (amount: number) => vnd.format(amount)
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
export const formatDayMonth = (iso: string) => dayMonth.format(new Date(iso))
export const formatTime = (iso: string) => time.format(new Date(iso))
