import { randomUUID } from 'node:crypto';

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContext(serviceName) {
  return (req, res, next) => {
    const incoming = req.get('X-Request-Id');
    req.requestId = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(), service: serviceName, request_id: req.requestId,
        method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2))
      }));
    });
    next();
  };
}
