import crypto from 'node:crypto';

export const AUTH_COOKIE_NAME = 'metrovanai_session';
export const OAUTH_STATE_COOKIE_NAME = 'metrovanai_oauth_state';
export const OAUTH_VERIFIER_COOKIE_NAME = 'metrovanai_oauth_verifier';
export const OAUTH_RETURN_COOKIE_NAME = 'metrovanai_oauth_return_to';
export const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

interface CookieOptions {
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  secure?: boolean;
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}

function scrypt(password: string, salt: string, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, expectedHash] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (expectedBuffer.length !== 64) {
    return false;
  }

  const actualBuffer = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const item of cookieHeader.split(';')) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

export function buildSessionCookie(token: string, secure = false) {
  return buildCookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    maxAgeSeconds: Math.round(AUTH_SESSION_TTL_MS / 1000),
    secure
  });
}

export function clearSessionCookie(secure = false) {
  return clearCookie(AUTH_COOKIE_NAME, secure);
}

export function buildOAuthCookie(name: string, value: string, maxAgeSeconds = 600, secure = false) {
  return buildCookie(name, value, { httpOnly: true, maxAgeSeconds, secure });
}

export function clearCookie(name: string, secure = false) {
  return buildCookie(name, '', { httpOnly: true, maxAgeSeconds: 0, secure });
}

export function createPkceVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

export function createPkceChallenge(verifier: string) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function createOAuthState() {
  return crypto.randomBytes(24).toString('base64url');
}

export function resolveGoogleAuthConfig(redirectUriFallback?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || redirectUriFallback?.trim() || 'http://127.0.0.1:8787/api/auth/google/callback';
  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri
  } satisfies GoogleAuthConfig;
}

export function buildGoogleAuthUrl(config: GoogleAuthConfig, state: string, codeChallenge: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeGoogleCode(config: GoogleAuthConfig, code: string, codeVerifier: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as { access_token: string };
}

export async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Google profile fetch failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GoogleProfile;
}

export function sanitizeReturnTo(input: string | undefined) {
  const fallback = '/';
  if (!input) {
    return fallback;
  }

  try {
    if (input.startsWith('/')) {
      return input;
    }

    const parsed = new URL(input);
    const allowedHosts = new Set(['127.0.0.1', 'localhost', 'metrovanai.com', 'www.metrovanai.com']);
    if (!allowedHosts.has(parsed.hostname)) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function buildCookie(name: string, value: string, options: CookieOptions) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.round(options.maxAgeSeconds))}`);
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
