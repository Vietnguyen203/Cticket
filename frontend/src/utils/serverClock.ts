/**
 * The countdown of a held order must follow the SERVER's clock: a phone or
 * laptop clock can be minutes off, and the API releases the seats at its own
 * time. Every API response carries a Date header; the offset to it is kept.
 */
let offsetMs = 0

/** Called with each response's Date header (and when the request was sent / answered). */
export function recordServerDate(dateHeader: string | undefined, sentAt: number, receivedAt = Date.now()): void {
  const server = dateHeader ? Date.parse(dateHeader) : Number.NaN
  if (Number.isNaN(server)) return
  // The header has 1 s resolution and was written somewhere during the round trip: take the middle.
  offsetMs = server + 500 - (sentAt + receivedAt) / 2
}

export const serverNow = () => Date.now() + offsetMs
