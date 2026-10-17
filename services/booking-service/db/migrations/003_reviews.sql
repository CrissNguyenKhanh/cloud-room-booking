
CREATE TABLE IF NOT EXISTS booking.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking.bookings(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES booking.rooms(id),
  user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  reviewer_name text NOT NULL DEFAULT 'Khách lưu trú',
  status text NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_booking_key UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS reviews_room_visible_idx
  ON booking.reviews (room_id, created_at DESC) WHERE status = 'VISIBLE';
CREATE INDEX IF NOT EXISTS reviews_user_idx ON booking.reviews (user_id, created_at DESC);
