-- Up Migration
-- Money columns are BIGINT in integer minor units (VND: 1500000 = 1,500,000 VND).

-- ===========================================================================
-- TICKET TYPES
-- ===========================================================================
CREATE TABLE ticket_types (
  id             uuid                NOT NULL DEFAULT gen_random_uuid(),
  schedule_id    uuid                NOT NULL,
  venue_zone_id  uuid                NOT NULL,
  name           varchar(100)        NOT NULL,
  code           varchar(50)         NOT NULL,
  price          bigint              NOT NULL,
  currency       char(3)             NOT NULL DEFAULT 'VND',
  quantity       int,                -- informational; real stock = schedule_seats rows
  status         ticket_type_status  NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamptz         NOT NULL DEFAULT now(),
  updated_at     timestamptz         NOT NULL DEFAULT now(),
  CONSTRAINT ticket_types_pkey PRIMARY KEY (id),
  CONSTRAINT ticket_types_schedule_id_code_key UNIQUE (schedule_id, code),
  CONSTRAINT ticket_types_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES event_schedules (id),
  CONSTRAINT ticket_types_venue_zone_id_fkey FOREIGN KEY (venue_zone_id) REFERENCES venue_zones (id),
  CONSTRAINT chk_ticket_types_price CHECK (price >= 0),
  CONSTRAINT chk_ticket_types_quantity CHECK (quantity IS NULL OR quantity > 0)
);
CREATE INDEX idx_ticket_types_venue_zone_id ON ticket_types (venue_zone_id);
CREATE TRIGGER trg_ticket_types_updated_at BEFORE UPDATE ON ticket_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- ORDERS  (a "booking" is an order in HELD state)
-- ===========================================================================
CREATE TABLE orders (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  order_code       varchar(50)   NOT NULL,
  user_id          uuid          NOT NULL,
  schedule_id      uuid          NOT NULL,
  status           order_status  NOT NULL DEFAULT 'PENDING',
  subtotal         bigint        NOT NULL DEFAULT 0,
  discount_amount  bigint        NOT NULL DEFAULT 0,
  total_amount     bigint        NOT NULL DEFAULT 0,
  currency         char(3)       NOT NULL DEFAULT 'VND',
  expires_at       timestamptz,
  paid_at          timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_order_code_key UNIQUE (order_code),
  -- Targets of composite FKs ("belongs to the same schedule / the same user").
  CONSTRAINT orders_id_schedule_id_key UNIQUE (id, schedule_id),
  CONSTRAINT orders_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT orders_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES event_schedules (id),
  CONSTRAINT chk_orders_amounts CHECK (subtotal >= 0 AND discount_amount >= 0 AND total_amount >= 0),
  -- Money must add up; enforced by the database, not just by the app.
  CONSTRAINT chk_orders_total CHECK (total_amount = subtotal - discount_amount),
  CONSTRAINT chk_orders_expiry
    CHECK (status NOT IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED') OR expires_at IS NOT NULL),
  CONSTRAINT chk_orders_paid_at
    CHECK (status NOT IN ('PAID', 'COMPLETED', 'REFUNDED') OR paid_at IS NOT NULL)
);
-- Order history; also serves WHERE user_id = ? (leftmost column).
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);
CREATE INDEX idx_orders_schedule_id_status ON orders (schedule_id, status);
-- One active cart per user per schedule.
CREATE UNIQUE INDEX uq_orders_active_cart ON orders (user_id, schedule_id)
  WHERE status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED');
