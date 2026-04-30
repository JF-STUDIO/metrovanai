import type express from 'express';
import helmet from 'helmet';

function isEnabledEnv(name: string) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function parseCspSourceList(name: string) {
  return String(process.env[name] ?? '')
    .split(/[,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function envOrigin(name: string) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function uniqueSources(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildStyleSources() {
  const sources = ["'self'", 'https://api.fontshare.com', 'https://fonts.googleapis.com'];
  if (!isEnabledEnv('METROVAN_STRICT_CSP')) {
    sources.splice(1, 0, "'unsafe-inline'");
  }
  return sources;
}

function buildContentSecurityPolicy(req: express.Request, shouldUseSecureCookies: (req: express.Request) => boolean) {
  const objectStorageOrigin = envOrigin('METROVAN_OBJECT_STORAGE_ENDPOINT');
  const appOrigin =
    envOrigin('PUBLIC_APP_URL') || envOrigin('METROVAN_PUBLIC_APP_URL') || envOrigin('FRONTEND_PUBLIC_URL');
  const connectSources = uniqueSources([
    "'self'",
    appOrigin,
    objectStorageOrigin,
    'https://api.metrovanai.com',
    'https://metrovanai.com',
    'https://www.metrovanai.com',
    'https://*.r2.cloudflarestorage.com',
    'https://*.r2.dev',
    'https://*.ingest.sentry.io',
    ...parseCspSourceList('METROVAN_CSP_CONNECT_SRC')
  ]);

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': buildStyleSources(),
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:', 'https://cdn.fontshare.com', 'https://fonts.gstatic.com'],
    'connect-src': connectSources,
    'media-src': ["'self'", 'blob:', 'https:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://checkout.stripe.com'],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', 'https://checkout.stripe.com'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"]
  };

  if (shouldUseSecureCookies(req)) {
    directives['upgrade-insecure-requests'] = [];
  }

  return Object.entries(directives)
    .map(([name, sources]) => (sources.length ? `${name} ${sources.join(' ')}` : name))
    .join('; ');
}

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
    if (!isEnabledEnv('METROVAN_DISABLE_CSP')) {
      const headerName = isEnabledEnv('METROVAN_CSP_REPORT_ONLY')
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy';
      res.setHeader(headerName, buildContentSecurityPolicy(req, shouldUseSecureCookies));
    }
    if (shouldUseSecureCookies(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
