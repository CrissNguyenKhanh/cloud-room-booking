import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app.js';

const bookingA = '11111111-1111-4111-8111-111111111111';
const bookingB = '22222222-2222-4222-8222-222222222222';
const cancelledBooking = '33333333-3333-4333-8333-333333333333';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config = {
  nodeEnv: 'test', frontendOrigin: 'http://localhost:5173', serviceName: 'booking-service',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters', jwtIssuer: 'test-issuer', jwtAudience: 'test-audience',
  identityServiceUrl: 'http://identity', notificationServiceUrl: 'http://notification', internalServiceKey: 'test-service-key-long-enough',
  identityTimeoutMs: 100, notificationTimeoutMs: 100, outboxMaxAttempts: 3, outboxBatchSize: 10
};
const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
const identityClient = { assertActive: async () => ({ status: 'ACTIVE' }) };
const dispatcher = { dispatchById: async () => {}, retryBatch: async () => [] };

function token(userId, role = 'USER') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, {
    subject: userId, issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h'
  });
}

const publicPayment = ({ user_id: _userId, idempotency_key: _key, ...payment }) => ({ ...payment });

class PaymentRepositoryFake {
  constructor() {
    const checkIn = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    this.pool = this;
    this.bookings = [
      this.booking(bookingA, userA, 'BK-PAYMENT-A', 2000000, 'CONFIRMED', checkIn, checkOut),
      this.booking(bookingB, userA, 'BK-PAYMENT-B', 3500000, 'CONFIRMED', checkIn, checkOut),
      this.booking(cancelledBooking, userA, 'BK-CANCELLED', 900000, 'CANCELLED', checkIn, checkOut),
      this.booking(randomUUID(), userB, 'BK-USER-B', 1200000, 'CONFIRMED', checkIn, checkOut)
    ];
    this.payments = [];
    this.outbox = [];
    this.queue = Promise.resolve();
  }

