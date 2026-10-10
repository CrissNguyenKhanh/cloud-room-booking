import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { BookingRepository } from '../src/repositories/booking-repository.js';

const config = {
  nodeEnv: 'test',
  frontendOrigin: 'http://localhost:5173',
  serviceName: 'booking-service',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters',
  jwtIssuer: 'test-issuer',
  jwtAudience: 'test-audience',
  identityServiceUrl: 'http://identity',
  notificationServiceUrl: 'http://notification',
  internalServiceKey: 'test-service-key-long-enough',
  identityTimeoutMs: 100,
  notificationTimeoutMs: 100,
  outboxMaxAttempts: 3,
  outboxBatchSize: 10,
};

function token(role = 'ADMIN') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, {
    subject: randomUUID(),
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: '1h',
  });
}

function fixture() {
  const calls = { listRooms: [], listBookings: [] };
  const repository = {
    listRooms: async (options) => {
      calls.listRooms.push(options);
      return [
        { id: randomUUID(), room_number: '101', active: true },
        { id: randomUUID(), room_number: '102', active: false },
      ];
    },
    listBookings: async (filters) => {
      calls.listBookings.push(filters);
      return { bookings: [], total: 0 };
    },
  };
  const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
  const identityClient = { assertActive: async () => ({ status: 'ACTIVE' }) };
  const dispatcher = { dispatchById: async () => {}, retryBatch: async () => [] };
  return {
    calls,
    app: createApp({ pool, config, repository, identityClient, dispatcher }),
  };
}

test('GET /api/v1/admin/rooms returns active and inactive rooms to admins', async () => {
  const { app, calls } = fixture();
  const response = await request(app)
    .get('/api/v1/admin/rooms')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((room) => room.active), [true, false]);
  assert.deepEqual(calls.listRooms, [{ includeInactive: true }]);
});

test('GET /api/v1/admin/rooms rejects a customer token', async () => {
  const { app, calls } = fixture();
  const response = await request(app)
    .get('/api/v1/admin/rooms')
    .set('Authorization', `Bearer ${token('USER')}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(calls.listRooms.length, 0);
});

test('admin booking query maps room_id and user_id into repository filters', async () => {
  const { app, calls } = fixture();
  const roomId = randomUUID();
  const userId = randomUUID();
  const response = await request(app)
    .get('/api/v1/admin/bookings')
    .query({ status: 'confirmed', room_id: roomId, user_id: userId, page: 2, limit: 25 })
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.listBookings, [{
    status: 'CONFIRMED',
    roomId,
    userId,
    page: 2,
    limit: 25,
  }]);
  assert.deepEqual(response.body.meta, { page: 2, limit: 25, total: 0 });
});

test('room repository uses includeInactive only for the admin inventory call', async () => {
  const calls = [];
  const repository = new BookingRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });

  await repository.listRooms();
  await repository.listRooms({ includeInactive: true });

  assert.deepEqual(calls.map((call) => call.params), [[false], [true]]);
  assert.match(calls[0].sql, /\$1::boolean OR r\.active = true/);
});
