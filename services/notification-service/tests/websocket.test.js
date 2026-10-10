import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { createNotificationWebSocket } from '../src/realtime/notification-websocket.js';

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const adminA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const aggregateId = '33333333-3333-4333-8333-333333333333';
const createdEventId = '11111111-1111-4111-8111-111111111111';
const cancelledEventId = '22222222-2222-4222-8222-222222222222';

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

class FakeNotificationRepository {
  constructor() {
    this.notifications = [];
    this.sequence = 0;
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
      created_at: '2026-10-10T00:00:00.000Z',
      admin_visible: event.adminVisible
    };
    this.notifications.push(notification);
    return { notification, created: true };
  }
}

function token(userId, role = 'USER') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, {
    subject: userId,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: '1h'
  });
}

function event(overrides = {}) {
  return {
    event_id: createdEventId,
    event_type: 'BOOKING_CREATED',
    aggregate_id: aggregateId,
    user_id: userA,
    payload: { booking_id: aggregateId },
    occurred_at: '2026-10-10T00:00:00.000Z',
    ...overrides
  };
}

function postEvent(target, body) {
  return request(target)
    .post('/internal/v1/events')
    .set('X-Service-Key', config.internalServiceKey)
    .send(body);
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function fixture(t, { authTimeoutMs = 5000 } = {}) {
  const repository = new FakeNotificationRepository();
  const server = createServer();
  const realtime = createNotificationWebSocket({ server, config, authTimeoutMs });
  const app = createApp({ pool: readyPool, config, repository, realtime });
  server.on('request', app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  t.after(async () => {
    await realtime.close();
    await closeHttpServer(server);
  });
  return { repository, server, realtime, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

function connect(wsUrl, origin = config.frontendOrigin) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { origin });
    const onError = (error) => reject(error);
    socket.once('error', onError);
    socket.once('open', () => {
      socket.off('error', onError);
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

function nextJson(socket, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, new Error('Timed out waiting for WebSocket message')), timeoutMs);
    const onMessage = (data) => {
      try {
        finish(resolve, JSON.parse(data.toString()));
      } catch (error) {
        finish(reject, error);
      }
    };
    const onClose = () => finish(reject, new Error('WebSocket closed before a message arrived'));
    const finish = (callback, value) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      callback(value);
    };
    socket.once('message', onMessage);
    socket.once('close', onClose);
  });
}

