import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { todayInVietnam, addDays } from '../src/utils/stay.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const admin = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const config = {
  nodeEnv: 'test', frontendOrigin: 'http://localhost:5173', serviceName: 'booking-service',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters', jwtIssuer: 'test-issuer', jwtAudience: 'test-audience',
  identityServiceUrl: 'http://identity', notificationServiceUrl: 'http://notification', internalServiceKey: 'test-service-key-long-enough',
  identityTimeoutMs: 100, notificationTimeoutMs: 100, outboxMaxAttempts: 3, outboxBatchSize: 10
};
const token = (sub, role = 'USER') => jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret,
  { subject: sub, issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
const auth = (sub, role) => ({ Authorization: `Bearer ${token(sub, role)}` });

class FakeRepository {
  constructor() {
    this.pool = this;
    this.bookings = new Map();
    this.reviews = new Map();
    this.queue = Promise.resolve();
  }
  addBooking(overrides = {}) {
    const today = todayInVietnam();
    const booking = { id: randomUUID(), room_id: roomId, user_id: userA, status: 'CONFIRMED', booking_code: 'BK-TEST',
      check_in_date: addDays(today, -3), check_out_date: addDays(today, -1), payment_status: 'UNPAID', ...overrides };
    this.bookings.set(booking.id, booking);
    return booking;
  }
  async transaction(work) {
    let unlock;
    const previous = this.queue;
    this.queue = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try { return await work(this); } finally { unlock(); }
  }
  async findBooking(_db, id) { return this.bookings.get(id) || null; }
  async getBookingView(_db, id) { return this.bookings.get(id) || null; }
  async getRoom(id) { return id === roomId ? { id: roomId, name: 'Room A' } : null; }
  async findReviewByBooking(_db, bookingId) { return [...this.reviews.values()].find((r) => r.booking_id === bookingId) || null; }
  async insertReview(_db, data) {
    if (await this.findReviewByBooking(_db, data.bookingId)) {
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }
    const review = { id: randomUUID(), booking_id: data.bookingId, room_id: data.roomId, user_id: data.userId, rating: data.rating,
      title: data.title, comment: data.comment, reviewer_name: data.reviewerName, status: 'VISIBLE' };
    this.reviews.set(review.id, review); return this.publicReview(review);
  }
  publicReview({ user_id: _userId, ...review }) { return { ...review }; }
  async getReviewView(_db, id, adminView = false) {
    const review = this.reviews.get(id);
    return review ? (adminView ? { ...review } : this.publicReview(review)) : null;
  }
  async findReviewForUpdate(_db, id) { return this.reviews.get(id) || null; }
  async updateReview(_db, id, data) {
    const review = this.reviews.get(id);
    for (const key of ['rating', 'title', 'comment', 'reviewer_name']) if (data[key] !== undefined) review[key] = data[key];
    return this.publicReview(review);
  }
  async deleteReview(_db, id) { this.reviews.delete(id); }
  async listRoomReviews(requestedRoomId, { rating, page = 1, limit = 10 } = {}) {
    const visible = [...this.reviews.values()].filter((r) => r.room_id === requestedRoomId
      && r.status === 'VISIBLE' && (rating === undefined || r.rating === rating));
    return { reviews: visible.slice((page - 1) * limit, page * limit).map((r) => this.publicReview(r)), total: visible.length };
  }
  async getReviewSummary(requestedRoomId) {
    const visible = [...this.reviews.values()].filter((r) => r.room_id === requestedRoomId && r.status === 'VISIBLE');
    const count = (n) => visible.filter((r) => r.rating === n).length;
    return { review_count: visible.length, average_rating: visible.length ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0,
      r1: count(1), r2: count(2), r3: count(3), r4: count(4), r5: count(5) };
  }
  async listMyReviews(requestedUserId, { page = 1, limit = 10 } = {}) {
    const mine = [...this.reviews.values()].filter((review) => review.user_id === requestedUserId);
    return { reviews: mine.slice((page - 1) * limit, page * limit).map((review) => this.publicReview(review)), total: mine.length };
  }
  async listAdminReviews({ status, room_id: requestedRoomId, rating, page = 1, limit = 20 } = {}) {
    const reviews = [...this.reviews.values()].filter((review) => (!status || review.status === status)
      && (!requestedRoomId || review.room_id === requestedRoomId)
      && (rating === undefined || review.rating === rating));
    return { reviews: reviews.slice((page - 1) * limit, page * limit).map((review) => ({ ...review })), total: reviews.length };
  }
  async setReviewStatus(id, status) {
    const review = this.reviews.get(id);
    if (!review) return null;
    review.status = status;
    return { ...review };
  }
}

function build() {
  const repository = new FakeRepository();
  const app = createApp({ pool: { query: async () => ({ rows: [] }) }, config, repository, reviewRepository: repository, identityClient: {}, notificationClient: {},
    dispatcher: { dispatchById: async () => {}, retryBatch: async () => [] } });
  return { app, repository };
}

test('reviewing requires authentication', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).send({ rating: 5 }).expect(401);
});

test('owner reviews a completed stay and gets 201', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  const response = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA))
    .send({ rating: 5, comment: 'Rất tốt', display_name: 'An' }).expect(201);
  assert.equal(response.body.data.rating, 5);
  assert.equal(response.body.data.reviewer_name, 'An');
  assert.equal('user_id' in response.body.data, false);
});

test('checkout day itself is already reviewable', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking({ check_in_date: addDays(todayInVietnam(), -2), check_out_date: todayInVietnam() });
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 4 }).expect(201);
});

