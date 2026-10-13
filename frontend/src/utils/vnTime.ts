/**
 * Form times ("YYYY-MM-DDTHH:mm", see components/DateTimeField) have no time zone. Shows
 * happen in Vietnam (UTC+7 all year, no daylight saving), so what the user
 * types is Vietnam time, whatever the time zone of their computer.
 */
const OFFSET_MS = 7 * 60 * 60 * 1000

/** ISO instant → "2026-11-02T19:00" (Vietnam time), for an input's value. */
export function toVnInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 16)
}

/** "2026-11-02T19:00" (Vietnam time) → ISO instant with a Z; undefined when empty / invalid. */
export function fromVnInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined
  const ms = Date.parse(`${value}:00+07:00`)
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}
