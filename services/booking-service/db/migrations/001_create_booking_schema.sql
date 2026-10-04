CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE IF NOT EXISTS booking.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  capacity integer NOT NULL CHECK (capacity > 0),
  equipment jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT slots_time_order CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS booking.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES booking.rooms(id),
  user_id uuid NOT NULL,
  booking_date date NOT NULL,
  slot_id uuid NOT NULL REFERENCES booking.slots(id),
  status text NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  cancel_reason text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_room_date_slot_confirmed_uidx
  ON booking.bookings (room_id, booking_date, slot_id) WHERE status = 'CONFIRMED';
CREATE UNIQUE INDEX IF NOT EXISTS bookings_user_idempotency_uidx
  ON booking.bookings (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS bookings_user_date_idx ON booking.bookings (user_id, booking_date DESC);

CREATE TABLE IF NOT EXISTS booking.outbox_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('BOOKING_CREATED', 'BOOKING_CANCELLED')),
  aggregate_id uuid NOT NULL,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON booking.outbox_events (next_retry_at, created_at) WHERE status = 'PENDING';
