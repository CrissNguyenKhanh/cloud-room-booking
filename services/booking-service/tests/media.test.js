import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { ApiError } from '../src/utils/errors.js';

const activeRoomId = '11111111-1111-4111-8111-111111111111';
const inactiveRoomId = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  cloudinary: null,
  mediaMaxImageBytes: 5 * 1024 * 1024,
  mediaMaxVideoBytes: 30 * 1024 * 1024,
  mediaMaxPerRoom: 20,
};

const validEnvironment = {
  FRONTEND_ORIGIN: 'http://localhost:5173',
  BOOKING_DATABASE_URL: 'postgresql://booking:test@localhost/cloud_room',
  JWT_SECRET: config.jwtSecret,
  JWT_ISSUER: config.jwtIssuer,
  JWT_AUDIENCE: config.jwtAudience,
  INTERNAL_SERVICE_KEY: config.internalServiceKey,
  IDENTITY_SERVICE_URL: 'http://localhost:3001',
  NOTIFICATION_SERVICE_URL: 'http://localhost:3003',
};

const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
const identityClient = { assertActive: async () => ({ status: 'ACTIVE' }) };
const dispatcher = { dispatchById: async () => {}, retryBatch: async () => [] };

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);
const webm = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function token(role = 'ADMIN') {
  return jwt.sign({ role, status: 'ACTIVE' }, config.jwtSecret, {
    subject: userId,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: '1h',
  });
}

class MediaRepositoryFake {
  constructor() {
    this.rooms = [
      { id: activeRoomId, active: true },
      { id: inactiveRoomId, active: false },
    ];
    this.media = [];
  }

  async getRoom(id, includeInactive = false) {
    return this.rooms.find((room) => room.id === id && (includeInactive || room.active)) || null;
  }

  async listMedia(roomId) {
    return this.media.filter((media) => media.room_id === roomId)
      .sort((left, right) => Number(right.is_cover) - Number(left.is_cover)
        || left.sort_order - right.sort_order);
  }

  async getMedia(roomId, mediaId) {
    return this.media.find((media) => media.room_id === roomId && media.id === mediaId) || null;
  }

  async addMedia(roomId, data, maxPerRoom) {
    if (!this.rooms.some((room) => room.id === roomId)) return { outcome: 'ROOM_NOT_FOUND' };
    const existing = this.media.filter((media) => media.room_id === roomId);
    if (existing.length >= maxPerRoom) return { outcome: 'LIMIT_REACHED' };
    const now = new Date().toISOString();
    const media = {
      id: randomUUID(),
      room_id: roomId,
      ...data,
      sort_order: Math.max(0, ...existing.map((item) => item.sort_order)) + 1,
      is_cover: data.media_type === 'image' && !existing.some((item) => item.is_cover),
      created_at: now,
      updated_at: now,
    };
    this.media.push(media);
    return { outcome: 'OK', media };
  }

  async updateMedia(roomId, mediaId, data) {
    if (!this.rooms.some((room) => room.id === roomId)) return { outcome: 'ROOM_NOT_FOUND' };
    const media = await this.getMedia(roomId, mediaId);
    if (!media) return { outcome: 'MEDIA_NOT_FOUND' };
    if (data.is_cover === true && media.media_type !== 'image') return { outcome: 'NOT_IMAGE' };
    if (data.is_cover === true) {
      this.media.filter((item) => item.room_id === roomId).forEach((item) => { item.is_cover = false; });
    }
    for (const field of ['alt_text', 'sort_order', 'is_cover']) {
      if (data[field] !== undefined) media[field] = data[field];
    }
    media.updated_at = new Date().toISOString();
    return { outcome: 'OK', media };
  }

