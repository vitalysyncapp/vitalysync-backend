import crypto from 'crypto';

export function attachRequestContext(req, res, next) {
  const requestId = req.get('x-request-id') || crypto.randomUUID();

  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
}
