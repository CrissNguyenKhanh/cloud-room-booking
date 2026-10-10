import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/errors.js';

export function verifyAccessToken(token, config) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('Missing token');
  const claims = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience
  });
  if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('Missing subject');
  }
  return { id: claims.sub, role: claims.role, status: claims.status };
}

export const authMiddleware = (config) => (req, _res, next) => {
  const [scheme, token] = (req.get('Authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'AUTH_REQUIRED', 'Yêu cầu JWT hợp lệ'));
  try {
    req.user = verifyAccessToken(token, config);
    next();
  } catch { next(new ApiError(401, 'INVALID_TOKEN', 'JWT không hợp lệ hoặc đã hết hạn')); }
};
export const internalAuth = (config) => (req, _res, next) => {
  const supplied = req.get('X-Service-Key') || '';
  const expected = config.internalServiceKey;
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  valid ? next() : next(new ApiError(401, 'INVALID_SERVICE_KEY', 'Service key không hợp lệ'));
};
