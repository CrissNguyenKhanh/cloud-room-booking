import { runInTransaction } from "./transaction.js";

// Cột đánh giá trả ra ngoài (không lộ user_id; admin dùng REVIEW_ADMIN_COLUMNS).
const REVIEW_COLUMNS = `rv.id, rv.booking_id, rv.room_id, r.name AS room_name, rv.rating, rv.title, rv.comment,
  rv.reviewer_name, rv.status, rv.created_at, rv.updated_at`;
const REVIEW_ADMIN_COLUMNS = `${REVIEW_COLUMNS}, rv.user_id, b.booking_code`;
const REVIEW_FROM = `FROM booking.reviews rv JOIN booking.rooms r ON r.id = rv.room_id
  JOIN booking.bookings b ON b.id = rv.booking_id`;

export class ReviewRepository {
  constructor(pool) {
    this.pool = pool;
  }

  transaction(work) {
    return runInTransaction(this.pool, work);
  }

  // ---------- Đánh giá ----------
  async findReviewByBooking(db, bookingId) {
    const { rows } = await db.query(
      "SELECT * FROM booking.reviews WHERE booking_id = $1",
      [bookingId],
    );
    return rows[0] || null;
  }
  async getReviewView(db, id, admin = false) {
    const { rows } = await db.query(
      `SELECT ${admin ? REVIEW_ADMIN_COLUMNS : REVIEW_COLUMNS} ${REVIEW_FROM} WHERE rv.id = $1`,
      [id],
    );
    return rows[0] || null;
  }
  async insertReview(db, data) {
    const { rows } = await db.query(
      `INSERT INTO booking.reviews
      (booking_id, room_id, user_id, rating, title, comment, reviewer_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        data.bookingId,
        data.roomId,
        data.userId,
        data.rating,
        data.title,
        data.comment,
        data.reviewerName,
      ],
    );
    return this.getReviewView(db, rows[0].id);
  }
  async findReviewForUpdate(db, id) {
    const { rows } = await db.query(
      "SELECT * FROM booking.reviews WHERE id = $1 FOR UPDATE",
      [id],
    );
    return rows[0] || null;
  }
  async updateReview(db, id, data) {
    await db.query(
      `UPDATE booking.reviews SET rating = COALESCE($2, rating), title = COALESCE($3, title),
      comment = COALESCE($4, comment), reviewer_name = COALESCE($5, reviewer_name), updated_at = now()
      WHERE id = $1`,
      [
        id,
        data.rating ?? null,
        data.title ?? null,
        data.comment ?? null,
        data.reviewer_name ?? null,
      ],
    );
    return this.getReviewView(db, id);
  }
  async deleteReview(db, id) {
    await db.query("DELETE FROM booking.reviews WHERE id = $1", [id]);
  }
  async setReviewStatus(id, status) {
    const { rowCount } = await this.pool.query(
      "UPDATE booking.reviews SET status = $2, updated_at = now() WHERE id = $1",
      [id, status],
    );
    return rowCount ? this.getReviewView(this.pool, id, true) : null;
  }
  // Đánh giá công khai của một phòng (chỉ VISIBLE), mới nhất trước.
  async listRoomReviews(roomId, { rating, page, limit }) {
    const { rows } = await this.pool.query(
      `SELECT ${REVIEW_COLUMNS}, count(*) OVER()::int AS total_count ${REVIEW_FROM}
      WHERE rv.room_id = $1 AND rv.status = 'VISIBLE' AND ($2::int IS NULL OR rv.rating = $2)
      ORDER BY rv.created_at DESC LIMIT $3 OFFSET $4`,
      [roomId, rating ?? null, limit, (page - 1) * limit],
    );
    return {
      reviews: rows.map(({ total_count: _total, ...review }) => review),
      total: rows[0]?.total_count ?? 0,
    };
  }
  async getReviewSummary(roomId) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS review_count,
      COALESCE(round(avg(rating)::numeric, 1), 0)::float8 AS average_rating,
      count(*) FILTER (WHERE rating = 1)::int AS r1, count(*) FILTER (WHERE rating = 2)::int AS r2,
      count(*) FILTER (WHERE rating = 3)::int AS r3, count(*) FILTER (WHERE rating = 4)::int AS r4,
      count(*) FILTER (WHERE rating = 5)::int AS r5
      FROM booking.reviews WHERE room_id = $1 AND status = 'VISIBLE'`,
      [roomId],
    );
    return rows[0];
  }
  async listMyReviews(userId, { page, limit }) {
    const { rows } = await this.pool.query(
      `SELECT ${REVIEW_COLUMNS}, count(*) OVER()::int AS total_count ${REVIEW_FROM}
      WHERE rv.user_id = $1 ORDER BY rv.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, (page - 1) * limit],
    );
    return {
      reviews: rows.map(({ total_count: _total, ...review }) => review),
      total: rows[0]?.total_count ?? 0,
    };
  }
  async listAdminReviews({ status, room_id: roomId, rating, page, limit }) {
    const { rows } = await this.pool.query(
      `SELECT ${REVIEW_ADMIN_COLUMNS}, count(*) OVER()::int AS total_count ${REVIEW_FROM}
      WHERE ($1::text IS NULL OR rv.status = $1) AND ($2::uuid IS NULL OR rv.room_id = $2)
        AND ($3::int IS NULL OR rv.rating = $3)
      ORDER BY rv.created_at DESC LIMIT $4 OFFSET $5`,
      [
        status ?? null,
        roomId ?? null,
        rating ?? null,
        limit,
        (page - 1) * limit,
      ],
    );
    return {
      reviews: rows.map(({ total_count: _total, ...review }) => review),
      total: rows[0]?.total_count ?? 0,
    };
  }
}
