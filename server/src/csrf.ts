import { timingSafeEqual } from 'node:crypto';
import type express from 'express';

export function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getCsrfTokenFromRequest(req: express.Request) {
  const headerValue = req.headers['x-csrf-token'];
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() ?? '';
  }
  return typeof headerValue === 'string' ? headerValue.trim() : '';
}

export function isCsrfProtectedRequest(req: express.Request) {
  if (!req.path.startsWith('/api/')) {
    return false;
  }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return false;
  }
  if (req.path.startsWith('/api/auth/')) {
    return false;
  }
  if (req.path === '/api/stripe/webhook') {
    return false;
  }
  return true;
}