test('a stay that has not checked out yet cannot be reviewed', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking({ check_in_date: todayInVietnam(), check_out_date: addDays(todayInVietnam(), 2) });
  const response = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 5 }).expect(409);
  assert.equal(response.body.error.code, 'STAY_NOT_COMPLETED');
});

test('a cancelled booking cannot be reviewed', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking({ status: 'CANCELLED' });
  const response = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 5 }).expect(409);
  assert.equal(response.body.error.code, 'BOOKING_NOT_REVIEWABLE');
});

test("another user's booking looks like it does not exist", async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userB)).send({ rating: 5 }).expect(404);
});

test('a booking can only be reviewed once', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 5 }).expect(201);
  const response = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 4 }).expect(409);
  assert.equal(response.body.error.code, 'REVIEW_ALREADY_EXISTS');
});

test('concurrent review requests create exactly one review', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  const responses = await Promise.all([
    request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 5 }),
    request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 4 }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'REVIEW_ALREADY_EXISTS');
  assert.equal(repository.reviews.size, 1);
});

test('invalid ratings and unknown fields are rejected', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: 'five' }, {}, { rating: 5, extra: true }]) {
    await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send(body).expect(400);
  }
});

test('only the author can edit or delete a review', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  const created = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 3 }).expect(201);
  const id = created.body.data.id;
  await request(app).patch(`/api/v1/reviews/${id}`).set(auth(userB)).send({ rating: 1 }).expect(404);
  await request(app).delete(`/api/v1/reviews/${id}`).set(auth(userB)).expect(404);
  const updated = await request(app).patch(`/api/v1/reviews/${id}`).set(auth(userA)).send({ rating: 5 }).expect(200);
  assert.equal(updated.body.data.rating, 5);
  await request(app).delete(`/api/v1/reviews/${id}`).set(auth(userA)).expect(204);
  assert.equal(repository.reviews.size, 0);
});

test('public room reviews are open and expose a rating summary without user ids', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 4 }).expect(201);
  const response = await request(app).get(`/api/v1/rooms/${roomId}/reviews`).expect(200);
  assert.equal(response.body.summary.review_count, 1);
  assert.equal(response.body.summary.average_rating, 4);
  assert.equal(response.body.summary.distribution[4], 1);
  assert.equal(response.body.data.length, 1);
  assert.equal('user_id' in response.body.data[0], false);
  await request(app).get('/api/v1/rooms/22222222-2222-4222-8222-222222222222/reviews').expect(404);
});

test('booking detail preserves payment fields and includes review state', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking({ payment_status: 'SUCCEEDED' });
  const before = await request(app).get(`/api/v1/bookings/${booking.id}`).set(auth(userA)).expect(200);
  assert.equal(before.body.data.payment_status, 'SUCCEEDED');
  assert.equal(before.body.data.can_cancel, false);
  assert.equal(before.body.data.can_review, true);
  assert.equal(before.body.data.review_id, null);

  const created = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA))
    .send({ rating: 5 }).expect(201);
  const after = await request(app).get(`/api/v1/bookings/${booking.id}`).set(auth(userA)).expect(200);
  assert.equal(after.body.data.payment_status, 'SUCCEEDED');
  assert.equal(after.body.data.can_review, false);
  assert.equal(after.body.data.review_id, created.body.data.id);
});

test('booking review and my reviews are private to the owner', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  const created = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA))
    .send({ rating: 5 }).expect(201);
  await request(app).get(`/api/v1/bookings/${booking.id}/review`).set(auth(userB)).expect(404);
  const owned = await request(app).get(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).expect(200);
  assert.equal(owned.body.data.id, created.body.data.id);
  assert.equal('user_id' in owned.body.data, false);

  const mine = await request(app).get('/api/v1/reviews/me').set(auth(userA)).expect(200);
  const other = await request(app).get('/api/v1/reviews/me').set(auth(userB)).expect(200);
  assert.equal(mine.body.data.length, 1);
  assert.equal(other.body.data.length, 0);
});

test('admin can hide a review and regular users cannot', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  const created = await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 2 }).expect(201);
  const id = created.body.data.id;
  await request(app).patch(`/api/v1/admin/reviews/${id}/status`).set(auth(userA)).send({ status: 'HIDDEN' }).expect(403);
  await request(app).patch(`/api/v1/admin/reviews/${id}/status`).set(auth(admin, 'ADMIN')).send({ status: 'HIDDEN' }).expect(200);
  const response = await request(app).get(`/api/v1/rooms/${roomId}/reviews`).expect(200);
  assert.equal(response.body.summary.review_count, 0);
  assert.equal(response.body.data.length, 0);
});

test('admin review list requires ADMIN and includes moderation ownership data', async () => {
  const { app, repository } = build();
  const booking = repository.addBooking();
  await request(app).post(`/api/v1/bookings/${booking.id}/review`).set(auth(userA)).send({ rating: 3 }).expect(201);
  await request(app).get('/api/v1/admin/reviews').expect(401);
  await request(app).get('/api/v1/admin/reviews').set(auth(userA)).expect(403);
  const response = await request(app).get('/api/v1/admin/reviews').set(auth(admin, 'ADMIN')).expect(200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].user_id, userA);
});

test('default startup seed contains rooms only and cannot create demo bookings or reviews', async () => {
  const source = await readFile(new URL('../scripts/seed.js', import.meta.url), 'utf8');
  assert.match(source, /INSERT INTO booking\.rooms/);
  assert.doesNotMatch(source, /booking\.bookings/);
  assert.doesNotMatch(source, /booking\.reviews/);
  assert.doesNotMatch(source, /SEED_DEMO_USER/);
});
