import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { BookingService } from '../src/services/booking-service.js';
import { cancellationDeadline, canCancel } from '../src/utils/stay.js';
import '../src/config/database.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const room2Id = '22222222-2222-4222-8222-222222222222';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const futureDate = (days = 3) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const config = {
  nodeEnv: 'test', frontendOrigin: 'http://localhost:5173', serviceName: 'booking-service',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters', jwtIssuer: 'test-issuer', jwtAudience: 'test-audience',
  identityServiceUrl: 'http://identity', notificationServiceUrl: 'http://notification', internalServiceKey: 'test-service-key-long-enough',
  identityTimeoutMs: 100, notificationTimeoutMs: 100, outboxMaxAttempts: 3, outboxBatchSize: 10
};
const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
const identityClient = { assertActive: async () => ({ status: 'ACTIVE' }) };
const dispatcher = { dispatchById: async () => {}, retryBatch: async () => [] };
const validEnvironment = {
  FRONTEND_ORIGIN: 'http://localhost:5173',
  BOOKING_DATABASE_URL: 'postgresql://booking:test@localhost/cloud_room',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
  JWT_ISSUER: 'test-issuer',
  JWT_AUDIENCE: 'test-audience',
  INTERNAL_SERVICE_KEY: 'test-service-key-long-enough',
  IDENTITY_SERVICE_URL: 'http://localhost:3001',
  NOTIFICATION_SERVICE_URL: 'http://localhost:3003'
};

function token(userId, role = 'USER') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, { subject: userId,
    issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
}

class FakeRepository {
  constructor() {
    this.pool = this;
    this.rooms = [
      { id: roomId, room_number: '101', name: 'Room A', room_type: 'deluxe', capacity: 4, price_per_night: 1000000, equipment: [], active: true },
      { id: room2Id, room_number: '102', name: 'Room B', room_type: 'suite', capacity: 4, price_per_night: 1500000, equipment: [], active: true }
    ];
    this.bookings = [];
    this.outbox = [];
    this.queue = Promise.resolve();
  }
  async transaction(work) {
    let unlock;
    const previous = this.queue;
    this.queue = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try { return await work(this); } finally { unlock(); }
  }
  async findIdempotent(_db, userId, key) { return this.bookings.find((b) => b.user_id === userId && b.idempotency_key === key) || null; }
  async findActiveRoom(_db, id) { return this.rooms.find((r) => r.id === id && r.active) || null; }
  async insertBooking(_db, data) {
    if (this.bookings.some((b) => b.room_id === data.roomId && b.status === 'CONFIRMED'
      && b.check_in_date < data.checkOutDate && data.checkInDate < b.check_out_date)) {
      throw Object.assign(new Error('exclusion violation'), { code: '23P01' });
    }
    const room = this.rooms.find((candidate) => candidate.id === data.roomId);
    const booking = { id: randomUUID(), booking_code: data.bookingCode, room_id: data.roomId,
      room_number: room.room_number, room_name: room.name, room_type: room.room_type,
      user_id: data.userId, idempotency_key: data.idempotencyKey, request_hash: data.requestHash,
      status: 'CONFIRMED', check_in_date: data.checkInDate, check_out_date: data.checkOutDate,
      guests: data.guests, nights: data.nights, price_per_night: data.pricePerNight,
      total_price: data.totalPrice, cancel_reason: null };
    this.bookings.push(booking); return booking;
  }
  async insertOutbox(_db, event) {
    const value = { event_id: randomUUID(), event_type: event.eventType, aggregate_id: event.aggregateId,
      user_id: event.userId, payload: event.payload, status: 'PENDING', attempts: 0 };
    this.outbox.push(value); return value;
  }
  async listRooms({ includeInactive = false } = {}) { return this.rooms.filter((r) => includeInactive || r.active); }
  async getRoom(id, includeInactive = false) { return this.rooms.find((r) => r.id === id && (includeInactive || r.active)) || null; }
  async getBookingView(_db, id) { return this.bookings.find((b) => b.id === id) || null; }
  async listMine(userId) {
    const bookings = this.bookings.filter((b) => b.user_id === userId);
    return { bookings, total: bookings.length };
  }
  async findBooking(_db, id) { return this.bookings.find((b) => b.id === id) || null; }
  async markCancelled(_db, id, reason) { const booking = this.bookings.find((b) => b.id === id); booking.status = 'CANCELLED'; booking.cancel_reason = reason; return booking; }
  async getOutbox(id) { return this.outbox.find((event) => event.event_id === id) || null; }
  async listDueOutbox() { return this.outbox.filter((event) => event.status === 'PENDING'); }
  async markOutboxSent(id) { this.outbox.find((event) => event.event_id === id).status = 'SENT'; }
  async markOutboxFailure() {}
  async listOutbox() { return this.outbox; }
  async listBookings({ status, roomId: requestedRoomId, userId } = {}) {
    const bookings = this.bookings.filter((booking) => (!status || booking.status === status)
      && (!requestedRoomId || booking.room_id === requestedRoomId)
      && (!userId || booking.user_id === userId));
    return { bookings, total: bookings.length };
  }
}

