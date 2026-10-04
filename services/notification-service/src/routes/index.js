import { Router } from 'express';
import { authMiddleware, internalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
export function createRoutes({ controller, pool, config }) {
  const router = Router();
  router.get('/health', (_req, res) => res.json({ status: 'ok', service: config.serviceName }));
  router.get('/ready', asyncHandler(async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ready', service: config.serviceName }); }));
  router.post('/internal/v1/events', internalAuth(config), asyncHandler(controller.receive));
  router.get('/api/v1/notifications', authMiddleware(config), asyncHandler(controller.list));
  router.patch('/api/v1/notifications/:id/read', authMiddleware(config), asyncHandler(controller.markRead));
  return router;
}
