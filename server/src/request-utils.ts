import type express from 'express';

export function getForwardedHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return (
    String(value ?? '')
      .split(',')
      .map((part) => part.trim())
      .find(Boolean) ?? ''
  );
}

export function getClientIp(req: express.Request) {
  const forwardedFor = getForwardedHeader(req.headers['x-forwarded-for']);
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}