-- Expiry sweeper only scans orders that can still expire.
CREATE INDEX idx_orders_expiring ON orders (expires_at)
  WHERE status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED');
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- SCHEDULE SEATS — seat inventory of ONE schedule. Prevents double booking.
-- ===========================================================================
CREATE TABLE schedule_seats (
  id                uuid                  NOT NULL DEFAULT gen_random_uuid(),
  schedule_id       uuid                  NOT NULL,
  seat_id           uuid                  NOT NULL,
  status            schedule_seat_status  NOT NULL DEFAULT 'AVAILABLE',
  price             bigint                NOT NULL,   -- copied from ticket_types at set-up
  currency          char(3)               NOT NULL DEFAULT 'VND',
  held_by_order_id  uuid,
  hold_expires_at   timestamptz,
  sold_by_order_id  uuid,
  sold_at           timestamptz,
  blocked_reason    text,
  version           int                   NOT NULL DEFAULT 0,
  created_at        timestamptz           NOT NULL DEFAULT now(),
  updated_at        timestamptz           NOT NULL DEFAULT now(),
  CONSTRAINT schedule_seats_pkey PRIMARY KEY (id),
  -- (S1, A01) and (S2, A01) are different rows; (S1, A01) can exist only once.
  CONSTRAINT uq_schedule_seats_schedule_seat UNIQUE (schedule_id, seat_id),
  -- Targets of composite FKs from order_items / tickets.
  CONSTRAINT schedule_seats_id_schedule_id_key UNIQUE (id, schedule_id),
  CONSTRAINT schedule_seats_id_schedule_id_seat_id_key UNIQUE (id, schedule_id, seat_id),
  CONSTRAINT schedule_seats_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES event_schedules (id),
  CONSTRAINT schedule_seats_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES seats (id),
  -- The holding / buying order must be an order for THIS schedule.
  -- (MATCH SIMPLE: not checked while the order column is NULL.)
  CONSTRAINT schedule_seats_held_by_order_fkey
    FOREIGN KEY (held_by_order_id, schedule_id) REFERENCES orders (id, schedule_id),
  CONSTRAINT schedule_seats_sold_by_order_fkey
    FOREIGN KEY (sold_by_order_id, schedule_id) REFERENCES orders (id, schedule_id),
  CONSTRAINT chk_schedule_seats_price CHECK (price >= 0),
  -- Status and owner columns must agree. A seat can never be HELD by order A
  -- and SOLD to order B at the same time, and a free seat has no owner.
  CONSTRAINT chk_schedule_seats_state CHECK (
       (status = 'AVAILABLE' AND held_by_order_id IS NULL AND hold_expires_at IS NULL
                             AND sold_by_order_id IS NULL AND sold_at IS NULL AND blocked_reason IS NULL)
    OR (status = 'HELD'      AND held_by_order_id IS NOT NULL AND hold_expires_at IS NOT NULL
                             AND sold_by_order_id IS NULL AND sold_at IS NULL)
    OR (status = 'SOLD'      AND sold_by_order_id IS NOT NULL AND sold_at IS NOT NULL
                             AND held_by_order_id IS NULL AND hold_expires_at IS NULL)
    OR (status = 'BLOCKED'   AND held_by_order_id IS NULL AND hold_expires_at IS NULL
                             AND sold_by_order_id IS NULL AND sold_at IS NULL)
  )
);
CREATE INDEX idx_schedule_seats_seat_id ON schedule_seats (seat_id);
CREATE INDEX idx_schedule_seats_held_by_order_id ON schedule_seats (held_by_order_id);
CREATE INDEX idx_schedule_seats_sold_by_order_id ON schedule_seats (sold_by_order_id);
-- Expiry sweeper: only HELD seats have a hold to expire.
CREATE INDEX idx_schedule_seats_expiring ON schedule_seats (hold_expires_at) WHERE status = 'HELD';
CREATE TRIGGER trg_schedule_seats_version BEFORE UPDATE ON schedule_seats
  FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ===========================================================================
