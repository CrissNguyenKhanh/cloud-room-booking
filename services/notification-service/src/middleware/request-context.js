import { randomUUID } from 'node:crypto';
export const requestContext = (service) => (req, res, next) => {
  const supplied = req.get('X-Request-Id');
  req.requestId = supplied && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  res.set('X-Request-Id', req.requestId);
  const start = process.hrtime.bigint();
  res.on('finish', () => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service,
    request_id: req.requestId, method: req.method, path: req.path, status: res.statusCode,
    duration_ms: Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)) })));
  next();
};