  async replaceMediaFile(roomId, mediaId, data) {
    if (!this.rooms.some((room) => room.id === roomId)) return { outcome: 'ROOM_NOT_FOUND' };
    const media = await this.getMedia(roomId, mediaId);
    if (!media) return { outcome: 'MEDIA_NOT_FOUND' };
    const previous = { ...media };
    Object.assign(media, data, { updated_at: new Date().toISOString() });
    if (data.media_type === 'video') media.is_cover = false;
    if (previous.is_cover && data.media_type === 'video') {
      const next = this.media.find((item) => item.room_id === roomId
        && item.id !== mediaId && item.media_type === 'image');
      if (next) next.is_cover = true;
    } else if (data.media_type === 'image'
      && !this.media.some((item) => item.room_id === roomId && item.is_cover)) {
      media.is_cover = true;
    }
    return { outcome: 'OK', media, previous };
  }

  async deleteMedia(roomId, mediaId) {
    if (!this.rooms.some((room) => room.id === roomId)) return { outcome: 'ROOM_NOT_FOUND' };
    const index = this.media.findIndex((media) => media.room_id === roomId && media.id === mediaId);
    if (index < 0) return { outcome: 'MEDIA_NOT_FOUND' };
    const [deleted] = this.media.splice(index, 1);
    if (deleted.is_cover) {
      const next = this.media.find((item) => item.room_id === roomId && item.media_type === 'image');
      if (next) next.is_cover = true;
    }
    return { outcome: 'OK', media: deleted };
  }

  seed(roomId, mediaType = 'image', isCover = false) {
    const now = new Date().toISOString();
    const media = {
      id: randomUUID(),
      room_id: roomId,
      media_type: mediaType,
      url: `https://cdn.test/${randomUUID()}`,
      thumbnail_url: 'https://cdn.test/thumbnail',
      public_id: `rooms/${randomUUID()}`,
      format: mediaType === 'image' ? 'png' : 'webm',
      bytes: 12,
      width: 100,
      height: 100,
      duration_seconds: mediaType === 'video' ? 1 : null,
      alt_text: '',
      sort_order: this.media.filter((item) => item.room_id === roomId).length + 1,
      is_cover: isCover,
      created_at: now,
      updated_at: now,
    };
    this.media.push(media);
    return media;
  }
}

function storageFixture(overrides = {}) {
  const storage = {
    enabled: true,
    uploads: [],
    destroys: [],
    async upload(input) {
      this.uploads.push(input);
      const id = `rooms/upload-${this.uploads.length}`;
      return {
        url: `https://cdn.test/${id}`,
        thumbnail_url: `https://cdn.test/${id}-thumbnail`,
        public_id: id,
        format: input.mediaType === 'image' ? 'png' : 'webm',
        bytes: input.buffer.length,
        width: 100,
        height: 100,
        duration_seconds: input.mediaType === 'video' ? 1 : null,
      };
    },
    async destroy(publicId, mediaType) {
      this.destroys.push({ publicId, mediaType });
    },
    ...overrides,
  };
  return storage;
}

function fixture({ repository = new MediaRepositoryFake(), mediaStorage,
  configOverrides = {} } = {}) {
  const appConfig = { ...config, ...configOverrides };
  const options = { pool, config: appConfig, repository, identityClient, dispatcher };
  if (mediaStorage !== undefined) options.mediaStorage = mediaStorage;
  return { repository, app: createApp(options), config: appConfig };
}

