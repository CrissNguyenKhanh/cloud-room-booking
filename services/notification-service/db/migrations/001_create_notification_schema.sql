CREATE SCHEMA IF NOT EXISTS notification;
CREATE TABLE IF NOT EXISTS notification.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notification.notifications (user_id, created_at DESC);
