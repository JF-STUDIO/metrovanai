import type express from 'express';
import helmet from 'helmet';

export function createHelmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: false,
    originAgentCluster: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
}

export function createSecurityHeadersMiddleware(
  shouldUseSecureCookies: (req: express.Request) => boolean
): express.RequestHandler {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (shouldUseSecureCookies(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
