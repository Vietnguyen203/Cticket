/** API shape of a schedule row joined with its venue summary. */
function toPublicSchedule(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    startAt: row.start_at,
    endAt: row.end_at,
    salesStartAt: row.sales_start_at,
    salesEndAt: row.sales_end_at,
    status: row.status,
    capacity: row.capacity, // total attendance planned (null: not set)
    inventoryGeneratedAt: row.inventory_generated_at,
    venue: { id: row.venue_id, name: row.venue_name, city: row.venue_city, addressLine: row.venue_address },
  };
}

module.exports = { toPublicSchedule };
