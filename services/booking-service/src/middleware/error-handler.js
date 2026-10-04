import { ZodError } from 'zod';
export function notFound(req, _res, next) { next(Object.assign(new Error(`Route not found: ${req.method} ${req.path}`), { status: 404, code: 'NOT_FOUND' })); }
export function errorHandler(config) {
  return (error, req, res, _next) => {
    const validation = error instanceof ZodError;
    const status = validation ? 400 : (error.status || 500);
    const body = { error: { code: validation ? 'VALIDATION_ERROR' : (error.code || 'INTERNAL_ERROR'),
      message: validation ? 'Dữ liệu đầu vào không hợp lệ' : (status === 500 ? 'Lỗi máy chủ nội bộ' : error.message) }, request_id: req.requestId };
    if (validation) body.error.details = error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
    if (status >= 500) console.error(JSON.stringify({ timestamp: new Date().toISOString(), service: config.serviceName,
      request_id: req.requestId, level: 'error', code: error.code || 'INTERNAL_ERROR', message: error.message,
      ...(config.nodeEnv === 'production' ? {} : { stack: error.stack }) }));
    res.status(status).json(body);
  };
}