  booking(id, userId, code, totalPrice, status, checkIn, checkOut) {
    return {
      id, booking_code: code, room_id: randomUUID(), room_number: code.slice(-1), room_name: `Room ${code}`,
      room_type: 'deluxe', user_id: userId, status, check_in_date: checkIn, check_out_date: checkOut,
      nights: 2, guests: 2, price_per_night: totalPrice / 2, total_price: totalPrice,
      cancel_reason: status === 'CANCELLED' ? 'Cancelled before payment' : null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
  }

  async transaction(work) {
    let unlock;
    const previous = this.queue;
    this.queue = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try { return await work(this); } finally { unlock(); }
  }

  latest(bookingId) {
    return this.payments.filter((payment) => payment.booking_id === bookingId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] || null;
  }

  view(booking) {
    const latest = this.latest(booking.id);
    return { ...booking, payment_status: latest?.status || 'UNPAID' };
  }

  async findBookingForPayment(_db, id) { return this.bookings.find((booking) => booking.id === id) || null; }
  async findPaymentByIdempotency(_db, userId, key) {
    const payment = this.payments.find((candidate) => candidate.user_id === userId && candidate.idempotency_key === key);
    return payment ? publicPayment(payment) : null;
  }
  async findActivePayment(_db, requestedBookingId) {
    const payment = this.payments.find((candidate) => candidate.booking_id === requestedBookingId
      && ['PENDING', 'SUCCEEDED'].includes(candidate.status));
    return payment ? publicPayment(payment) : null;
  }
  async insertPendingPayment(_db, data) {
    if (this.payments.some((payment) => payment.user_id === data.userId && payment.idempotency_key === data.idempotencyKey)
      || this.payments.some((payment) => payment.booking_id === data.bookingId && ['PENDING', 'SUCCEEDED'].includes(payment.status))) {
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }
    const now = new Date().toISOString();
    const payment = {
      id: randomUUID(), booking_id: data.bookingId, user_id: data.userId, provider: data.provider,
      amount: data.amount, currency: data.currency, status: 'PENDING', idempotency_key: data.idempotencyKey,
      provider_transaction_id: null, failure_reason: null, created_at: now, updated_at: now, paid_at: null
    };
    this.payments.push(payment);
    return publicPayment(payment);
  }
  async markPaymentSucceeded(_db, id, transactionId) {
    const payment = this.payments.find((candidate) => candidate.id === id);
    if (payment.status === 'PENDING') {
      payment.status = 'SUCCEEDED'; payment.provider_transaction_id = transactionId;
      payment.updated_at = new Date().toISOString(); payment.paid_at = payment.updated_at;
    }
    return publicPayment(payment);
  }
  async markPaymentFailed(_db, id, reason) {
    const payment = this.payments.find((candidate) => candidate.id === id);
    if (payment.status === 'PENDING') {
      payment.status = 'FAILED'; payment.failure_reason = reason; payment.updated_at = new Date().toISOString();
    }
    return publicPayment(payment);
  }
  async getLatestPayment(_db, requestedBookingId) {
    const payment = this.latest(requestedBookingId);
    return payment ? publicPayment(payment) : null;
  }
  async hasSuccessfulPayment(_db, requestedBookingId) {
    return this.payments.some((payment) => payment.booking_id === requestedBookingId && payment.status === 'SUCCEEDED');
  }
  async getBookingView(_db, id) {
    const booking = this.bookings.find((candidate) => candidate.id === id);
    return booking ? this.view(booking) : null;
  }
  async listMine(userId) {
    const bookings = this.bookings.filter((booking) => booking.user_id === userId).map((booking) => this.view(booking));
    return { bookings, total: bookings.length };
  }
  async listBookings() {
    return { bookings: this.bookings.map((booking) => this.view(booking)), total: this.bookings.length };
  }
  async findBooking(_db, id) { return this.bookings.find((booking) => booking.id === id) || null; }
  async markCancelled(_db, id, reason) {
    const booking = this.bookings.find((candidate) => candidate.id === id);
    booking.status = 'CANCELLED'; booking.cancel_reason = reason;
    return this.view(booking);
  }
  async insertOutbox(_db, event) {
    const value = { event_id: randomUUID(), ...event };
    this.outbox.push(value);
    return value;
  }
}

function fixture({ repository = new PaymentRepositoryFake(), paymentProvider } = {}) {
  return {
    repository,
    app: createApp({ pool, config, repository, identityClient, dispatcher, paymentProvider })
  };
}

function postPayment(app, id, key, user = userA, body = {}) {
  return request(app).post(`/api/v1/bookings/${id}/payments`)
    .set('Authorization', `Bearer ${token(user)}`).set('Idempotency-Key', key).send(body);
}

test('POST payment requires authentication', async () => {
  const { app } = fixture();
  const response = await request(app).post(`/api/v1/bookings/${bookingA}/payments`)
    .set('Idempotency-Key', 'payment-auth-key').send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

test('a user cannot pay another user booking without existence disclosure', async () => {
  const repository = new PaymentRepositoryFake();
  const otherBooking = repository.bookings.find((booking) => booking.user_id === userB);
  const { app } = fixture({ repository });
  const response = await postPayment(app, otherBooking.id, 'payment-owner-key');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'BOOKING_NOT_FOUND');

  const readResponse = await request(app).get(`/api/v1/bookings/${otherBooking.id}/payment`)
    .set('Authorization', `Bearer ${token(userA)}`);
  assert.equal(readResponse.status, 404);
  assert.equal(readResponse.body.error.code, 'BOOKING_NOT_FOUND');
});

test('a cancelled booking is not payable', async () => {
  const { app } = fixture();
  const response = await postPayment(app, cancelledBooking, 'cancelled-payment-key');
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'BOOKING_NOT_PAYABLE');
});

test('payment input is strict and never accepts a client amount', async () => {
  const { app, repository } = fixture();
  const response = await postPayment(app, bookingA, 'client-amount-key', userA, { amount: 1 });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(repository.payments.length, 0);
});

test('payment requires an Idempotency-Key', async () => {
  const { app, repository } = fixture();
  const response = await request(app).post(`/api/v1/bookings/${bookingA}/payments`)
    .set('Authorization', `Bearer ${token(userA)}`).send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(repository.payments.length, 0);
});

test('successful payment uses the booking total and can be fetched', async () => {
  const { app } = fixture();
  const created = await postPayment(app, bookingA, 'successful-payment-key', userA, { provider: 'MOCK' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.booking_id, bookingA);
  assert.equal(created.body.data.provider, 'MOCK');
  assert.equal(created.body.data.amount, 2000000);
  assert.equal(created.body.data.currency, 'VND');
  assert.equal(created.body.data.status, 'SUCCEEDED');
  assert.match(created.body.data.provider_transaction_id, /^MOCK-/);
  assert.ok(created.body.data.paid_at);
  assert.equal('user_id' in created.body.data, false);

  const fetched = await request(app).get(`/api/v1/bookings/${bookingA}/payment`)
    .set('Authorization', `Bearer ${token(userA)}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.id, created.body.data.id);
});

test('GET payment returns null before an attempt exists', async () => {
  const { app } = fixture();
  const response = await request(app).get(`/api/v1/bookings/${bookingA}/payment`)
    .set('Authorization', `Bearer ${token(userA)}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data, null);
});

test('booking detail, customer list, and admin list expose payment_status', async () => {
  const { app } = fixture();
  await postPayment(app, bookingA, 'booking-status-key');

  const detail = await request(app).get(`/api/v1/bookings/${bookingA}`)
    .set('Authorization', `Bearer ${token(userA)}`);
  const mine = await request(app).get('/api/v1/bookings/me')
    .set('Authorization', `Bearer ${token(userA)}`);
  const admin = await request(app).get('/api/v1/admin/bookings')
    .set('Authorization', `Bearer ${token(userB, 'ADMIN')}`);

  assert.equal(detail.body.data.payment_status, 'SUCCEEDED');
  assert.equal(detail.body.data.can_cancel, false);
  assert.equal(mine.body.data.find((booking) => booking.id === bookingA).payment_status, 'SUCCEEDED');
  assert.equal(admin.body.data.find((booking) => booking.id === bookingA).payment_status, 'SUCCEEDED');
  assert.equal(mine.body.data.find((booking) => booking.id === bookingB).payment_status, 'UNPAID');
});

test('same payment Idempotency-Key replays the same payment', async () => {
  const { app, repository } = fixture();
  const first = await postPayment(app, bookingA, 'same-payment-key');
  const replay = await postPayment(app, bookingA, 'same-payment-key');
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(repository.payments.length, 1);
});

test('a succeeded booking is not charged again with a new key', async () => {
  const paymentProvider = {
    calls: 0,
    async charge() {
      this.calls += 1;
      return { success: true, transactionId: `MOCK-${randomUUID()}` };
    }
  };
  const { app, repository } = fixture({ paymentProvider });
  const first = await postPayment(app, bookingA, 'first-success-key');
  const second = await postPayment(app, bookingA, 'second-success-key');
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(paymentProvider.calls, 1);
  assert.equal(repository.payments.length, 1);
});

test('reusing a payment Idempotency-Key for another booking returns 409', async () => {
  const { app } = fixture();
  await postPayment(app, bookingA, 'reused-payment-key');
  const response = await postPayment(app, bookingB, 'reused-payment-key');
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('concurrent payment requests cannot create two successful payments', async () => {
  let enteredProvider;
  let releaseProvider;
  const entered = new Promise((resolve) => { enteredProvider = resolve; });
  const gate = new Promise((resolve) => { releaseProvider = resolve; });
  const provider = {
    calls: 0,
    async charge() {
      this.calls += 1;
      enteredProvider();
      await gate;
      return { success: true, transactionId: `MOCK-${randomUUID()}` };
    }
  };
  const { app, repository } = fixture({ paymentProvider: provider });
  const firstPromise = Promise.resolve(postPayment(app, bookingA, 'concurrent-payment-a'));
  await entered;
  const second = await postPayment(app, bookingA, 'concurrent-payment-b');
  releaseProvider();
  const first = await firstPromise;

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.status, 'PENDING');
  assert.equal(provider.calls, 1);
  assert.equal(repository.payments.filter((payment) => payment.status === 'SUCCEEDED').length, 1);
});

test('cancellation winning the finalization race leaves the payment FAILED', async () => {
  let enteredProvider;
  let releaseProvider;
  const entered = new Promise((resolve) => { enteredProvider = resolve; });
  const gate = new Promise((resolve) => { releaseProvider = resolve; });
  const paymentProvider = {
    async charge() {
      enteredProvider();
      await gate;
      return { success: true, transactionId: `MOCK-${randomUUID()}` };
    }
  };
  const { app, repository } = fixture({ paymentProvider });
  const paymentPromise = Promise.resolve(postPayment(app, bookingA, 'cancel-race-payment-key'));
  await entered;
  const cancelled = await request(app).post(`/api/v1/bookings/${bookingA}/cancel`)
    .set('Authorization', `Bearer ${token(userA)}`).send({ reason: 'Changed plans' });
  releaseProvider();
  const payment = await paymentPromise;

  assert.equal(cancelled.status, 200);
  assert.equal(payment.body.data.status, 'FAILED');
  assert.equal(repository.bookings.find((booking) => booking.id === bookingA).status, 'CANCELLED');
  assert.equal(repository.payments.some((attempt) => attempt.status === 'SUCCEEDED'), false);
});

test('provider failure marks the attempt FAILED', async () => {
  const paymentProvider = { charge: async () => { throw new Error('Provider declined'); } };
  const { app, repository } = fixture({ paymentProvider });
  const response = await postPayment(app, bookingA, 'failed-payment-key');
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'FAILED');
  assert.equal(response.body.data.provider_transaction_id, null);
  assert.equal(response.body.data.failure_reason, 'Provider declined');
  assert.equal(repository.payments.some((payment) => payment.status === 'SUCCEEDED'), false);
});

test('a failed payment can be retried with a new Idempotency-Key', async () => {
  const paymentProvider = {
    calls: 0,
    async charge() {
      this.calls += 1;
      return this.calls === 1
        ? { success: false, failureReason: 'Declined once' }
        : { success: true, transactionId: `MOCK-${randomUUID()}` };
    }
  };
  const { app, repository } = fixture({ paymentProvider });
  const failed = await postPayment(app, bookingA, 'retry-payment-key-1');
  const retried = await postPayment(app, bookingA, 'retry-payment-key-2');
  assert.equal(failed.body.data.status, 'FAILED');
  assert.equal(retried.status, 201);
  assert.equal(retried.body.data.status, 'SUCCEEDED');
  assert.equal(repository.payments.length, 2);
});

test('customer cannot cancel a paid booking', async () => {
  const { app } = fixture();
  await postPayment(app, bookingA, 'paid-customer-cancel-key');
  const response = await request(app).post(`/api/v1/bookings/${bookingA}/cancel`)
    .set('Authorization', `Bearer ${token(userA)}`).send({ reason: 'Changed plans' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'PAID_BOOKING_CANNOT_CANCEL');
  assert.equal(response.body.error.message, 'Đặt phòng đã thanh toán, cần hoàn tiền trước khi hủy');
});

test('admin cannot cancel a paid booking', async () => {
  const { app } = fixture();
  await postPayment(app, bookingA, 'paid-admin-cancel-key');
  const response = await request(app).post(`/api/v1/admin/bookings/${bookingA}/cancel`)
    .set('Authorization', `Bearer ${token(userB, 'ADMIN')}`).send({ reason: 'Operational issue' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'PAID_BOOKING_CANNOT_CANCEL');
});