function fixture(repository = new FakeRepository(), customDispatcher = dispatcher) {
  return { repository, app: createApp({ pool, config, repository, identityClient, dispatcher: customDispatcher }) };
}
function stay(offset = 3) {
  return { check_in_date: futureDate(offset), check_out_date: futureDate(offset + 2) };
}
function postBooking(app, user, key, payload = { room_id: roomId, ...stay(), guests: 2 }) {
  return request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${token(user)}`).set('Idempotency-Key', key).send(payload);
}

test('environment defaults the database connection timeout to 10000 ms', () => {
  assert.equal(loadConfig(validEnvironment).databaseConnectionTimeoutMs, 10000);
});

test('environment accepts a database connection timeout override', () => {
  assert.equal(loadConfig({
    ...validEnvironment,
    DATABASE_CONNECTION_TIMEOUT_MS: '15000'
  }).databaseConnectionTimeoutMs, 15000);
});

test('readiness relies on the pool query without a separate 2000 ms timer', async () => {
  let readinessTimerScheduled = false;
  let query;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 2000) {
      readinessTimerScheduled = true;
      return { ref() { return this; }, unref() { return this; } };
    }
    return originalSetTimeout(callback, delay, ...args);
  };

  try {
    const readyPool = { query: async (sql) => { query = sql; return { rows: [{ ready: true }] }; } };
    const app = createApp({
      pool: readyPool,
      config,
      repository: new FakeRepository(),
      identityClient,
      dispatcher
    });
    const response = await request(app).get('/ready');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ready');
    assert.equal(query, 'SELECT 1');
    assert.equal(readinessTimerScheduled, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('creates a valid hotel booking and its outbox event', async () => {
  const dates = stay();
  const { app, repository } = fixture();
  const response = await postBooking(app, userA, 'booking-key-0001', {
    room_id: roomId, ...dates, guests: 2
  });
  assert.equal(response.status, 201); assert.equal(response.body.data.status, 'CONFIRMED');
  assert.equal(response.body.data.check_in_date, dates.check_in_date);
  assert.equal(response.body.data.total_price, 2000000);
  assert.equal(repository.bookings.length, 1); assert.equal(repository.outbox[0].event_type, 'BOOKING_CREATED');
  assert.equal(repository.outbox[0].payload.check_in_date, dates.check_in_date);
});

test('preserves PostgreSQL DATE strings in booking and BOOKING_CREATED payloads', async () => {
  const checkIn = pg.types.getTypeParser(1082, 'text')(futureDate(5));
  const checkOut = pg.types.getTypeParser(1082, 'text')(futureDate(7));
  const repository = new FakeRepository();
  const service = new BookingService(repository, identityClient);
  const result = await service.create(userA, {
    room_id: roomId, check_in_date: checkIn, check_out_date: checkOut, guests: 2
  }, 'date-serialization-key', 'date-serialization-request');
  const serializedBooking = JSON.parse(JSON.stringify(result.booking));

  assert.equal(serializedBooking.check_in_date, checkIn);
  assert.equal(serializedBooking.check_out_date, checkOut);
  assert.equal(repository.outbox[0].event_type, 'BOOKING_CREATED');
  assert.equal(repository.outbox[0].payload.check_in_date, checkIn);
  assert.equal(repository.outbox[0].payload.check_out_date, checkOut);
});

test('rejects an unknown room, a past date, and guests over capacity', async () => {
  const { app } = fixture();
  const unknownRoom = await postBooking(app, userA, 'booking-key-0002', { room_id: randomUUID(), ...stay(), guests: 2 });
  assert.equal(unknownRoom.status, 404); assert.equal(unknownRoom.body.error.code, 'ROOM_NOT_FOUND');
  const past = await postBooking(app, userA, 'booking-key-0003', {
    room_id: roomId, check_in_date: '2020-01-01', check_out_date: '2020-01-03', guests: 2
  });
  assert.equal(past.status, 400); assert.equal(past.body.error.code, 'VALIDATION_ERROR');
  const capacity = await postBooking(app, userA, 'booking-key-0004', { room_id: roomId, ...stay(), guests: 5 });
  assert.equal(capacity.status, 400); assert.equal(capacity.body.error.code, 'GUESTS_EXCEED_CAPACITY');
});

test('a user only lists, reads, and cancels their own bookings', async () => {
  const { app } = fixture();
  const created = await postBooking(app, userA, 'booking-key-0005');
  const mine = await request(app).get('/api/v1/bookings/me').set('Authorization', `Bearer ${token(userB)}`);
  assert.equal(mine.status, 200); assert.equal(mine.body.data.length, 0);
  const detail = await request(app).get(`/api/v1/bookings/${created.body.data.id}`)
    .set('Authorization', `Bearer ${token(userB)}`);
  assert.equal(detail.status, 404); assert.equal(detail.body.error.code, 'BOOKING_NOT_FOUND');
  const cancel = await request(app).post(`/api/v1/bookings/${created.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userB)}`).send({ reason: 'Not mine' });
  assert.equal(cancel.status, 404); assert.equal(cancel.body.error.code, 'BOOKING_NOT_FOUND');
});

test('two concurrent overlapping requests create one confirmed booking and one conflict', async () => {
  const { app, repository } = fixture();
  const results = await Promise.all([postBooking(app, userA, 'concurrent-key-a'), postBooking(app, userB, 'concurrent-key-b')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((response) => response.status === 409).body.error.code, 'ROOM_UNAVAILABLE');
  assert.equal(repository.bookings.filter((b) => b.status === 'CONFIRMED').length, 1);
});

test('adjacent stays do not overlap under the half-open range contract', async () => {
  const { app } = fixture();
  const first = await postBooking(app, userA, 'adjacent-key-a');
  const response = await postBooking(app, userB, 'adjacent-key-b', {
    room_id: roomId,
    check_in_date: first.body.data.check_out_date,
    check_out_date: futureDate(7),
    guests: 2
  });
  assert.equal(response.status, 201);
});

test('same Idempotency-Key and payload replays the existing booking', async () => {
  const { app, repository } = fixture();
  const first = await postBooking(app, userA, 'same-request-key');
  const replay = await postBooking(app, userA, 'same-request-key');
  assert.equal(first.status, 201); assert.equal(replay.status, 200);
  assert.equal(replay.headers['idempotency-replayed'], 'true'); assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(repository.bookings.length, 1);
});

test('same Idempotency-Key with different payload returns 409', async () => {
  const { app } = fixture();
  await postBooking(app, userA, 'different-payload-key');
  const response = await postBooking(app, userA, 'different-payload-key', { room_id: room2Id, ...stay(), guests: 2 });
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('notification failure does not roll back a committed booking', async () => {
  const failingDispatcher = { dispatchById: async () => { throw new Error('notification unavailable'); }, retryBatch: async () => [] };
  const { app, repository } = fixture(new FakeRepository(), failingDispatcher);
  const response = await postBooking(app, userA, 'notification-down-key');
  assert.equal(response.status, 201); assert.equal(repository.bookings.length, 1);
  assert.equal(repository.outbox[0].status, 'PENDING');
});

test('cancelling a booking releases its date range and stores the reason', async () => {
  const { app, repository } = fixture();
  const first = await postBooking(app, userA, 'cancel-release-key-a');
  const cancelled = await request(app).post(`/api/v1/bookings/${first.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userA)}`).send({ reason: 'Plans changed' });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.status, 'CANCELLED');
  assert.equal(cancelled.body.data.cancel_reason, 'Plans changed');
  const second = await postBooking(app, userB, 'cancel-release-key-b');
  assert.equal(second.status, 201);
  assert.equal(repository.bookings.filter((b) => b.status === 'CONFIRMED').length, 1);
});

test('customer cancellation cutoff is before, at, and after 14:00 Vietnam time on the previous day', () => {
  assert.equal(cancellationDeadline('2028-06-10').toISOString(), '2028-06-09T07:00:00.000Z');
  assert.equal(canCancel('2028-06-10', new Date('2028-06-09T06:59:59.999Z')), true);
  assert.equal(canCancel('2028-06-10', new Date('2028-06-09T07:00:00.000Z')), true);
  assert.equal(canCancel('2028-06-10', new Date('2028-06-09T07:00:00.001Z')), false);
});

test('admin cancellation requires a reason', async () => {
  const { app } = fixture();
  const created = await postBooking(app, userA, 'admin-cancel-key');
  const missingReason = await request(app).post(`/api/v1/admin/bookings/${created.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userB, 'ADMIN')}`).send({});
  assert.equal(missingReason.status, 400);
  const cancelled = await request(app).post(`/api/v1/admin/bookings/${created.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userB, 'ADMIN')}`).send({ reason: 'Operational issue' });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.status, 'CANCELLED');
});

test('admin endpoints reject a regular user', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/v1/admin/bookings').set('Authorization', `Bearer ${token(userA)}`);
  assert.equal(response.status, 403); assert.equal(response.body.error.code, 'FORBIDDEN');
});
