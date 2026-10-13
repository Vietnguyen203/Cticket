/**
 * Report days are calendar days in Vietnam (UTC+7, no daylight saving).
 * Dates travel as "YYYY-MM-DD"; SQL turns them into instants with
 * `($1::date)::timestamp AT TIME ZONE '${VN_TIME_ZONE}'`.
 */
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in Vietnam, "YYYY-MM-DD". */
function vnToday(now = Date.now()) {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" plus `days` (may be negative). */
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Number of days from `from` to `to`, both included. */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

module.exports = { VN_TIME_ZONE, vnToday, addDays, daysBetween };
