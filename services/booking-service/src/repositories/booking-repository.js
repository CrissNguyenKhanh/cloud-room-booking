export class BookingRepository {
  constructor(pool) { this.pool = pool; }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async listRooms() {
    const { rows } = await this.pool.query(`SELECT id, name, capacity, equipment, active, created_at, updated_at
      FROM booking.rooms WHERE active = true ORDER BY name`);
    return rows;
  }
  async getRoom(id, includeInactive = false) {
    const { rows } = await this.pool.query(`SELECT id, name, capacity, equipment, active, created_at, updated_at
      FROM booking.rooms WHERE id = $1 AND ($2::boolean OR active = true)`, [id, includeInactive]);
    return rows[0] || null;
  }
  async availability(roomId, date) {
    const { rows } = await this.pool.query(`SELECT s.id, s.code, s.start_time, s.end_time,
      NOT EXISTS (SELECT 1 FROM booking.bookings b WHERE b.room_id = $1 AND b.booking_date = $2
        AND b.slot_id = s.id AND b.status = 'CONFIRMED') AS available
      FROM booking.slots s WHERE s.active = true ORDER BY s.start_time`, [roomId, date]);
    return rows;
  }
  async findIdempotent(db, userId, key, lock = false) {
    const { rows } = await db.query(`SELECT * FROM booking.bookings WHERE user_id = $1 AND idempotency_key = $2 ${lock ? 'FOR UPDATE' : ''}`, [userId, key]);
    return rows[0] || null;
  }
  async findActiveRoom(db, id) {
    const { rows } = await db.query('SELECT id, name FROM booking.rooms WHERE id = $1 AND active = true', [id]);
    return rows[0] || null;
  }
  async findActiveSlot(db, id) {
    const { rows } = await db.query('SELECT id, code, start_time, end_time FROM booking.slots WHERE id = $1 AND active = true', [id]);
    return rows[0] || null;
  }
  async insertBooking(db, data) {
    const { rows } = await db.query(`INSERT INTO booking.bookings
      (room_id, user_id, booking_date, slot_id, status, idempotency_key, request_hash)
      VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6) RETURNING *`,
    [data.roomId, data.userId, data.bookingDate, data.slotId, data.idempotencyKey, data.requestHash]);
    return rows[0];
  }
  async insertOutbox(db, { eventType, aggregateId, userId, payload }) {
    const { rows } = await db.query(`INSERT INTO booking.outbox_events (event_type, aggregate_id, user_id, payload)
      VALUES ($1, $2, $3, $4) RETURNING *`, [eventType, aggregateId, userId, payload]);
    return rows[0];
  }
  async listMine(userId) {
    const { rows } = await this.pool.query(`SELECT b.*, r.name AS room_name, s.code AS slot_code,
      s.start_time, s.end_time FROM booking.bookings b JOIN booking.rooms r ON r.id = b.room_id
      JOIN booking.slots s ON s.id = b.slot_id WHERE b.user_id = $1 ORDER BY b.booking_date DESC, s.start_time`, [userId]);
    return rows;
  }
  async findBooking(db, id) {
    const { rows } = await db.query('SELECT * FROM booking.bookings WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] || null;
  }
  async markCancelled(db, id, reason) {
    const { rows } = await db.query(`UPDATE booking.bookings SET status = 'CANCELLED', cancel_reason = $2,
      updated_at = now() WHERE id = $1 RETURNING *`, [id, reason]);
    return rows[0];
  }
  async listBookings() {
    const { rows } = await this.pool.query(`SELECT b.*, r.name AS room_name, s.code AS slot_code
      FROM booking.bookings b JOIN booking.rooms r ON r.id = b.room_id JOIN booking.slots s ON s.id = b.slot_id
      ORDER BY b.created_at DESC`);
    return rows;
  }
  async createRoom(data) {
    const { rows } = await this.pool.query(`INSERT INTO booking.rooms (name, capacity, equipment, active)
      VALUES ($1, $2, $3, $4) RETURNING *`, [data.name, data.capacity, JSON.stringify(data.equipment), data.active]);
    return rows[0];
  }
  async updateRoom(id, data) {
    const { rows } = await this.pool.query(`UPDATE booking.rooms SET name = COALESCE($2, name),
      capacity = COALESCE($3, capacity), equipment = COALESCE($4::jsonb, equipment),
      active = COALESCE($5, active), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, data.name ?? null, data.capacity ?? null, data.equipment === undefined ? null : JSON.stringify(data.equipment), data.active ?? null]);
    return rows[0] || null;
  }
  async getOutbox(id) {
    const { rows } = await this.pool.query('SELECT * FROM booking.outbox_events WHERE event_id = $1', [id]);
    return rows[0] || null;
  }
  async listOutbox() {
    const { rows } = await this.pool.query('SELECT * FROM booking.outbox_events ORDER BY created_at DESC LIMIT 200');
    return rows;
  }
  async listDueOutbox(limit) {
    const { rows } = await this.pool.query(`SELECT * FROM booking.outbox_events WHERE status = 'PENDING'
      AND next_retry_at <= now() ORDER BY created_at LIMIT $1`, [limit]);
    return rows;
  }
  async markOutboxSent(id) {
    await this.pool.query(`UPDATE booking.outbox_events SET status = 'SENT', last_error = NULL, updated_at = now() WHERE event_id = $1`, [id]);
  }
  async markOutboxFailure(id, { attempts, status, nextRetryAt, error }) {
    await this.pool.query(`UPDATE booking.outbox_events SET attempts = $2, status = $3,
      next_retry_at = $4, last_error = $5, updated_at = now() WHERE event_id = $1`,
    [id, attempts, status, nextRetryAt, String(error).slice(0, 500)]);
  }
}
