const { buildSetClause } = require('../../utils/sql');
const { escapeLike } = require('../../utils/pagination');

const EVENT_COLUMNS = `e.id, e.organizer_id, e.title, e.slug, e.description, e.banner_url, e.thumbnail_url,
  e.status, e.age_restriction, e.queue_enabled, e.queue_capacity, e.queue_session_minutes, e.lineup, e.rating_count, e.rating_sum, e.published_at, e.created_at, e.updated_at`;

const UPDATABLE = {
  title: 'title',
  description: 'description',
  bannerUrl: 'banner_url',
  thumbnailUrl: 'thumbnail_url',
  ageRestriction: 'age_restriction',
  // Phase 21: purchase queue
  queueEnabled: 'queue_enabled',
  queueCapacity: 'queue_capacity',
  queueSessionMinutes: 'queue_session_minutes',
  lineup: 'lineup', // the performance programme (jsonb)
};

// The categories of event `e`, as a JSON array (read model; see listEvents).
const CATEGORIES_JSON = `(
  SELECT coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) ORDER BY c.name), '[]'::json)
  FROM event_categories ec
  JOIN categories c ON c.id = ec.category_id
  WHERE ec.event_id = e.id
) AS categories`;

/** Whitelisted sort orders: the client picks a KEY, never raw SQL. e.id breaks ties so pages are stable. */
const SORT_ORDERS = Object.freeze({
  startAt: 's.next_start_at ASC NULLS LAST, e.id',
  '-startAt': 's.next_start_at DESC NULLS LAST, e.id',
  publishedAt: 'e.published_at ASC NULLS LAST, e.id',
  '-publishedAt': 'e.published_at DESC NULLS LAST, e.id',
  title: 'e.title ASC, e.id',
  '-title': 'e.title DESC, e.id',
  '-createdAt': 'e.created_at DESC, e.id',
});

async function insertEvent(db, event) {
  const { rows } = await db.query(
    `INSERT INTO events (organizer_id, title, slug, description, banner_url, thumbnail_url, age_restriction)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      event.organizerId,
      event.title,
      event.slug,
      event.description ?? null,
      event.bannerUrl ?? null,
      event.thumbnailUrl ?? null,
      event.ageRestriction ?? null,
    ],
  );
  return rows[0].id;
}

async function findById(db, id, { forUpdate = false, forShare = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1 ${forUpdate ? 'FOR UPDATE' : forShare ? 'FOR SHARE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

/** Event with organizer name and categories, looked up by id or by slug. */
async function findDetail(db, { id, slug }) {
  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS}, o.organization_name AS organizer_name, ${CATEGORIES_JSON}
     FROM events e
     JOIN organizers o ON o.id = e.organizer_id
     WHERE ${id ? 'e.id' : 'e.slug'} = $1`,
    [id ?? slug],
  );
  return rows[0] ?? null;
}

/** Replace the event's categories. A missing category id fails the FK → 422 CATEGORY_NOT_FOUND. */
async function replaceCategories(db, eventId, categoryIds) {
  await db.query(`DELETE FROM event_categories WHERE event_id = $1`, [eventId]);
  await db.query(
    `INSERT INTO event_categories (event_id, category_id) SELECT $1, unnest($2::uuid[])`,
    [eventId, categoryIds],
  );
}

async function updateEvent(db, id, changes) {
  // node-postgres sends a JS array as a PostgreSQL array: jsonb needs the JSON text.
  const values = 'lineup' in changes ? { ...changes, lineup: JSON.stringify(changes.lineup) } : changes;
  const { clause, params } = buildSetClause(values, UPDATABLE, 2);
  if (!clause) return;
  await db.query(`UPDATE events SET ${clause} WHERE id = $1`, [id, ...params]);
}

/**
 * Compare-and-set: changes the status only if it is still `from`.
 * $3 is used twice; the explicit casts give both uses the same type
 * (otherwise PostgreSQL infers event_status in one place and text in the other).
 */
async function updateStatus(db, id, { from, to }) {
  const { rows } = await db.query(
    `UPDATE events
     SET status = $3::event_status,
         published_at = CASE WHEN $3::event_status = 'PUBLISHED' THEN now() ELSE published_at END
     WHERE id = $1 AND status = $2
     RETURNING id`,
    [id, from, to],
  );
  return rows.length > 0;
}

async function deleteEvent(db, id) {
  await db.query(`DELETE FROM events WHERE id = $1`, [id]);
}

