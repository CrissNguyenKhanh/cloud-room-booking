import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const room2Id = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const futureDate = (days = 2) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
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
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, { subject: userId,
    issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
}

class FakeRepository {
  constructor() {
    this.pool = this;
    this.rooms = [{ id: roomId, name: 'Room A', capacity: 8, equipment: [], active: true },
      { id: room2Id, name: 'Room B', capacity: 8, equipment: [], active: true }];
    this.slots = [{ id: slotId, code: 'SLOT-1', start_time: '08:00', end_time: '10:00', active: true }];
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
  async findActiveSlot(_db, id) { return this.slots.find((s) => s.id === id && s.active) || null; }
  async insertBooking(_db, data) {
    if (this.bookings.some((b) => b.room_id === data.roomId && b.booking_date === data.bookingDate && b.slot_id === data.slotId && b.status === 'CONFIRMED')) {
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }
    const booking = { id: randomUUID(), room_id: data.roomId, slot_id: data.slotId, booking_date: data.bookingDate,
      user_id: data.userId, idempotency_key: data.idempotencyKey, request_hash: data.requestHash, status: 'CONFIRMED' };
    this.bookings.push(booking); return booking;
  }
  async insertOutbox(_db, event) {
    const value = { event_id: randomUUID(), event_type: event.eventType, aggregate_id: event.aggregateId,
      user_id: event.userId, payload: event.payload, status: 'PENDING', attempts: 0 };
    this.outbox.push(value); return value;
  }
  async listRooms() { return this.rooms.filter((r) => r.active); }
  async getRoom(id) { return this.rooms.find((r) => r.id === id && r.active) || null; }
  async availability(id, date) { return this.slots.map((s) => ({ ...s, available: !this.bookings.some((b) => b.room_id === id && b.booking_date === date && b.slot_id === s.id && b.status === 'CONFIRMED') })); }
  async listMine(userId) { return this.bookings.filter((b) => b.user_id === userId); }
  async findBooking(_db, id) { return this.bookings.find((b) => b.id === id) || null; }
  async markCancelled(_db, id, reason) { const booking = this.bookings.find((b) => b.id === id); booking.status = 'CANCELLED'; booking.cancel_reason = reason; return booking; }
  async getOutbox(id) { return this.outbox.find((event) => event.event_id === id) || null; }
  async listDueOutbox() { return this.outbox.filter((event) => event.status === 'PENDING'); }
  async markOutboxSent(id) { this.outbox.find((event) => event.event_id === id).status = 'SENT'; }
  async markOutboxFailure() {}
  async listOutbox() { return this.outbox; }
  async listBookings() { return this.bookings; }
}

function fixture(repository = new FakeRepository(), customDispatcher = dispatcher) {
  return { repository, app: createApp({ pool, config, repository, identityClient, dispatcher: customDispatcher }) };
}
function postBooking(app, user, key, payload = { room_id: roomId, slot_id: slotId, booking_date: futureDate() }) {
  return request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${token(user)}`).set('Idempotency-Key', key).send(payload);
}

test('creates a valid booking and its outbox event', async () => {
  const { app, repository } = fixture();
  const response = await postBooking(app, userA, 'booking-key-0001');
  assert.equal(response.status, 201); assert.equal(response.body.data.status, 'CONFIRMED');
  assert.equal(repository.bookings.length, 1); assert.equal(repository.outbox[0].event_type, 'BOOKING_CREATED');
});

test('rejects an invalid slot and a past date', async () => {
  const { app } = fixture();
  const invalidSlot = await postBooking(app, userA, 'booking-key-0002', { room_id: roomId, slot_id: randomUUID(), booking_date: futureDate() });
  assert.equal(invalidSlot.status, 404); assert.equal(invalidSlot.body.error.code, 'SLOT_NOT_FOUND');
  const past = await postBooking(app, userA, 'booking-key-0003', { room_id: roomId, slot_id: slotId, booking_date: '2020-01-01' });
  assert.equal(past.status, 400); assert.equal(past.body.error.code, 'VALIDATION_ERROR');
});

test('a user only lists and cancels their own bookings', async () => {
  const { app } = fixture();
  const created = await postBooking(app, userA, 'booking-key-0004');
  const mine = await request(app).get('/api/v1/bookings/me').set('Authorization', `Bearer ${token(userB)}`);
  assert.equal(mine.status, 200); assert.equal(mine.body.data.length, 0);
  const cancel = await request(app).post(`/api/v1/bookings/${created.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userB)}`).send({ reason: 'Not mine' });
  assert.equal(cancel.status, 404); assert.equal(cancel.body.error.code, 'BOOKING_NOT_FOUND');
});

test('two concurrent requests create one confirmed booking and one conflict', async () => {
  const { app, repository } = fixture();
  const results = await Promise.all([postBooking(app, userA, 'concurrent-key-a'), postBooking(app, userB, 'concurrent-key-b')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(repository.bookings.filter((b) => b.status === 'CONFIRMED').length, 1);
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
  const response = await postBooking(app, userA, 'different-payload-key', { room_id: room2Id, slot_id: slotId, booking_date: futureDate() });
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('notification failure does not roll back a committed booking', async () => {
  const failingDispatcher = { dispatchById: async () => { throw new Error('notification unavailable'); }, retryBatch: async () => [] };
  const { app, repository } = fixture(new FakeRepository(), failingDispatcher);
  const response = await postBooking(app, userA, 'notification-down-key');
  assert.equal(response.status, 201); assert.equal(repository.bookings.length, 1);
  assert.equal(repository.outbox[0].status, 'PENDING');
});

test('cancelling a booking releases the room slot', async () => {
  const { app, repository } = fixture();
  const first = await postBooking(app, userA, 'cancel-release-key-a');
  const cancelled = await request(app).post(`/api/v1/bookings/${first.body.data.id}/cancel`)
    .set('Authorization', `Bearer ${token(userA)}`).send({ reason: 'Plans changed' });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.status, 'CANCELLED');
  const second = await postBooking(app, userB, 'cancel-release-key-b');
  assert.equal(second.status, 201);
  assert.equal(repository.bookings.filter((b) => b.status === 'CONFIRMED').length, 1);
});

test('admin endpoints reject a regular user', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/v1/admin/bookings').set('Authorization', `Bearer ${token(userA)}`);
  assert.equal(response.status, 403); assert.equal(response.body.error.code, 'FORBIDDEN');
});
