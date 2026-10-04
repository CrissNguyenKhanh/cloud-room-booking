import { ZodError } from 'zod';
export const notFound = (_req, _res, next) => next(Object.assign(new Error('Route not found'), { status: 404, code: 'NOT_FOUND' }));
export const errorHandler = (_config) => (error, req, res, _next) => {
  const validation = error instanceof ZodError;
  const status = validation ? 400 : (error.status || 500);
  res.status(status).json({ error: { code: validation ? 'VALIDATION_ERROR' : (error.code || 'INTERNAL_ERROR'),
    message: validation ? 'Dữ liệu đầu vào không hợp lệ' : (status === 500 ? 'Lỗi máy chủ nội bộ' : error.message) }, request_id: req.requestId });
};
