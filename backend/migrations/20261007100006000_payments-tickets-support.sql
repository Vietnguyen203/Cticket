-- Up Migration

-- ===========================================================================
-- PAYMENTS / REFUNDS
-- ===========================================================================
CREATE TABLE payments (
  id                       uuid            NOT NULL DEFAULT gen_random_uuid(),
  order_id                 uuid            NOT NULL,
  user_id                  uuid            NOT NULL,
  idempotency_key          varchar(255)    NOT NULL,
  request_hash             varchar(64)     NOT NULL,   -- SHA-256 of the request body
  provider                 varchar(50)     NOT NULL,
  provider_transaction_id  varchar(255),
  amount                   bigint          NOT NULL,
  currency                 char(3)         NOT NULL DEFAULT 'VND',
  status                   payment_status  NOT NULL DEFAULT 'PENDING',
  failure_code             varchar(100),
  failure_message          text,
  paid_at                  timestamptz,
  created_at               timestamptz     NOT NULL DEFAULT now(),
  updated_at               timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  -- Idempotency, scoped per user: the same client key can create at most one
  -- payment, and one user can never receive another user's payment by key.
  CONSTRAINT uq_payments_user_idempotency_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT payments_provider_transaction_key UNIQUE (provider, provider_transaction_id),
  CONSTRAINT payments_id_order_id_key UNIQUE (id, order_id),
  -- The payer is the order's owner.
  CONSTRAINT payments_order_user_fkey FOREIGN KEY (order_id, user_id) REFERENCES orders (id, user_id),
  CONSTRAINT chk_payments_amount CHECK (amount > 0),
  CONSTRAINT chk_payments_paid_at CHECK (status NOT IN ('SUCCESS', 'REFUNDED') OR paid_at IS NOT NULL)
);
CREATE INDEX idx_payments_order_id ON payments (order_id);
-- At most one in-flight or successful payment per order.
CREATE UNIQUE INDEX uq_payments_order_active ON payments (order_id)
  WHERE status IN ('PENDING', 'SUCCESS');
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refunds (
  id                  uuid           NOT NULL DEFAULT gen_random_uuid(),
  payment_id          uuid           NOT NULL,
  order_id            uuid           NOT NULL,
  amount              bigint         NOT NULL,
  reason              text,
  status              refund_status  NOT NULL DEFAULT 'PENDING',
  provider_refund_id  varchar(255),
  created_at          timestamptz    NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT refunds_pkey PRIMARY KEY (id),
  CONSTRAINT refunds_provider_refund_id_key UNIQUE (provider_refund_id),
  -- The refund belongs to that payment's order.
  CONSTRAINT refunds_payment_order_fkey FOREIGN KEY (payment_id, order_id) REFERENCES payments (id, order_id),
  CONSTRAINT chk_refunds_amount CHECK (amount > 0),
  CONSTRAINT chk_refunds_completed_at CHECK (status <> 'SUCCESS' OR completed_at IS NOT NULL)
);
CREATE INDEX idx_refunds_payment_id ON refunds (payment_id);
CREATE INDEX idx_refunds_order_id ON refunds (order_id);
-- Full refunds only: a payment is never refunded twice.
CREATE UNIQUE INDEX uq_refunds_payment_active ON refunds (payment_id)
  WHERE status IN ('PENDING', 'SUCCESS');