-- ORDER ITEMS — one row per seat. Snapshot fields (seat_label,
-- ticket_type_name, unit_price) intentionally never change afterwards.
-- ===========================================================================
CREATE TABLE order_items (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  order_id          uuid          NOT NULL,
  schedule_seat_id  uuid          NOT NULL,
  ticket_type_id    uuid,
  event_id          uuid          NOT NULL,
  schedule_id       uuid          NOT NULL,
  seat_id           uuid          NOT NULL,
  seat_label        varchar(100)  NOT NULL,
  ticket_type_name  varchar(100),
  unit_price        bigint        NOT NULL,
  quantity          int           NOT NULL DEFAULT 1,
  total_amount      bigint        NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_schedule_seat_id_key UNIQUE (order_id, schedule_seat_id),
  CONSTRAINT order_items_id_order_id_key UNIQUE (id, order_id),
  CONSTRAINT order_items_ticket_type_id_fkey FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id),
  -- The redundant columns cannot disagree: order, seat inventory and event
  -- all belong to the same schedule.
  CONSTRAINT order_items_order_fkey
    FOREIGN KEY (order_id, schedule_id) REFERENCES orders (id, schedule_id),
  CONSTRAINT order_items_schedule_seat_fkey
    FOREIGN KEY (schedule_seat_id, schedule_id, seat_id) REFERENCES schedule_seats (id, schedule_id, seat_id),
  CONSTRAINT order_items_event_fkey
    FOREIGN KEY (schedule_id, event_id) REFERENCES event_schedules (id, event_id),
  CONSTRAINT chk_order_items_price CHECK (unit_price >= 0),
  CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
  CONSTRAINT chk_order_items_total CHECK (total_amount = unit_price * quantity)
);
CREATE INDEX idx_order_items_schedule_seat_id ON order_items (schedule_seat_id);

-- ===========================================================================
-- PROMOTIONS
-- ===========================================================================
CREATE TABLE promotions (
  id                uuid              NOT NULL DEFAULT gen_random_uuid(),
  code              varchar(50)       NOT NULL,
  name              varchar(150)      NOT NULL,
  discount_type     discount_type     NOT NULL,
  discount_value    bigint            NOT NULL,
  max_discount      bigint,
  min_order_amount  bigint            NOT NULL DEFAULT 0,
  usage_limit       int,
  -- Incremented atomically: UPDATE ... SET used_count = used_count + 1
  -- WHERE used_count < usage_limit. Counting rows instead would race.
  used_count        int               NOT NULL DEFAULT 0,
  per_user_limit    int,
  starts_at         timestamptz       NOT NULL,
  expires_at        timestamptz       NOT NULL,
  status            promotion_status  NOT NULL DEFAULT 'ACTIVE',
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT promotions_pkey PRIMARY KEY (id),
  CONSTRAINT promotions_code_key UNIQUE (code),
  CONSTRAINT chk_promotions_value CHECK (discount_value > 0),
  CONSTRAINT chk_promotions_percentage CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100),
  CONSTRAINT chk_promotions_max_discount CHECK (max_discount IS NULL OR max_discount > 0),
  CONSTRAINT chk_promotions_min_order CHECK (min_order_amount >= 0),
  CONSTRAINT chk_promotions_period CHECK (starts_at < expires_at),
  CONSTRAINT chk_promotions_usage_limit CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT chk_promotions_per_user_limit CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  -- Last line of defence against over-redeeming a limited code.
  CONSTRAINT chk_promotions_used_count
    CHECK (used_count >= 0 AND (usage_limit IS NULL OR used_count <= usage_limit))
);
CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE promotion_usages (
  id               uuid         NOT NULL DEFAULT gen_random_uuid(),
  promotion_id     uuid         NOT NULL,
  user_id          uuid         NOT NULL,
  order_id         uuid         NOT NULL,
  discount_amount  bigint       NOT NULL,
  used_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT promotion_usages_pkey PRIMARY KEY (id),
  CONSTRAINT promotion_usages_promotion_id_order_id_key UNIQUE (promotion_id, order_id),
  CONSTRAINT promotion_usages_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES promotions (id),
  -- The order belongs to that user.
  CONSTRAINT promotion_usages_order_user_fkey
    FOREIGN KEY (order_id, user_id) REFERENCES orders (id, user_id),
  CONSTRAINT chk_promotion_usages_amount CHECK (discount_amount >= 0)
);
-- Count uses per user for per_user_limit.
CREATE INDEX idx_promotion_usages_promotion_id_user_id ON promotion_usages (promotion_id, user_id);
CREATE INDEX idx_promotion_usages_order_id ON promotion_usages (order_id);

-- Down Migration

DROP TABLE IF EXISTS promotion_usages;
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS schedule_seats;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS ticket_types;
