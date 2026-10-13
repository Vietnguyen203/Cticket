const { pool } = require('../../database/pool');
const { ORGANIZER_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const users = require('../users');
const organizers = require('../organizers');
const reportsRepository = require('./reports.repository');
const { vnToday, addDays, daysBetween } = require('./vn-date');

const MAX_DAYS = 366;
/** An event chart shows at least two weeks, so a first day of sales is not a lone bar. */
const MIN_EVENT_CHART_DAYS = 14;
const TOP_EVENTS = 10;
const DASHBOARD_TOP_EVENTS = 5;
const DASHBOARD_DAYS = 30;
const MAX_ORGANIZERS = 100;
const MAX_MY_EVENTS = 200;

/** Sold ÷ places that can be sold; null when there is nothing to sell (no division by zero on the page). */
function fillRate(sold, capacity, blocked) {
  const sellable = capacity - blocked;
  return sellable > 0 ? Math.round((sold / sellable) * 1000) / 1000 : null;
}

const toDay = (row) => ({
  date: row.date,
  orders: row.orders,
  tickets: row.tickets,
  revenue: row.revenue,
  refunds: { orders: row.refunded_orders, amount: row.refunded_amount },
});

/** Ticket figures added up (schedule → event). */
function sumPlaces(rows) {
  const total = { capacity: 0, blocked: 0, tickets: 0, checkedIn: 0 };
  for (const row of rows) {
    total.capacity += row.capacity;
    total.blocked += row.blocked;
    total.tickets += row.sold;
    total.checkedIn += row.checkedIn;
  }
  return { ...total, fillRate: fillRate(total.tickets, total.capacity, total.blocked) };
}

/** Money figures added up (schedule → event). */
function sumMoney(rows) {
  const total = { orders: 0, gross: 0, discount: 0, revenue: 0, refunds: { orders: 0, amount: 0 } };
  for (const row of rows) {
    total.orders += row.orders;
    total.gross += row.gross;
    total.discount += row.discount;
    total.revenue += row.revenue;
    total.refunds.orders += row.refunds.orders;
    total.refunds.amount += row.refunds.amount;
  }
  return total;
}

/**
 * Report of any event with report:read:any; with report:read:own only of an
 * event of the caller's ACTIVE organizer. Anything else is 404, as for the
 * other "own" resources: we do not confirm the event exists.
 */
async function findReadableEvent(user, eventId) {
  const event = await reportsRepository.findEvent(pool, eventId);
  const notFound = new AppError('NOT_FOUND', 'Event not found.');
  if (!event) throw notFound;
  const permissions = await users.getPermissionsForRoles(user.roles);
  if (permissions.includes('report:read:any')) return event;
  if (!permissions.includes('report:read:own')) throw notFound;
  const organizer = await organizers.findOrganizerByUserId(user.id);
  if (organizer?.status !== ORGANIZER_STATUS.ACTIVE || organizer.id !== event.organizer_id) throw notFound;
  return event;
}

/** REP-01: event → schedules → ticket types, codes used, sales by day. */
async function eventSales(user, eventId) {
  const event = await findReadableEvent(user, eventId);
  const schedules = await reportsRepository.schedulesOfEvent(pool, eventId);
  const ticketTypes = await reportsRepository.ticketTypesOfEvent(pool, eventId);
  const money = new Map((await reportsRepository.ordersBySchedule(pool, eventId)).map((row) => [row.schedule_id, row]));
  const promotions = await reportsRepository.promotionsOfEvent(pool, eventId);

  const scheduleReports = schedules.map((schedule) => {
    const types = ticketTypes
      .filter((tt) => tt.schedule_id === schedule.id)
      .map((tt) => ({
        id: tt.id,
        name: tt.name,
        price: tt.price,
        mode: tt.inventory_mode,
        capacity: tt.capacity,
        blocked: tt.blocked,
        sold: tt.sold,
        fillRate: fillRate(tt.sold, tt.capacity, tt.blocked),
        revenue: tt.revenue,
        checkedIn: tt.checked_in,
      }));
    const m = money.get(schedule.id);
    const totals = {
      orders: m?.orders ?? 0,
      gross: m?.gross ?? 0,
      discount: m?.discount ?? 0,
      revenue: m?.revenue ?? 0,
      refunds: { orders: m?.refunded_orders ?? 0, amount: m?.refunded_amount ?? 0 },
      ...sumPlaces(types),
    };
    return {
      id: schedule.id,
      startAt: schedule.start_at,
      endAt: schedule.end_at,
      status: schedule.status,
      venueName: schedule.venue_name,
      totals,
      ticketTypes: types,
    };
  });

  // The chart: from the first sale (at least 2 weeks, at most a year back) to today.
  const today = vnToday();
  const twoWeeksAgo = addDays(today, 1 - MIN_EVENT_CHART_DAYS);
  const first = (await reportsRepository.firstSaleDay(pool, eventId)) ?? today;
  const from = daysBetween(first, today) > MAX_DAYS ? addDays(today, 1 - MAX_DAYS) : first < twoWeeksAgo ? first : twoWeeksAgo;
  const daily = (await reportsRepository.daily(pool, { from, to: today, eventId })).map(toDay);

  return {
    event: { id: event.id, title: event.title, slug: event.slug, status: event.status },
    totals: { ...sumMoney(scheduleReports.map((s) => s.totals)), ...sumPlaces(scheduleReports.flatMap((s) => s.ticketTypes)) },
    schedules: scheduleReports,
    promotions: promotions.map((p) => ({ code: p.code, name: p.name, orders: p.orders, discount: p.discount })),
    daily,
  };
}

/** REP-01b: one line per event of my organizer, newest first. */
async function myEvents(user) {
  const organizer = await organizers.findOrganizerByUserId(user.id);
  if (organizer?.status !== ORGANIZER_STATUS.ACTIVE) {
    return { events: [], totals: { orders: 0, tickets: 0, revenue: 0, refunds: { orders: 0, amount: 0 } }, truncated: false };
  }
  const rows = await reportsRepository.eventsOfOrganizer(pool, organizer.id, MAX_MY_EVENTS + 1);
  const events = rows.slice(0, MAX_MY_EVENTS).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    nextStartAt: row.next_start_at,
    capacity: row.capacity,
    blocked: row.blocked,
    orders: row.orders,
    tickets: row.sold,
    fillRate: fillRate(row.sold, row.capacity, row.blocked),
    revenue: row.revenue,
    refunds: { orders: row.refunded_orders, amount: row.refunded_amount },
  }));
  const totals = { orders: 0, tickets: 0, revenue: 0, refunds: { orders: 0, amount: 0 } };
  for (const e of events) {
    totals.orders += e.orders;
    totals.tickets += e.tickets;
    totals.revenue += e.revenue;
    totals.refunds.orders += e.refunds.orders;
    totals.refunds.amount += e.refunds.amount;
  }
  return { events, totals, truncated: rows.length > MAX_MY_EVENTS };
}