function expectNoMessage(socket, timeoutMs = 80) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected WebSocket message: ${data.toString()}`));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, timeoutMs);
    socket.once('message', onMessage);
  });
}

function waitForClose(socket, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket close')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function authenticate(socket, userId, role = 'USER') {
  const response = nextJson(socket);
  socket.send(JSON.stringify({ type: 'AUTH', token: token(userId, role) }));
  assert.deepEqual(await response, { type: 'AUTH_OK' });
}

async function waitFor(predicate, timeoutMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('WebSocket endpoint accepts upgrades on /ws using the HTTP server port', async (t) => {
  const { wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test('WebSocket AUTH accepts a valid access token and responds AUTH_OK', async (t) => {
  const { wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, userA);
});

test('WebSocket AUTH closes with 1008 for an invalid access token', async (t) => {
  const { wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  const closed = waitForClose(socket);
  socket.send(JSON.stringify({ type: 'AUTH', token: 'not-a-jwt' }));
  assert.equal(await closed, 1008);
});

test('WebSocket closes with 1008 when AUTH does not arrive before the timeout', async (t) => {
  const { wsUrl } = await fixture(t, { authTimeoutMs: 25 });
  const socket = await connect(wsUrl);
  assert.equal(await waitForClose(socket), 1008);
});

test('BOOKING_CREATED signals the notification owner', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, userA);
  const signal = nextJson(socket);
  const response = await postEvent(server, event());

  assert.equal(response.status, 201);
  assert.deepEqual(await signal, {
    type: 'NOTIFICATION_CREATED',
    notification_id: response.body.data.id,
    event_type: 'BOOKING_CREATED',
    audience: 'USER'
  });
});

test('BOOKING_CREATED does not signal another customer', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, userB);
  const noSignal = expectNoMessage(socket);
  const response = await postEvent(server, event());

  assert.equal(response.status, 201);
  await noSignal;
});

test('BOOKING_CREATED signals every authenticated admin', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, adminA, 'ADMIN');
  const signal = nextJson(socket);
  const response = await postEvent(server, event());

  assert.equal(response.status, 201);
  assert.deepEqual(await signal, {
    type: 'NOTIFICATION_CREATED',
    notification_id: response.body.data.id,
    event_type: 'BOOKING_CREATED',
    audience: 'ADMIN'
  });
});

test('customer BOOKING_CANCELLED signals its owner and admins', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const ownerSocket = await connect(wsUrl);
  const adminSocket = await connect(wsUrl);
  await authenticate(ownerSocket, userA);
  await authenticate(adminSocket, adminA, 'ADMIN');
  const ownerSignal = nextJson(ownerSocket);
  const adminSignal = nextJson(adminSocket);
  const response = await postEvent(server, event({
    event_id: cancelledEventId,
    event_type: 'BOOKING_CANCELLED',
    payload: { booking_id: aggregateId, cancelled_by: 'USER' }
  }));

  assert.equal(response.status, 201);
  assert.equal((await ownerSignal).audience, 'USER');
  assert.equal((await adminSignal).audience, 'ADMIN');
});

test('admin BOOKING_CANCELLED signals its owner but not admins', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const ownerSocket = await connect(wsUrl);
  const adminSocket = await connect(wsUrl);
  await authenticate(ownerSocket, userA);
  await authenticate(adminSocket, adminA, 'ADMIN');
  const ownerSignal = nextJson(ownerSocket);
  const noAdminSignal = expectNoMessage(adminSocket);
  const response = await postEvent(server, event({
    event_id: cancelledEventId,
    event_type: 'BOOKING_CANCELLED',
    payload: { booking_id: aggregateId, cancelled_by: 'ADMIN' }
  }));

  assert.equal(response.status, 201);
  assert.equal((await ownerSignal).audience, 'USER');
  await noAdminSignal;
});

test('duplicate event_id does not emit a second WebSocket signal', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, userA);
  const firstSignal = nextJson(socket);
  const first = await postEvent(server, event());
  await firstSignal;
  const noSecondSignal = expectNoMessage(socket);
  const duplicate = await postEvent(server, event());

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  await noSecondSignal;
});

test('multiple sockets for one user all receive the signal', async (t) => {
  const { server, wsUrl } = await fixture(t);
  const firstSocket = await connect(wsUrl);
  const secondSocket = await connect(wsUrl);
  await authenticate(firstSocket, userA);
  await authenticate(secondSocket, userA);
  const firstSignal = nextJson(firstSocket);
  const secondSignal = nextJson(secondSocket);
  const response = await postEvent(server, event());

  assert.equal(response.status, 201);
  assert.equal((await firstSignal).notification_id, response.body.data.id);
  assert.equal((await secondSignal).notification_id, response.body.data.id);
});

test('disconnect cleans the registry and later publish remains safe', async (t) => {
  const { realtime, wsUrl } = await fixture(t);
  const socket = await connect(wsUrl);
  await authenticate(socket, userA);
  assert.deepEqual(realtime.getConnectionCounts(), { users: 1, userConnections: 1, admins: 0 });
  const closed = waitForClose(socket);
  socket.close();
  await closed;
  await waitFor(() => realtime.getConnectionCounts().userConnections === 0);

  assert.deepEqual(realtime.getConnectionCounts(), { users: 0, userConnections: 0, admins: 0 });
  assert.doesNotThrow(() => realtime.publishNotificationCreated({
    notificationId: '90000000-0000-4000-8000-000000000001',
    eventType: 'BOOKING_CREATED',
    userId: userA,
    adminVisible: true
  }));
});

test('WebSocket upgrade rejects a mismatched Origin', async (t) => {
  const { wsUrl } = await fixture(t);
  const statusCode = await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { origin: 'https://evil.example' });
    const timer = setTimeout(() => reject(new Error('Timed out waiting for rejected upgrade')), 500);
    socket.on('error', () => {});
    socket.once('open', () => reject(new Error('Wrong-origin WebSocket unexpectedly opened')));
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode);
    });
  });

  assert.equal(statusCode, 403);
});

test('realtime publish failure does not break the successful HTTP event write', async () => {
  const repository = new FakeNotificationRepository();
  const realtime = {
    async publishNotificationCreated() {
      throw new Error('simulated publish failure');
    }
  };
  const app = createApp({ pool: readyPool, config, repository, realtime });
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (line) => logs.push(line);
  try {
    const response = await postEvent(app, event());
    assert.equal(response.status, 201);
    assert.equal(repository.notifications.length, 1);
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).event, 'realtime_publish_failed');
    assert.doesNotMatch(logs[0], /test-secret|eyJ/);
  } finally {
    console.error = originalConsoleError;
  }
});
