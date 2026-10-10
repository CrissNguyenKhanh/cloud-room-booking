ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS admin_visible boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS notification.admin_notification_reads (
  notification_id uuid NOT NULL
    REFERENCES notification.notifications(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, admin_user_id)
);

CREATE INDEX IF NOT EXISTS notifications_admin_visible_created_idx
  ON notification.notifications (created_at DESC)
  WHERE admin_visible = true;
