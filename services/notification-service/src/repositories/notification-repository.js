export class NotificationRepository {
  constructor(pool) { this.pool = pool; }
  async create(event) {
    const inserted = await this.pool.query(`INSERT INTO notification.notifications (event_id, user_id, type, payload)
      VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING *`,
    [event.event_id, event.user_id, event.event_type, event.payload]);
    if (inserted.rowCount) return { notification: inserted.rows[0], created: true };
    const existing = await this.pool.query('SELECT * FROM notification.notifications WHERE event_id = $1', [event.event_id]);
    return { notification: existing.rows[0], created: false };
  }
  async listByUser(userId) {
    const { rows } = await this.pool.query('SELECT * FROM notification.notifications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows;
  }
  async markRead(id, userId) {
    const { rows } = await this.pool.query(`UPDATE notification.notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId]);
    return rows[0] || null;
  }
}
