import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
const config = { serviceName: 'notification-service', frontendOrigin: 'http://localhost:5173', nodeEnv: 'test',
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters', jwtIssuer: 'issuer', jwtAudience: 'audience',
  internalServiceKey: 'test-service-key-long-enough' };
test('health endpoint exposes process health', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) }, config,
    repository: { create: async () => ({}), listByUser: async () => [], markRead: async () => null } });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200); assert.equal(response.body.status, 'ok');
});