-- ===========================================================================
-- TICKETS / CHECK-INS
-- ===========================================================================
CREATE TABLE tickets (
  id                uuid           NOT NULL DEFAULT gen_random_uuid(),
  ticket_code       varchar(100)   NOT NULL,
  qr_token_hash     text           NOT NULL,   -- hash only; the QR holds an opaque token
  order_id          uuid           NOT NULL,
  order_item_id     uuid           NOT NULL,
  user_id           uuid           NOT NULL,
  event_id          uuid           NOT NULL,
  schedule_id       uuid           NOT NULL,
  schedule_seat_id  uuid           NOT NULL,
  status            ticket_status  NOT NULL DEFAULT 'VALID',
  issued_at         timestamptz    NOT NULL DEFAULT now(),
  used_at           timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_ticket_code_key UNIQUE (ticket_code),
  CONSTRAINT tickets_qr_token_hash_key UNIQUE (qr_token_hash),
  -- 1-1 with order_items. Makes ticket issuing idempotent: a retried job
  -- cannot create a second ticket (INSERT ... ON CONFLICT DO NOTHING).
  CONSTRAINT tickets_order_item_id_key UNIQUE (order_item_id),
  CONSTRAINT tickets_id_schedule_id_key UNIQUE (id, schedule_id),
  -- Same order, same owner, same schedule, same event.
  CONSTRAINT tickets_order_item_fkey FOREIGN KEY (order_item_id, order_id) REFERENCES order_items (id, order_id),
  CONSTRAINT tickets_order_user_fkey FOREIGN KEY (order_id, user_id) REFERENCES orders (id, user_id),
  CONSTRAINT tickets_schedule_seat_fkey
    FOREIGN KEY (schedule_seat_id, schedule_id) REFERENCES schedule_seats (id, schedule_id),
  CONSTRAINT tickets_event_fkey FOREIGN KEY (schedule_id, event_id) REFERENCES event_schedules (id, event_id),
  CONSTRAINT chk_tickets_used_at CHECK ((status = 'USED') = (used_at IS NOT NULL))
);
CREATE INDEX idx_tickets_user_id_issued_at ON tickets (user_id, issued_at);
CREATE INDEX idx_tickets_order_id ON tickets (order_id);
CREATE INDEX idx_tickets_schedule_id_status ON tickets (schedule_id, status);
-- Last line of defence against double booking: one live ticket per seat per
-- schedule. Cancelled/refunded tickets do not count, so the seat can be resold.
CREATE UNIQUE INDEX uq_tickets_live_seat ON tickets (schedule_seat_id)
  WHERE status IN ('VALID', 'USED');
CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE check_ins (
  id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  ticket_id      uuid          NOT NULL,
  event_id       uuid          NOT NULL,
  schedule_id    uuid          NOT NULL,
  staff_user_id  uuid          NOT NULL,
  checked_in_at  timestamptz   NOT NULL DEFAULT now(),
  device_id      varchar(255),
  location       jsonb,
  metadata       jsonb,
  CONSTRAINT check_ins_pkey PRIMARY KEY (id),
  -- 1-1 with tickets: a ticket can be checked in only once.
  CONSTRAINT check_ins_ticket_id_key UNIQUE (ticket_id),
  CONSTRAINT check_ins_ticket_fkey FOREIGN KEY (ticket_id, schedule_id) REFERENCES tickets (id, schedule_id),
  CONSTRAINT check_ins_event_fkey FOREIGN KEY (schedule_id, event_id) REFERENCES event_schedules (id, event_id),
  CONSTRAINT check_ins_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES users (id)
);
CREATE INDEX idx_check_ins_schedule_id_checked_in_at ON check_ins (schedule_id, checked_in_at);
CREATE INDEX idx_check_ins_staff_user_id ON check_ins (staff_user_id);

-- ===========================================================================
-- SUPPORT
-- ===========================================================================
CREATE TABLE notifications (
  id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid          NOT NULL,
  type        varchar(100)  NOT NULL,
  title       varchar(255)  NOT NULL,
  message     text          NOT NULL,
  data        jsonb,
  read_at     timestamptz,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_notifications_user_id_created_at ON notifications (user_id, created_at);

CREATE TABLE reviews (
  id          uuid           NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid           NOT NULL,
  event_id    uuid           NOT NULL,
  order_id    uuid           NOT NULL,
  rating      smallint       NOT NULL,
  comment     text,
  status      review_status  NOT NULL DEFAULT 'PENDING',
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_user_id_event_id_key UNIQUE (user_id, event_id),
  CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT reviews_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id),
  -- Only the buyer of the order can review with it.
  CONSTRAINT reviews_order_user_fkey FOREIGN KEY (order_id, user_id) REFERENCES orders (id, user_id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX idx_reviews_event_id_status ON reviews (event_id, status);
CREATE INDEX idx_reviews_order_id ON reviews (order_id);
CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_logs (
  id           uuid          NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid,         -- NULL = system / worker
  action       varchar(100)  NOT NULL,
  entity_type  varchar(100)  NOT NULL,
  entity_id    uuid,
  old_value    jsonb,
  new_value    jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX idx_audit_logs_user_id_created_at ON audit_logs (user_id, created_at);
-- Tamper-evident history: reject UPDATE and DELETE, even from the table owner.
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Down Migration

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS check_ins;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payments;
