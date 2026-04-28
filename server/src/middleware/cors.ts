import cors from 'cors';

export function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return true;
    }
    return (
      origin === 'https://metrovanai.com' ||
      origin === 'https://www.metrovanai.com' ||
      origin === 'https://api.metrovanai.com'
    );
  } catch {
    return false;
  }
}

export function createCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin) ? origin || true : false);
    },
    credentials: true
  });
}
