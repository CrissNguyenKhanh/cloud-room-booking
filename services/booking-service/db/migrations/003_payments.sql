CREATE TABLE booking.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking.bookings(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'VND',
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  idempotency_key text NOT NULL,
  provider_transaction_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CONSTRAINT payments_user_idempotency_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT payments_provider_check CHECK (provider = 'MOCK'),
  CONSTRAINT payments_currency_check CHECK (currency = 'VND'),
  CONSTRAINT payments_result_fields_check CHECK (
    (status = 'PENDING' AND provider_transaction_id IS NULL AND failure_reason IS NULL AND paid_at IS NULL)
    OR (status = 'SUCCEEDED' AND provider_transaction_id IS NOT NULL AND failure_reason IS NULL AND paid_at IS NOT NULL)
    OR (status = 'FAILED' AND provider_transaction_id IS NULL AND failure_reason IS NOT NULL AND paid_at IS NULL)
  )
);

CREATE UNIQUE INDEX payments_booking_active_uidx
  ON booking.payments (booking_id)
  WHERE status IN ('PENDING', 'SUCCEEDED');

CREATE INDEX payments_booking_created_idx
  ON booking.payments (booking_id, created_at DESC, id DESC);