/**
 * Event list with filters, search, sorting and pagination.
 *
 * Read model note: this query joins tables owned by other modules (venues,
 * categories, organizers) because a listing needs all of them at once. If the
 * catalog is ever extracted into its own service, this becomes a search index.
 *
 * Only filters that were actually given are added to the SQL; every value
 * goes through a $n placeholder.
 *
 * @param {object} filters
 * @param {string[]} filters.statuses
 * @param {string} [filters.organizerId]
 * @param {string} [filters.q]            accent-insensitive title search
 * @param {string} [filters.categoryId]
 * @param {string} [filters.city]
 * @param {Date}   [filters.dateFrom]
 * @param {Date}   [filters.dateTo]
 * @param {boolean} filters.requireSchedule  keep only events with a matching upcoming schedule
 * @param {keyof SORT_ORDERS} filters.sort
 * @param {number} filters.limit
 * @param {number} filters.offset
 */
async function listEvents(db, filters) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  // Which schedules count: upcoming (or from dateFrom), not cancelled, optionally in a city / before dateTo.
  const scheduleWhere = [
    `es.event_id = e.id`,
    `es.status = 'SCHEDULED'`,
    `es.start_at >= ${filters.dateFrom ? param(filters.dateFrom) : 'now()'}`,
  ];
  if (filters.dateTo) scheduleWhere.push(`es.start_at < ${param(filters.dateTo)}`);
  if (filters.city) {
    scheduleWhere.push(`immutable_unaccent(lower(v.city)) = immutable_unaccent(lower(${param(filters.city)}))`);
  }

  const where = [`e.status = ANY(${param(filters.statuses)}::event_status[])`];
  if (filters.organizerId) where.push(`e.organizer_id = ${param(filters.organizerId)}`);
  if (filters.q) {
    // Same expression as the GIN index idx_events_title_search.
    where.push(
      `immutable_unaccent(lower(e.title)) LIKE '%' || immutable_unaccent(lower(${param(escapeLike(filters.q))})) || '%' ESCAPE '\\'`,
    );
  }
  if (filters.categoryId) {
    where.push(
      `EXISTS (SELECT 1 FROM event_categories ec WHERE ec.event_id = e.id AND ec.category_id = ${param(filters.categoryId)})`,
    );
  }
  if (filters.requireSchedule) where.push(`s.next_start_at IS NOT NULL`);

  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS},
            o.organization_name AS organizer_name,
            s.next_start_at,
            coalesce(s.cities, '{}') AS cities,
            p.from_price, p.places_total, p.places_left,
            ${CATEGORIES_JSON},
            count(*) OVER () AS total
     FROM events e
     JOIN organizers o ON o.id = e.organizer_id
     LEFT JOIN LATERAL (
       SELECT min(es.start_at) AS next_start_at,
              array_agg(DISTINCT v.city ORDER BY v.city) AS cities
       FROM event_schedules es
       JOIN venues v ON v.id = es.venue_id
       WHERE ${scheduleWhere.join(' AND ')}
     ) s ON true
     -- For the cards: the lowest price on sale, and how many places are left
     -- (same count as the availability of a show), over the same shows.
     LEFT JOIN LATERAL (
       SELECT min(tt.price) AS from_price,
              sum(CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION' THEN g.capacity ELSE seats.total END)::int AS places_total,
              sum(CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION'
                       THEN g.capacity - g.held_quantity - g.sold_quantity - g.blocked_quantity
                       ELSE seats.available END)::int AS places_left
       FROM event_schedules es
       JOIN venues v ON v.id = es.venue_id
       JOIN ticket_types tt ON tt.schedule_id = es.id AND tt.status = 'ACTIVE'
       LEFT JOIN ga_inventory g ON g.ticket_type_id = tt.id
       LEFT JOIN LATERAL (
         SELECT count(*) AS total,
                count(*) FILTER (WHERE st.status = 'AVAILABLE' OR (st.status = 'HELD' AND st.hold_expires_at <= now())) AS available
         FROM schedule_seats st
         WHERE st.schedule_id = tt.schedule_id AND st.ticket_type_id = tt.id
       ) seats ON true
       WHERE ${scheduleWhere.join(' AND ')}
     ) p ON true
     WHERE ${where.join(' AND ')}
     ORDER BY ${SORT_ORDERS[filters.sort]}
     LIMIT ${param(filters.limit)} OFFSET ${param(filters.offset)}`,
    params,
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

module.exports = {
  SORT_ORDERS,
  insertEvent,
  findById,
  findDetail,
  replaceCategories,
  updateEvent,
  updateStatus,
  deleteEvent,
  listEvents,
};
