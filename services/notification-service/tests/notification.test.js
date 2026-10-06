import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const aggregateId = '33333333-3333-4333-8333-333333333333';
const createdEventId = '11111111-1111-4111-8111-111111111111';
const cancelledEventId = '22222222-2222-4222-8222-222222222222';
const notificationId = '44444444-4444-4444-8444-444444444444';
const otherNotificationId = '55555555-5555-4555-8555-555555555555';
const readAt = '2026-10-05T00:00:00.000Z';

const config = {
  serviceName: 'notification-service',
  frontendOrigin: 'http://localhost:5173',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters',
  jwtIssuer: 'issuer',
  jwtAudience: 'audience',
  internalServiceKey: 'test-service-key-long-enough'
};

const readyPool = { query: async () => ({ rows: [{ ready: true }] }) };
const validEnvironment = {
  FRONTEND_ORIGIN: 'http://localhost:5173',
  NOTIFICATION_DATABASE_URL: 'postgresql://notification:test@localhost/cloud_room',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
  JWT_ISSUER: 'issuer',
  JWT_AUDIENCE: 'audience',
  INTERNAL_SERVICE_KEY: 'test-service-key-long-enough'
};

class FakeNotificationRepository {
  constructor(notifications = []) {
    this.notifications = notifications.map((notification) => ({
      ...notification,
      payload: { ...notification.payload }
    }));
    this.sequence = this.notifications.length;
  }