function adminRequest(app, method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token()}`);
}

test('Cloudinary credentials are optional and only upload is disabled when missing', async () => {
  const loaded = loadConfig(validEnvironment);
  assert.equal(loaded.cloudinary, null);
  assert.equal(loaded.mediaMaxImageBytes, 5 * 1024 * 1024);

  const { app } = fixture();
  const health = await request(app).get('/health');
  const publicList = await request(app).get(`/api/v1/rooms/${activeRoomId}/media`);
  const upload = await adminRequest(app, 'post', `/api/v1/admin/rooms/${activeRoomId}/media`)
    .attach('file', png, { filename: 'room.png', contentType: 'image/png' });

  assert.equal(health.status, 200);
  assert.equal(publicList.status, 200);
  assert.equal(upload.status, 503);
  assert.equal(upload.body.error.code, 'MEDIA_NOT_CONFIGURED');
});

test('public reads active-room media without exposing public_id; admin reads inactive rooms', async () => {
  const repository = new MediaRepositoryFake();
  repository.seed(activeRoomId, 'image', true);
  repository.seed(inactiveRoomId, 'image', true);
  const { app } = fixture({ repository, mediaStorage: storageFixture() });

  const publicActive = await request(app).get(`/api/v1/rooms/${activeRoomId}/media`);
  const publicInactive = await request(app).get(`/api/v1/rooms/${inactiveRoomId}/media`);
  const noAuth = await request(app).get(`/api/v1/admin/rooms/${inactiveRoomId}/media`);
  const customer = await request(app).get(`/api/v1/admin/rooms/${inactiveRoomId}/media`)
    .set('Authorization', `Bearer ${token('USER')}`);
  const admin = await adminRequest(app, 'get', `/api/v1/admin/rooms/${inactiveRoomId}/media`);

  assert.equal(publicActive.status, 200);
  assert.equal('public_id' in publicActive.body.data[0], false);
  assert.equal(publicInactive.status, 404);
  assert.equal(noAuth.status, 401);
  assert.equal(customer.status, 403);
  assert.equal(admin.status, 200);
  assert.ok(admin.body.data[0].public_id);
});

test('all media mutation routes reject a non-admin token', async () => {
  const { app } = fixture({ mediaStorage: storageFixture() });
  const mediaId = randomUUID();
  const auth = { Authorization: `Bearer ${token('USER')}` };
  const responses = await Promise.all([
    request(app).post(`/api/v1/admin/rooms/${activeRoomId}/media`).set(auth),
    request(app).put(`/api/v1/admin/rooms/${activeRoomId}/media/${mediaId}/file`).set(auth),
    request(app).patch(`/api/v1/admin/rooms/${activeRoomId}/media/${mediaId}`).set(auth).send({ alt_text: 'x' }),
    request(app).delete(`/api/v1/admin/rooms/${activeRoomId}/media/${mediaId}`).set(auth),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [403, 403, 403, 403]);
});

test('upload rejects invalid content and enforces image byte limits before storage', async () => {
  const storage = storageFixture();
  const { app } = fixture({
    mediaStorage: storage,
    configOverrides: { mediaMaxImageBytes: png.length, mediaMaxVideoBytes: 1024 },
  });

  const invalid = await adminRequest(app, 'post', `/api/v1/admin/rooms/${activeRoomId}/media`)
    .attach('file', Buffer.from('not-an-image'), { filename: 'fake.png', contentType: 'image/png' });
  const oversized = await adminRequest(app, 'post', `/api/v1/admin/rooms/${activeRoomId}/media`)
    .attach('file', Buffer.concat([png, Buffer.from([0x00])]), {
      filename: 'large.png', contentType: 'image/png',
    });

  assert.equal(invalid.status, 415);
  assert.equal(invalid.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'FILE_TOO_LARGE');
  assert.equal(storage.uploads.length, 0);
});

test('upload stores valid media, assigns the first image as cover, and cleans up at the room limit', async () => {
  const repository = new MediaRepositoryFake();
  const storage = storageFixture();
  const { app } = fixture({
    repository,
    mediaStorage: storage,
    configOverrides: { mediaMaxPerRoom: 1 },
  });

  const uploaded = await adminRequest(app, 'post', `/api/v1/admin/rooms/${activeRoomId}/media`)
    .field('alt_text', 'Suite cover')
    .attach('file', png, { filename: 'cover.png', contentType: 'image/png' });
  const overLimit = await adminRequest(app, 'post', `/api/v1/admin/rooms/${activeRoomId}/media`)
    .attach('file', webm, { filename: 'tour.webm', contentType: 'video/webm' });

  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.data.media_type, 'image');
  assert.equal(uploaded.body.data.alt_text, 'Suite cover');
  assert.equal(uploaded.body.data.is_cover, true);
  assert.equal(overLimit.status, 409);
  assert.equal(overLimit.body.error.code, 'MEDIA_LIMIT_REACHED');
  assert.deepEqual(storage.destroys[0], { publicId: 'rooms/upload-2', mediaType: 'video' });
});

test('metadata update moves the cover and refuses to use a video as cover', async () => {
  const repository = new MediaRepositoryFake();
  const first = repository.seed(activeRoomId, 'image', true);
  const second = repository.seed(activeRoomId, 'image');
  const video = repository.seed(activeRoomId, 'video');
  const { app } = fixture({ repository, mediaStorage: storageFixture() });

  const moved = await adminRequest(app, 'patch', `/api/v1/admin/rooms/${activeRoomId}/media/${second.id}`)
    .send({ alt_text: 'New cover', sort_order: 7, is_cover: true });
  const rejected = await adminRequest(app, 'patch', `/api/v1/admin/rooms/${activeRoomId}/media/${video.id}`)
    .send({ is_cover: true });

  assert.equal(moved.status, 200);
  assert.equal(moved.body.data.alt_text, 'New cover');
  assert.equal(moved.body.data.sort_order, 7);
  assert.equal(moved.body.data.is_cover, true);
  assert.equal(first.is_cover, false);
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error.code, 'COVER_MUST_BE_IMAGE');
});

test('replace keeps the media id, deletes the old storage object, and reassigns a video cover', async () => {
  const repository = new MediaRepositoryFake();
  const original = repository.seed(activeRoomId, 'image', true);
  const fallback = repository.seed(activeRoomId, 'image');
  const oldPublicId = original.public_id;
  const storage = storageFixture();
  const { app } = fixture({ repository, mediaStorage: storage });

  const response = await adminRequest(
    app,
    'put',
    `/api/v1/admin/rooms/${activeRoomId}/media/${original.id}/file`,
  ).attach('file', webm, { filename: 'tour.webm', contentType: 'video/webm' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, original.id);
  assert.equal(response.body.data.media_type, 'video');
  assert.equal(response.body.data.is_cover, false);
  assert.equal(response.body.storage_cleanup_pending, false);
  assert.equal(fallback.is_cover, true);
  assert.deepEqual(storage.destroys[0], { publicId: oldPublicId, mediaType: 'image' });
});

test('delete removes metadata and storage, then promotes the next image to cover', async () => {
  const repository = new MediaRepositoryFake();
  const cover = repository.seed(activeRoomId, 'image', true);
  const next = repository.seed(activeRoomId, 'image');
  const storage = storageFixture();
  const { app } = fixture({ repository, mediaStorage: storage });

  const response = await adminRequest(
    app,
    'delete',
    `/api/v1/admin/rooms/${activeRoomId}/media/${cover.id}`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { id: cover.id, deleted: true });
  assert.equal(response.body.storage_cleanup_pending, false);
  assert.equal(next.is_cover, true);
  assert.equal(await repository.getMedia(activeRoomId, cover.id), null);
  assert.deepEqual(storage.destroys[0], { publicId: cover.public_id, mediaType: 'image' });
});

test('storage upload errors are preserved and destroy errors are reported as pending cleanup', async () => {
  const uploadFailureStorage = storageFixture({
    async upload() {
      throw new ApiError(502, 'MEDIA_UPLOAD_FAILED', 'storage unavailable');
    },
  });
  const uploadFixture = fixture({ mediaStorage: uploadFailureStorage });
  const failedUpload = await adminRequest(
    uploadFixture.app,
    'post',
    `/api/v1/admin/rooms/${activeRoomId}/media`,
  ).attach('file', png, { filename: 'room.png', contentType: 'image/png' });

  const repository = new MediaRepositoryFake();
  const media = repository.seed(activeRoomId, 'image', true);
  const deleteFailureStorage = storageFixture({
    async destroy() { throw new Error('storage unavailable'); },
  });
  const deleteFixture = fixture({ repository, mediaStorage: deleteFailureStorage });
  const deleted = await adminRequest(
    deleteFixture.app,
    'delete',
    `/api/v1/admin/rooms/${activeRoomId}/media/${media.id}`,
  );

  assert.equal(failedUpload.status, 502);
  assert.equal(failedUpload.body.error.code, 'MEDIA_UPLOAD_FAILED');
  assert.equal(uploadFixture.repository.media.length, 0);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.storage_cleanup_pending, true);
  assert.equal(await repository.getMedia(activeRoomId, media.id), null);
});
