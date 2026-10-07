import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

const config = {
  nodeEnv: 'test', frontendOrigin: 'http://localhost:5173', serviceName: 'identity-service',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters', jwtIssuer: 'test-issuer',
  jwtAudience: 'test-audience', jwtExpiresIn: '1h', internalServiceKey: 'test-internal-key-long-enough'
};
const pool = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const validEnvironment = {
  FRONTEND_ORIGIN: 'http://localhost:5173',
  IDENTITY_DATABASE_URL: 'postgresql://identity:test@localhost/cloud_room',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
  JWT_ISSUER: 'test-issuer',
  JWT_AUDIENCE: 'test-audience',
  INTERNAL_SERVICE_KEY: 'test-internal-key-long-enough'
};

function repositoryFixture() {
  const users = new Map();
  return {
    users,
    async create(data) {
      if ([...users.values()].some((u) => u.email === data.email)) return null;
      const user = { id: crypto.randomUUID(), email: data.email, password_hash: data.passwordHash,
        full_name: data.fullName, role: 'USER', status: 'ACTIVE', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      users.set(user.id, user); return publicUser(user);
    },
    async findByEmail(email) { return [...users.values()].find((user) => user.email === email) || null; },
    async findPublicById(id) { const user = users.get(id); return user ? publicUser(user) : null; },
    async list() { return [...users.values()].map(publicUser); },
    async updateStatus(id, status) { const user = users.get(id); if (!user) return null; user.status = status; return publicUser(user); }
  };
}
function publicUser({ password_hash: _password, ...user }) { return user; }
function token(id, role = 'USER') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, { subject: id, issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
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
    const app = createApp({ pool: readyPool, config, repository: repositoryFixture() });
    const response = await request(app).get('/ready');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ready');
    assert.equal(query, 'SELECT 1');
    assert.equal(readinessTimerScheduled, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('registers a user, normalizes email, and never returns password data', async () => {
  const app = createApp({ pool, config, repository: repositoryFixture() });
  const response = await request(app).post('/api/v1/auth/register').send({ email: 'USER@Example.COM', password: 'valid-password', full_name: 'Test User' });
  assert.equal(response.status, 201); assert.equal(response.body.data.email, 'user@example.com');
  assert.equal('password' in response.body.data, false); assert.equal('password_hash' in response.body.data, false);
});

test('rejects duplicate email', async () => {
  const app = createApp({ pool, config, repository: repositoryFixture() });
  const payload = { email: 'user@example.com', password: 'valid-password', full_name: 'Test User' };
  await request(app).post('/api/v1/auth/register').send(payload);
  const response = await request(app).post('/api/v1/auth/register').send(payload);
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'EMAIL_ALREADY_EXISTS');
});

test('rejects login with a wrong password', async () => {
  const repository = repositoryFixture();
  const hash = await bcrypt.hash('correct-password', 4);
  repository.users.set('1d20938a-a211-4cb6-ae65-df1084fe10dc', { id: '1d20938a-a211-4cb6-ae65-df1084fe10dc', email: 'user@example.com', password_hash: hash, full_name: 'User', role: 'USER', status: 'ACTIVE' });
  const response = await request(createApp({ pool, config, repository })).post('/api/v1/auth/login').send({ email: 'user@example.com', password: 'wrong-password' });
  assert.equal(response.status, 401); assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
});

test('protected API rejects a missing JWT', async () => {
  const response = await request(createApp({ pool, config, repository: repositoryFixture() })).get('/api/v1/users/me');
  assert.equal(response.status, 401); assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

test('regular user cannot call admin API', async () => {
  const response = await request(createApp({ pool, config, repository: repositoryFixture() }))
    .get('/api/v1/admin/users').set('Authorization', `Bearer ${token('1d20938a-a211-4cb6-ae65-df1084fe10dc')}`);
  assert.equal(response.status, 403); assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('internal status endpoint requires the service key', async () => {
  const response = await request(createApp({ pool, config, repository: repositoryFixture() }))
    .get('/internal/v1/users/1d20938a-a211-4cb6-ae65-df1084fe10dc/status');
  assert.equal(response.status, 401); assert.equal(response.body.error.code, 'INVALID_SERVICE_KEY');
});
