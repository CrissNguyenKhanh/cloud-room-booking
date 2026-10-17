// Các cột trả về cho khách (không có request_hash / idempotency_key).
const BOOKING_COLUMNS = `b.id, b.booking_code, b.room_id, r.room_number, r.name AS room_name, r.room_type,
  b.user_id, b.status, b.check_in_date, b.check_out_date, b.nights, b.guests, b.price_per_night, b.total_price,
  b.cancel_reason, b.created_at, b.updated_at,
  COALESCE((SELECT p.status FROM booking.payments p WHERE p.booking_id = b.id
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1), 'UNPAID') AS payment_status`;
const BOOKING_FROM = 'FROM booking.bookings b JOIN booking.rooms r ON r.id = b.room_id';
const PAYMENT_COLUMNS = `p.id, p.booking_id, p.provider, p.amount, p.currency, p.status,
  p.provider_transaction_id, p.failure_reason, p.created_at, p.updated_at, p.paid_at`;

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

  // ---------- Phòng ----------
  async listRooms({ includeInactive = false } = {}) {
    const { rows } = await this.pool.query(`SELECT r.* FROM booking.rooms r
      WHERE ($1::boolean OR r.active = true)
      ORDER BY r.featured DESC, r.room_number`, [includeInactive]);
    return rows;
  }
  async getRoom(id, includeInactive = false) {
    const { rows } = await this.pool.query(`SELECT r.* FROM booking.rooms r
      WHERE r.id = $1 AND ($2::boolean OR r.active = true)`, [id, includeInactive]);
    return rows[0] || null;
  }
  // Tìm phòng đang hoạt động. Nếu có check_in/check_out thì loại phòng đã có đơn CONFIRMED chồng khoảng ngày [in, out).
  async searchRooms(filters) {
    const { rows } = await this.pool.query(`SELECT r.*, count(*) OVER()::int AS total_count
      FROM booking.rooms r
      WHERE r.active = true
        AND ($1::int IS NULL OR r.capacity >= $1)
        AND ($2::text IS NULL OR r.room_type = $2)
        AND ($3::int IS NULL OR r.price_per_night >= $3)
        AND ($4::int IS NULL OR r.price_per_night <= $4)
        AND ($5::date IS NULL OR NOT EXISTS (
          SELECT 1 FROM booking.bookings b
          WHERE b.room_id = r.id AND b.status = 'CONFIRMED'
            AND daterange(b.check_in_date, b.check_out_date, '[)') && daterange($5::date, $6::date, '[)')))
      ORDER BY r.featured DESC, r.price_per_night, r.room_number
      LIMIT $7 OFFSET $8`,
    [filters.guests ?? null, filters.roomType ?? null, filters.minPrice ?? null, filters.maxPrice ?? null,
      filters.checkIn ?? null, filters.checkOut ?? null, filters.limit, (filters.page - 1) * filters.limit]);
    return { rooms: rows.map(({ total_count: _total, ...room }) => room), total: rows[0]?.total_count ?? 0 };
  }
  async isRoomAvailable(roomId, checkIn, checkOut) {
    const { rows } = await this.pool.query(`SELECT NOT EXISTS (
      SELECT 1 FROM booking.bookings b WHERE b.room_id = $1 AND b.status = 'CONFIRMED'
        AND daterange(b.check_in_date, b.check_out_date, '[)') && daterange($2::date, $3::date, '[)')) AS available`,
    [roomId, checkIn, checkOut]);
    return rows[0].available;
  }
  // Các khoảng đã đặt (CONFIRMED) của một phòng chồng lên cửa sổ [from, to).
  async listBookedRanges(roomId, from, to) {
    const { rows } = await this.pool.query(`SELECT b.check_in_date, b.check_out_date
      FROM booking.bookings b WHERE b.room_id = $1 AND b.status = 'CONFIRMED'
        AND daterange(b.check_in_date, b.check_out_date, '[)') && daterange($2::date, $3::date, '[)')
      ORDER BY b.check_in_date`, [roomId, from, to]);
    return rows;
  }
  async findActiveRoom(db, id) {
    const { rows } = await db.query(`SELECT id, room_number, name, capacity, price_per_night
      FROM booking.rooms WHERE id = $1 AND active = true`, [id]);
    return rows[0] || null;
  }

  // ---------- Đặt phòng ----------
  async findIdempotent(db, userId, key, lock = false) {
    const { rows } = await db.query(`SELECT ${BOOKING_COLUMNS}, b.request_hash ${BOOKING_FROM}
      WHERE b.user_id = $1 AND b.idempotency_key = $2 ${lock ? 'FOR UPDATE OF b' : ''}`, [userId, key]);
    return rows[0] || null;
  }
  async insertBooking(db, data) {
    const { rows } = await db.query(`INSERT INTO booking.bookings
      (room_id, user_id, status, idempotency_key, request_hash, booking_code,
       check_in_date, check_out_date, guests, nights, price_per_night, total_price)
      VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [data.roomId, data.userId, data.idempotencyKey, data.requestHash, data.bookingCode,
      data.checkInDate, data.checkOutDate, data.guests, data.nights, data.pricePerNight, data.totalPrice]);
    return this.getBookingView(db, rows[0].id);
  }
  async getBookingView(db, id) {
    const { rows } = await db.query(`SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.id = $1`, [id]);
    return rows[0] || null;
  }
  async listMine(userId, { status, when, today, page, limit }) {
    // when = upcoming: sắp tới xếp tăng dần theo ngày nhận; còn lại xếp mới nhất trước.
    const { rows } = await this.pool.query(`SELECT ${BOOKING_COLUMNS}, count(*) OVER()::int AS total_count ${BOOKING_FROM}
      WHERE b.user_id = $1
        AND ($2::text IS NULL OR b.status = $2)
        AND ($3::text IS NULL
          OR ($3 = 'upcoming' AND b.check_out_date >= $4::date)
          OR ($3 = 'past' AND b.check_out_date < $4::date))
      ORDER BY (CASE WHEN $3::text = 'upcoming' THEN b.check_in_date END) ASC, b.check_in_date DESC, b.created_at DESC
      LIMIT $5 OFFSET $6`,
    [userId, status ?? null, when ?? null, today, limit, (page - 1) * limit]);
    return { bookings: rows.map(({ total_count: _total, ...booking }) => booking), total: rows[0]?.total_count ?? 0 };
  }
  async findBooking(db, id) {
    const { rows } = await db.query('SELECT * FROM booking.bookings WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] || null;
  }
  async markCancelled(db, id, reason) {
    await db.query(`UPDATE booking.bookings SET status = 'CANCELLED', cancel_reason = $2,
      updated_at = now() WHERE id = $1`, [id, reason]);
    return this.getBookingView(db, id);
  }
  async listBookings({ status, roomId, userId, page, limit }) {
    const { rows } = await this.pool.query(`SELECT ${BOOKING_COLUMNS}, count(*) OVER()::int AS total_count ${BOOKING_FROM}
      WHERE ($1::text IS NULL OR b.status = $1) AND ($2::uuid IS NULL OR b.room_id = $2)
        AND ($3::uuid IS NULL OR b.user_id = $3)
      ORDER BY b.created_at DESC LIMIT $4 OFFSET $5`,
    [status ?? null, roomId ?? null, userId ?? null, limit, (page - 1) * limit]);
    return { bookings: rows.map(({ total_count: _total, ...booking }) => booking), total: rows[0]?.total_count ?? 0 };
  }

  // ---------- Thanh toán ----------
  async findBookingForPayment(db, id) {
    const { rows } = await db.query(`SELECT id, booking_code, user_id, status, total_price
      FROM booking.bookings WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] || null;
  }
  async findPaymentByIdempotency(db, userId, key, lock = false) {
    const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM booking.payments p
      WHERE p.user_id = $1 AND p.idempotency_key = $2 ${lock ? 'FOR UPDATE' : ''}`, [userId, key]);
    return rows[0] || null;
  }
  async findActivePayment(db, bookingId, lock = false) {
    const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM booking.payments p
      WHERE p.booking_id = $1 AND p.status IN ('PENDING', 'SUCCEEDED')
      ORDER BY p.created_at DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [bookingId]);
    return rows[0] || null;
  }
  async insertPendingPayment(db, data) {
    const { rows } = await db.query(`INSERT INTO booking.payments
      (booking_id, user_id, provider, amount, currency, status, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) RETURNING id`,
    [data.bookingId, data.userId, data.provider, data.amount, data.currency, data.idempotencyKey]);
    return this.getPayment(db, rows[0].id);
  }
  async getPayment(db, id) {
    const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM booking.payments p WHERE p.id = $1`, [id]);
    return rows[0] || null;
  }
  async markPaymentSucceeded(db, id, transactionId) {
    const { rows } = await db.query(`UPDATE booking.payments p SET status = 'SUCCEEDED',
      provider_transaction_id = $2, failure_reason = NULL, paid_at = now(), updated_at = now()
      WHERE p.id = $1 AND p.status = 'PENDING' RETURNING ${PAYMENT_COLUMNS}`, [id, transactionId]);
    return rows[0] || this.getPayment(db, id);
  }
  async markPaymentFailed(db, id, reason) {
    const { rows } = await db.query(`UPDATE booking.payments p SET status = 'FAILED',
      provider_transaction_id = NULL, failure_reason = $2, paid_at = NULL, updated_at = now()
      WHERE p.id = $1 AND p.status = 'PENDING' RETURNING ${PAYMENT_COLUMNS}`, [id, reason]);
    return rows[0] || this.getPayment(db, id);
  }
  async getLatestPayment(db, bookingId) {
    const { rows } = await db.query(`SELECT ${PAYMENT_COLUMNS} FROM booking.payments p
      WHERE p.booking_id = $1 ORDER BY p.created_at DESC, p.id DESC LIMIT 1`, [bookingId]);
    return rows[0] || null;
  }
  async hasSuccessfulPayment(db, bookingId) {
    const { rows } = await db.query(`SELECT EXISTS (
      SELECT 1 FROM booking.payments p WHERE p.booking_id = $1 AND p.status = 'SUCCEEDED'
    ) AS paid`, [bookingId]);
    return rows[0].paid;
  }

  // ---------- Admin: quản lý phòng ----------
  async createRoom(data) {
    const { rows } = await this.pool.query(`INSERT INTO booking.rooms
      (room_number, name, room_type, price_per_night, capacity, size_sqm, bed_type, view_label, floor,
       featured, equipment, description, palette, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [data.room_number, data.name, data.room_type, data.price_per_night, data.capacity, data.size_sqm ?? null,
      data.bed_type, data.view_label, data.floor ?? null, data.featured, JSON.stringify(data.equipment),
      data.description, JSON.stringify(data.palette), data.active]);
    return rows[0];
  }
  async updateRoom(id, data) {
    const json = (value) => (value === undefined ? null : JSON.stringify(value));
    const { rows } = await this.pool.query(`UPDATE booking.rooms SET
      room_number = COALESCE($2, room_number), name = COALESCE($3, name), room_type = COALESCE($4, room_type),
      price_per_night = COALESCE($5, price_per_night), capacity = COALESCE($6, capacity),
      size_sqm = COALESCE($7, size_sqm), bed_type = COALESCE($8, bed_type), view_label = COALESCE($9, view_label),
      floor = COALESCE($10, floor), featured = COALESCE($11, featured), equipment = COALESCE($12::jsonb, equipment),
      description = COALESCE($13, description), palette = COALESCE($14::jsonb, palette),
      active = COALESCE($15, active), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, data.room_number ?? null, data.name ?? null, data.room_type ?? null, data.price_per_night ?? null,
      data.capacity ?? null, data.size_sqm ?? null, data.bed_type ?? null, data.view_label ?? null,
      data.floor ?? null, data.featured ?? null, json(data.equipment), data.description ?? null,
      json(data.palette), data.active ?? null]);
    return rows[0] || null;
  }

  // ---------- Outbox ----------
  async insertOutbox(db, { eventType, aggregateId, userId, payload }) {
    const { rows } = await db.query(`INSERT INTO booking.outbox_events (event_type, aggregate_id, user_id, payload)
      VALUES ($1, $2, $3, $4) RETURNING *`, [eventType, aggregateId, userId, payload]);
    return rows[0];
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

  // ---------- Room media ----------
  // Writers lock the room row so ordering and the single-cover invariant are
  // serialized for concurrent changes to the same room.
  async listMedia(roomId) {
    const { rows } = await this.pool.query(`SELECT * FROM booking.room_media WHERE room_id = $1
      ORDER BY is_cover DESC, sort_order, created_at`, [roomId]);
    return rows;
  }

  async getMedia(roomId, mediaId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM booking.room_media WHERE id = $1 AND room_id = $2',
      [mediaId, roomId],
    );
    return rows[0] || null;
  }

  async addMedia(roomId, data, maxPerRoom) {
    return this.transaction(async (db) => {
      const room = await db.query(
        'SELECT id FROM booking.rooms WHERE id = $1 FOR UPDATE',
        [roomId],
      );
      if (!room.rowCount) return { outcome: 'ROOM_NOT_FOUND' };

      const { rows: [stats] } = await db.query(`SELECT count(*)::int AS total,
        COALESCE(max(sort_order), 0) AS max_order,
        COALESCE(bool_or(is_cover), false) AS has_cover
        FROM booking.room_media WHERE room_id = $1`, [roomId]);
      if (stats.total >= maxPerRoom) return { outcome: 'LIMIT_REACHED' };

      const { rows } = await db.query(`INSERT INTO booking.room_media
        (room_id, media_type, url, thumbnail_url, public_id, format, bytes, width,
         height, duration_seconds, alt_text, sort_order, is_cover)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`, [
        roomId,
        data.media_type,
        data.url,
        data.thumbnail_url ?? null,
        data.public_id,
        data.format ?? null,
        data.bytes ?? null,
        data.width ?? null,
        data.height ?? null,
        data.duration_seconds ?? null,
        data.alt_text ?? '',
        stats.max_order + 1,
        data.media_type === 'image' && !stats.has_cover,
      ]);
      return { outcome: 'OK', media: rows[0] };
    });
  }

  async updateMedia(roomId, mediaId, data) {
    return this.transaction(async (db) => {
      const room = await db.query(
        'SELECT id FROM booking.rooms WHERE id = $1 FOR UPDATE',
        [roomId],
      );
      if (!room.rowCount) return { outcome: 'ROOM_NOT_FOUND' };

      const { rows: [current] } = await db.query(
        'SELECT * FROM booking.room_media WHERE id = $1 AND room_id = $2 FOR UPDATE',
        [mediaId, roomId],
      );
      if (!current) return { outcome: 'MEDIA_NOT_FOUND' };
      if (data.is_cover === true) {
        if (current.media_type !== 'image') return { outcome: 'NOT_IMAGE' };
        await db.query(`UPDATE booking.room_media SET is_cover = false, updated_at = now()
          WHERE room_id = $1 AND is_cover AND id <> $2`, [roomId, mediaId]);
      }

      const { rows } = await db.query(`UPDATE booking.room_media
        SET alt_text = COALESCE($3, alt_text), sort_order = COALESCE($4, sort_order),
          is_cover = COALESCE($5, is_cover), updated_at = now()
        WHERE id = $1 AND room_id = $2 RETURNING *`, [
        mediaId,
        roomId,
        data.alt_text ?? null,
        data.sort_order ?? null,
        data.is_cover ?? null,
      ]);
      return { outcome: 'OK', media: rows[0] };
    });
  }

  async replaceMediaFile(roomId, mediaId, data) {
    return this.transaction(async (db) => {
      const room = await db.query(
        'SELECT id FROM booking.rooms WHERE id = $1 FOR UPDATE',
        [roomId],
      );
      if (!room.rowCount) return { outcome: 'ROOM_NOT_FOUND' };

      const { rows: [current] } = await db.query(
        'SELECT * FROM booking.room_media WHERE id = $1 AND room_id = $2 FOR UPDATE',
        [mediaId, roomId],
      );
      if (!current) return { outcome: 'MEDIA_NOT_FOUND' };

      const { rows } = await db.query(`UPDATE booking.room_media
        SET media_type = $3, url = $4, thumbnail_url = $5, public_id = $6,
          format = $7, bytes = $8, width = $9, height = $10,
          duration_seconds = $11, alt_text = COALESCE($12, alt_text),
          is_cover = CASE WHEN $3 = 'video' THEN false ELSE is_cover END,
          updated_at = now()
        WHERE id = $1 AND room_id = $2 RETURNING *`, [
        mediaId,
        roomId,
        data.media_type,
        data.url,
        data.thumbnail_url ?? null,
        data.public_id,
        data.format ?? null,
        data.bytes ?? null,
        data.width ?? null,
        data.height ?? null,
        data.duration_seconds ?? null,
        data.alt_text ?? null,
      ]);
      let updated = rows[0];

      if (current.is_cover && data.media_type === 'video') {
        await db.query(`UPDATE booking.room_media SET is_cover = true, updated_at = now()
          WHERE id = (SELECT id FROM booking.room_media
            WHERE room_id = $1 AND media_type = 'image'
            ORDER BY sort_order, created_at LIMIT 1)`, [roomId]);
      } else if (data.media_type === 'image') {
        const { rows: coverRows } = await db.query(`UPDATE booking.room_media
          SET is_cover = true, updated_at = now()
          WHERE id = $2 AND NOT EXISTS (
            SELECT 1 FROM booking.room_media WHERE room_id = $1 AND is_cover
          ) RETURNING *`, [roomId, mediaId]);
        if (coverRows[0]) updated = coverRows[0];
      }

      return { outcome: 'OK', media: updated, previous: current };
    });
  }

  async deleteMedia(roomId, mediaId) {
    return this.transaction(async (db) => {
      const room = await db.query(
        'SELECT id FROM booking.rooms WHERE id = $1 FOR UPDATE',
        [roomId],
      );
      if (!room.rowCount) return { outcome: 'ROOM_NOT_FOUND' };

      const { rows: [deleted] } = await db.query(
        'DELETE FROM booking.room_media WHERE id = $1 AND room_id = $2 RETURNING *',
        [mediaId, roomId],
      );
      if (!deleted) return { outcome: 'MEDIA_NOT_FOUND' };
      if (deleted.is_cover) {
        await db.query(`UPDATE booking.room_media SET is_cover = true, updated_at = now()
          WHERE id = (SELECT id FROM booking.room_media
            WHERE room_id = $1 AND media_type = 'image'
            ORDER BY sort_order, created_at LIMIT 1)`, [roomId]);
      }
      return { outcome: 'OK', media: deleted };
    });
  }
}