  async create(event) {
    const existing = this.notifications.find((notification) => notification.event_id === event.event_id);
    if (existing) return { notification: existing, created: false };

    this.sequence += 1;
    const notification = {
      id: `90000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
      event_id: event.event_id,
      user_id: event.user_id,
      type: event.event_type,
      payload: event.payload,
      read_at: null,
      created_at: '2026-10-05T00:00:00.000Z'
    };
    this.notifications.push(notification);
    return { notification, created: true };
  }

  async listByUser(userId) {
    return this.notifications.filter((notification) => notification.user_id === userId);
  }

  async markRead(id, userId) {
    const notification = this.notifications.find((item) => item.id === id && item.user_id === userId);
    if (!notification) return null;
    notification.read_at ??= readAt;
    return notification;
  }
}

function notification(overrides = {}) {
  return {
    id: notificationId,
    event_id: createdEventId,
    user_id: userA,
    type: 'BOOKING_CREATED',
    payload: { booking_id: aggregateId },
    read_at: null,
    created_at: '2026-10-05T00:00:00.000Z',
    ...overrides
  };
}

function fixture({ notifications = [], pool = readyPool } = {}) {
  const repository = new FakeNotificationRepository(notifications);
  return { repository, app: createApp({ pool, config, repository }) };
}

function token(userId, overrides = {}) {
  const { issuer = config.jwtIssuer, audience = config.jwtAudience } = overrides;
  return jwt.sign({ role: 'USER', status: 'ACTIVE' }, config.jwtSecret, {
    subject: userId,
    issuer,
    audience,
    expiresIn: '1h'
  });
}

function validEvent(overrides = {}) {
  return {
    event_id: createdEventId,
    event_type: 'BOOKING_CREATED',
    aggregate_id: aggregateId,
    user_id: userA,
    payload: { booking_id: aggregateId },
    occurred_at: '2026-10-05T00:00:00.000Z',
    ...overrides
  };
}

function postEvent(app, body, serviceKey = config.internalServiceKey) {
  const operation = request(app).post('/internal/v1/events');
  if (serviceKey !== null) operation.set('X-Service-Key', serviceKey);
  return operation.send(body);
}

function bearer(userId, overrides) {
  return `Bearer ${token(userId, overrides)}`;
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

test('health endpoint exposes process health', async () => {
  const { app } = fixture();
  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'notification-service');
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('POST /internal/v1/events rejects a missing service key', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent(), null);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_SERVICE_KEY');
});

test('POST /internal/v1/events rejects an incorrect service key', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent(), 'fake-service-key-long-enough');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_SERVICE_KEY');
});

test('POST /internal/v1/events accepts a valid BOOKING_CREATED event', async () => {
  const { app, repository } = fixture();
  const response = await postEvent(app, validEvent());

  assert.equal(response.status, 201);
  assert.equal(response.body.data.event_id, createdEventId);
  assert.equal(response.body.data.user_id, userA);
  assert.equal(response.body.data.type, 'BOOKING_CREATED');
  assert.deepEqual(response.body.data.payload, { booking_id: aggregateId });
  assert.equal(repository.notifications.length, 1);
});

test('POST /internal/v1/events returns the existing notification for a duplicate event_id', async () => {
  const { app, repository } = fixture();
  const first = await postEvent(app, validEvent());
  const duplicate = await postEvent(app, validEvent());

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.id, first.body.data.id);
  assert.equal(repository.notifications.length, 1);
});

test('POST /internal/v1/events rejects a missing event_id', async () => {
  const { app } = fixture();
  const body = validEvent();
  delete body.event_id;
  const response = await postEvent(app, body);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events rejects a missing user_id', async () => {
  const { app } = fixture();
  const body = validEvent();
  delete body.user_id;
  const response = await postEvent(app, body);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events rejects a non-UUID event_id', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent({ event_id: 'not-a-uuid' }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events rejects a non-UUID user_id', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent({ user_id: 'not-a-uuid' }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events rejects a non-UUID aggregate_id', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent({ aggregate_id: 'not-a-uuid' }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events rejects an unsupported event_type', async () => {
  const { app } = fixture();
  const response = await postEvent(app, validEvent({ event_type: 'BOOKING_UPDATED' }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /internal/v1/events accepts a valid BOOKING_CANCELLED event', async () => {
  const { app, repository } = fixture();
  const response = await postEvent(app, validEvent({
    event_id: cancelledEventId,
    event_type: 'BOOKING_CANCELLED',
    payload: { booking_id: aggregateId, reason: 'Plans changed' }
  }));

  assert.equal(response.status, 201);
  assert.equal(response.body.data.type, 'BOOKING_CANCELLED');
  assert.equal(repository.notifications.length, 1);
});

test('GET /api/v1/notifications rejects a missing bearer token with the error envelope', async () => {
  const requestId = 'notification-test-request';
  const { app } = fixture();
  const response = await request(app).get('/api/v1/notifications').set('X-Request-Id', requestId);

  assert.equal(response.status, 401);
  assert.equal(response.headers['x-request-id'], requestId);
  assert.deepEqual(response.body, {
    error: { code: 'AUTH_REQUIRED', message: 'Yêu cầu JWT hợp lệ' },
    request_id: requestId
  });
});

test('GET /api/v1/notifications rejects an invalid bearer token', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/v1/notifications').set('Authorization', 'Bearer not-a-token');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_TOKEN');
});

test('GET /api/v1/notifications returns only notifications owned by the JWT subject', async () => {
  const own = notification();
  const other = notification({
    id: otherNotificationId,
    event_id: cancelledEventId,
    user_id: userB,
    type: 'BOOKING_CANCELLED'
  });
  const { app } = fixture({ notifications: [own, other] });
  const response = await request(app).get('/api/v1/notifications').set('Authorization', bearer(userA));

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].id, notificationId);
  assert.ok(response.body.data.every((item) => item.user_id === userA));
});

test('GET /api/v1/notifications rejects JWTs with the wrong issuer or audience', async () => {
  const { app } = fixture();
  const wrongIssuer = await request(app).get('/api/v1/notifications')
    .set('Authorization', bearer(userA, { issuer: 'wrong-issuer' }));
  const wrongAudience = await request(app).get('/api/v1/notifications')
    .set('Authorization', bearer(userA, { audience: 'wrong-audience' }));

  assert.equal(wrongIssuer.status, 401);
  assert.equal(wrongIssuer.body.error.code, 'INVALID_TOKEN');
  assert.equal(wrongAudience.status, 401);
  assert.equal(wrongAudience.body.error.code, 'INVALID_TOKEN');
});

test('GET /api/v1/notifications rejects a JWT without a subject', async () => {
  const missingSubject = jwt.sign({ role: 'USER', status: 'ACTIVE' }, config.jwtSecret, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: '1h'
  });
  const { app } = fixture();
  const response = await request(app).get('/api/v1/notifications')
    .set('Authorization', `Bearer ${missingSubject}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_TOKEN');
});

test('PATCH /api/v1/notifications/:id/read rejects a missing bearer token', async () => {
  const { app } = fixture({ notifications: [notification()] });
  const response = await request(app).patch(`/api/v1/notifications/${notificationId}/read`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

test('PATCH /api/v1/notifications/:id/read rejects a non-UUID notification id', async () => {
  const { app } = fixture();
  const response = await request(app).patch('/api/v1/notifications/not-a-uuid/read')
    .set('Authorization', bearer(userA));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/notifications/:id/read sets read_at once for an owned notification', async () => {
  const { app } = fixture({ notifications: [notification()] });
  const first = await request(app).patch(`/api/v1/notifications/${notificationId}/read`)
    .set('Authorization', bearer(userA));
  const second = await request(app).patch(`/api/v1/notifications/${notificationId}/read`)
    .set('Authorization', bearer(userA));

  assert.equal(first.status, 200);
  assert.equal(first.body.data.read_at, readAt);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.read_at, first.body.data.read_at);
});

test('PATCH /api/v1/notifications/:id/read returns 404 for a missing notification', async () => {
  const { app } = fixture();
  const response = await request(app).patch(`/api/v1/notifications/${notificationId}/read`)
    .set('Authorization', bearer(userA));

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOTIFICATION_NOT_FOUND');
});

test('PATCH /api/v1/notifications/:id/read hides a notification owned by another user', async () => {
  const { app } = fixture({ notifications: [notification({ user_id: userB })] });
  const response = await request(app).patch(`/api/v1/notifications/${notificationId}/read`)
    .set('Authorization', bearer(userA));

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOTIFICATION_NOT_FOUND');
});

test('GET /ready succeeds when the database pool is ready', async () => {
  const { app } = fixture();
  const response = await request(app).get('/ready');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ready', service: 'notification-service' });
});

test('GET /ready currently returns 500 with the shared error envelope when the pool fails', async () => {
  const pool = { query: async () => { throw new Error('database unavailable'); } };
  const { app } = fixture({ pool });
  const response = await request(app).get('/ready').set('X-Request-Id', 'ready-failure-request');

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ nội bộ' },
    request_id: 'ready-failure-request'
  });
});