/** Checked here (not only in the schema) because "today" moves. */
function assertRange(from, to) {
  if (from > to) throw new AppError('VALIDATION_ERROR', '"from" must not be after "to".');
  if (to > vnToday()) throw new AppError('VALIDATION_ERROR', '"to" must not be in the future.');
  if (daysBetween(from, to) > MAX_DAYS) throw new AppError('VALIDATION_ERROR', `The range is limited to ${MAX_DAYS} days.`);
}

const toTopEvent = (row) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  organizerName: row.organization_name,
  orders: row.orders,
  tickets: row.tickets,
  revenue: row.revenue,
});

/** REP-02: the whole platform over a range of Vietnamese days. */
async function platformSales({ from, to }) {
  assertRange(from, to);
  const { sold, refunded } = await reportsRepository.rangeTotals(pool, { from, to });
  const daily = await reportsRepository.daily(pool, { from, to });
  const top = await reportsRepository.topEvents(pool, { from, to, limit: TOP_EVENTS });
  const organizerRows = await reportsRepository.byOrganizer(pool, { from, to, limit: MAX_ORGANIZERS });
  return {
    range: { from, to },
    totals: { ...sold, refunds: refunded },
    daily: daily.map(toDay),
    topEvents: top.map(toTopEvent),
    byOrganizer: organizerRows.map((row) => ({
      id: row.id,
      name: row.organization_name,
      orders: row.orders,
      tickets: row.tickets,
      revenue: row.revenue,
    })),
  };
}

function sumDays(days) {
  const total = { orders: 0, tickets: 0, revenue: 0, refunds: { orders: 0, amount: 0 } };
  for (const day of days) {
    total.orders += day.orders;
    total.tickets += day.tickets;
    total.revenue += day.revenue;
    total.refunds.orders += day.refunds.orders;
    total.refunds.amount += day.refunds.amount;
  }
  return total;
}

/** Dashboard: today / 7 days / 30 days in one call. */
async function overview() {
  const to = vnToday();
  const from = addDays(to, 1 - DASHBOARD_DAYS);
  const daily = (await reportsRepository.daily(pool, { from, to })).map(toDay);
  const top = await reportsRepository.topEvents(pool, { from, to, limit: DASHBOARD_TOP_EVENTS });
  const counts = await reportsRepository.platformCounts(pool);
  return {
    today: sumDays(daily.slice(-1)),
    last7Days: sumDays(daily.slice(-7)),
    last30Days: sumDays(daily),
    daily,
    topEvents: top.map(toTopEvent),
    publishedEvents: counts.published_events,
    newUsers7Days: counts.new_users_7d,
  };
}

module.exports = { eventSales, myEvents, platformSales, overview, fillRate };
