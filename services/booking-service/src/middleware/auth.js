import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/errors.js';

export function authMiddleware(config) {
  return (req, _res, next) => {
    const [scheme, token] = (req.get('Authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'AUTH_REQUIRED', 'Yêu cầu JWT hợp lệ'));
    try {
      const claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: config.jwtIssuer, audience: config.jwtAudience });
      if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Missing subject');
      if (claims.status !== 'ACTIVE') return next(new ApiError(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa'));
      req.user = { id: claims.sub, role: claims.role, status: claims.status };
      next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      next(new ApiError(401, 'INVALID_TOKEN', 'JWT không hợp lệ hoặc đã hết hạn'));
    }
  };
}
export const requireRole = (role) => (req, _res, next) => req.user?.role === role
  ? next() : next(new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này'));
