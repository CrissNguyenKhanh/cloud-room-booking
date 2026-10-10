export class NotificationRepository {
  constructor(pool) { this.pool = pool; }
  async create(event) {
    const inserted = await this.pool.query(`INSERT INTO notification.notifications
      (event_id, user_id, type, payload, admin_visible)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING *`,
    [event.event_id, event.user_id, event.event_type, event.payload, event.adminVisible]);
    if (inserted.rowCount) return { notification: inserted.rows[0], created: true };
    const existing = await this.pool.query('SELECT * FROM notification.notifications WHERE event_id = $1', [event.event_id]);
    return { notification: existing.rows[0], created: false };
  }
  async listByUser(userId) {
    const { rows } = await this.pool.query('SELECT * FROM notification.notifications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows;
  }
  async listForAdmin(adminUserId) {
    const { rows } = await this.pool.query(`SELECT n.id, n.event_id, n.user_id, n.type, n.payload,
      CASE WHEN n.admin_visible THEN r.read_at ELSE n.read_at END AS read_at,
      n.created_at, n.admin_visible
      FROM notification.notifications n
      LEFT JOIN notification.admin_notification_reads r
        ON r.notification_id = n.id AND r.admin_user_id = $1
      WHERE n.admin_visible = true OR n.user_id = $1
      ORDER BY n.created_at DESC`, [adminUserId]);
    return rows;
  }
  async markRead(id, userId) {
    const { rows } = await this.pool.query(`UPDATE notification.notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId]);
    return rows[0] || null;
  }
  async markReadByAdmin(id, adminUserId) {
    const receipt = await this.pool.query(`WITH admin_read AS (
      INSERT INTO notification.admin_notification_reads AS existing (notification_id, admin_user_id)
      SELECT n.id, $2 FROM notification.notifications n
      WHERE n.id = $1 AND n.admin_visible = true
      ON CONFLICT (notification_id, admin_user_id)
      DO UPDATE SET read_at = existing.read_at
      RETURNING notification_id, read_at
    )
    SELECT n.id, n.event_id, n.user_id, n.type, n.payload, admin_read.read_at,
      n.created_at, n.admin_visible
    FROM admin_read
    JOIN notification.notifications n ON n.id = admin_read.notification_id`, [id, adminUserId]);
    if (receipt.rows[0]) return receipt.rows[0];
    return this.markRead(id, adminUserId);
  }
}
