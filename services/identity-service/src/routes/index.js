import { Router } from 'express';
import { asyncHandler } from '../utils/errors.js';
import { authMiddleware, internalAuth, requireRole } from '../middleware/auth.js';

export function createRoutes({ controller, pool, config }) {
  const router = Router();
  const auth = authMiddleware(config);
  router.get('/health', (_req, res) => res.json({ status: 'ok', service: config.serviceName }));
  router.get('/ready', asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', service: config.serviceName });
  }));
  router.post('/api/v1/auth/register', asyncHandler(controller.register));
  router.post('/api/v1/auth/login', asyncHandler(controller.login));
  router.get('/api/v1/users/me', auth, asyncHandler(controller.me));
  router.get('/api/v1/admin/users', auth, requireRole('ADMIN'), asyncHandler(controller.list));
  router.patch('/api/v1/admin/users/:id/status', auth, requireRole('ADMIN'), asyncHandler(controller.updateStatus));
  router.get('/internal/v1/users/:id/status', internalAuth(config), asyncHandler(controller.internalStatus));
  return router;
}
