import type express from 'express';
import { createTraceId } from '../observability.js';

export const traceIdMiddleware: express.RequestHandler = (req, res, next) => {
  const traceId = createTraceId('req');
  (req as express.Request & { traceId?: string }).traceId = traceId;
  res.setHeader('X-Metrovan-Trace-Id', traceId);
  next();
};
