import './env.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_TTL_MS,
  OAUTH_RETURN_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_VERIFIER_COOKIE_NAME,
  buildGoogleAuthUrl,
  buildOAuthCookie,
  buildSessionCookie,
  clearCookie,
  clearSessionCookie,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  createSessionToken,
  exchangeGoogleCode,
  fetchGoogleProfile,
  hashPassword,
  hashSessionToken,
  parseCookieHeader,
  resolveGoogleAuthConfig,
  sanitizeReturnTo,
  verifyPassword
} from './auth.js';
import { buildProjectDownloadArchive, getDefaultDownloadOptions } from './downloads.js';
import { buildHdrItemsFromFrontendLayout } from './importer.js';
import { extractPreviewOrConvertToJpeg } from './images.js';
import { sendEmailVerificationEmail, sendPasswordResetEmail } from './mailer.js';
import { MAX_RUNPOD_HDR_BATCH_SIZE, MIN_RUNPOD_HDR_BATCH_SIZE } from './metadata.js';
import {
  assertDirectObjectUploadConfigured,
  createDirectObjectUploadTarget,
  deleteObjectsFromStorage,
  deleteProjectIncomingObjects,
  downloadDirectObjectToFile,
  getDirectObjectUploadCapabilities,
  isDirectUploadKeyForProject,
  restoreObjectToFileIfAvailable
} from './object-storage.js';
import {
  constructStripeWebhookEvent,
  createStripeCheckoutSession,
  getStripeClient,
  getStripeCurrency,
  getStripeWebhookSecret,
  isStripeConfigured
} from './payments.js';
import { ProjectProcessor } from './processor.js';
import { LocalStore } from './store.js';
import type Stripe from 'stripe';
import type {
  BillingActivationCode,
  BillingPackage,
  ExposureFile,
  HdrItem,
  ProjectJobState,
  ProjectRecord,
  ResultAsset,
  UserRecord
} from './types.js';
import { isImageExtension, isRawExtension, sanitizeSegment } from './utils.js';
import { buildDeploymentReadiness } from './deployment-readiness.js';
import { captureServerError, createTraceId, initServerObservability, logServerEvent } from './observability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const clientDistRoot = path.join(repoRoot, 'client', 'dist');
const clientIndexPath = path.join(clientDistRoot, 'index.html');
const port = Number(process.env.PORT ?? 8787);
const app = express();

function isEnabledEnv(name: string) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || isEnabledEnv('METROVAN_CLOUD_ONLY_MODE');
}

function assertCloudProductionRuntime() {
  if (!isProductionRuntime() || isEnabledEnv('METROVAN_ALLOW_LOCAL_PRODUCTION')) {
    return;
  }

  const missing: string[] = [];
  const metadataProvider = String(process.env.METROVAN_METADATA_PROVIDER ?? '').trim().toLowerCase();
  const taskExecutor = String(process.env.METROVAN_TASK_EXECUTOR ?? '').trim().toLowerCase();

  if (!['postgres-json', 'supabase-postgres'].includes(metadataProvider)) {
    missing.push('METROVAN_METADATA_PROVIDER=postgres-json');
  }
  if (!String(process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '').trim()) {
    missing.push('SUPABASE_DB_URL or DATABASE_URL');
  }
  if (!isEnabledEnv('METROVAN_DIRECT_UPLOAD_ENABLED')) {
    missing.push('METROVAN_DIRECT_UPLOAD_ENABLED=true');
  }

  for (const key of [
    'METROVAN_OBJECT_STORAGE_ENDPOINT',
    'METROVAN_OBJECT_STORAGE_BUCKET',
    'METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID',
    'METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY'
  ]) {
    if (!String(process.env[key] ?? '').trim()) {
      missing.push(key);
    }
  }

  if (!['runpod-native', 'runpod-serverless', 'runpod-http', 'remote-http'].includes(taskExecutor)) {
    missing.push('METROVAN_TASK_EXECUTOR=runpod-native');
  }
  if (taskExecutor === 'runpod-native' || taskExecutor === 'runpod-serverless') {
    for (const key of ['METROVAN_RUNPOD_ENDPOINT_ID', 'METROVAN_RUNPOD_API_KEY']) {
      if (!String(process.env[key] ?? '').trim()) {
        missing.push(key);
      }
    }
  }

  if (missing.length) {
    throw new Error(`Cloud production configuration is incomplete: ${Array.from(new Set(missing)).join(', ')}`);
  }
}

function isLocalProxyUploadEnabled() {
  return !isProductionRuntime() || isEnabledEnv('METROVAN_LOCAL_PROXY_UPLOAD_ENABLED');
}

assertCloudProductionRuntime();
await initServerObservability();
const store = new LocalStore(repoRoot);
await store.initialize();
const processor = new ProjectProcessor(repoRoot, store);
const POINT_PRICE_USD = 0.25;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;
const TRASH_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 6;

const trashCleanupTimer = setInterval(() => {
  try {
    store.cleanupExpiredTrash();
  } catch (error) {
    console.error('Trash cleanup failed:', error);
  }
}, TRASH_CLEANUP_INTERVAL_MS);
trashCleanupTimer.unref?.();

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const MIN_CUSTOM_TOP_UP_USD = 1;
const MAX_CUSTOM_TOP_UP_USD = 50000;
const clientEventSchema = z.object({
  level: z.enum(['info', 'warning', 'error']).optional(),
  message: z.string().min(1).max(1000),
  stack: z.string().max(6000).nullable().optional(),
  route: z.string().max(500).optional(),
  projectId: z.string().max(120).nullable().optional(),
  taskId: z.string().max(200).nullable().optional(),
  userAgent: z.string().max(1000).optional(),
  occurredAt: z.string().max(80).optional(),
  context: z.record(z.string(), z.unknown()).optional()
});

function normalizeTopUpAmountUsd(amountUsd: number) {
  if (!Number.isFinite(amountUsd)) {
    return null;
  }

  const rounded = Number(amountUsd.toFixed(2));
  if (rounded < MIN_CUSTOM_TOP_UP_USD || rounded > MAX_CUSTOM_TOP_UP_USD) {
    return null;
  }

  return rounded;
}

function getBaseTopUpPoints(amountUsd: number) {
  return Math.max(1, Math.floor(amountUsd / POINT_PRICE_USD));
}

function createTopUpPackage(input: { id: string; name: string; amountUsd: number; discountPercent: number }) {
  const amountUsd = Number(input.amountUsd.toFixed(2));
  const basePoints = getBaseTopUpPoints(amountUsd);
  const bonusPoints = Math.round(basePoints * (input.discountPercent / 100));
  const points = basePoints + bonusPoints;
  return {
    id: input.id,
    name: input.name,
    points,
    listPriceUsd: amountUsd,
    amountUsd,
    discountPercent: input.discountPercent,
    pointPriceUsd: POINT_PRICE_USD,
    bonusPoints
  };
}

function createCustomTopUpPackage(amountUsd: number): BillingPackage {
  const normalizedAmountUsd = normalizeTopUpAmountUsd(amountUsd);
  if (normalizedAmountUsd === null) {
    throw new Error('Invalid custom recharge amount.');
  }

  const basePoints = getBaseTopUpPoints(normalizedAmountUsd);
  return {
    id: `custom-${Math.round(normalizedAmountUsd * 100)}`,
    name: `$${normalizedAmountUsd.toFixed(2)} Custom Recharge`,
    points: basePoints,
    listPriceUsd: normalizedAmountUsd,
    amountUsd: normalizedAmountUsd,
    discountPercent: 0,
    pointPriceUsd: POINT_PRICE_USD,
    bonusPoints: 0
  };
}

function rebuildTopUpPackage(basePackage: BillingPackage, input?: { discountPercent?: number; extraBonusPoints?: number }) {
  const discountPercent = Math.max(0, Math.round(input?.discountPercent ?? basePackage.discountPercent));
  const basePoints = getBaseTopUpPoints(basePackage.amountUsd);
  const packageBonusPoints = Math.round(basePoints * (discountPercent / 100));
  const extraBonusPoints = Math.max(0, Math.round(input?.extraBonusPoints ?? 0));
  const bonusPoints = packageBonusPoints + extraBonusPoints;
  return {
    ...basePackage,
    points: basePoints + bonusPoints,
    discountPercent,
    bonusPoints
  };
}

function isActivationCodeAvailable(activationCode: BillingActivationCode) {
  if (!activationCode.active) {
    return false;
  }

  if (
    activationCode.maxRedemptions !== null &&
    activationCode.maxRedemptions !== undefined &&
    activationCode.redemptionCount >= activationCode.maxRedemptions
  ) {
    return false;
  }

  if (activationCode.expiresAt) {
    const expiresAt = Date.parse(activationCode.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return false;
    }
  }

  return true;
}

function applyActivationCodeToPackage(basePackage: BillingPackage, activationCode: BillingActivationCode) {
  const effectiveDiscountPercent = Math.max(
    basePackage.discountPercent,
    activationCode.discountPercentOverride ?? basePackage.discountPercent
  );
  return rebuildTopUpPackage(basePackage, {
    discountPercent: effectiveDiscountPercent,
    extraBonusPoints: activationCode.bonusPoints
  });
}

const TOP_UP_PACKAGES = [
  createTopUpPackage({ id: 'recharge-100', name: '$100 Recharge', amountUsd: 100, discountPercent: 5 }),
  createTopUpPackage({ id: 'recharge-500', name: '$500 Recharge', amountUsd: 500, discountPercent: 10 }),
  createTopUpPackage({ id: 'recharge-1000', name: '$1000 Recharge', amountUsd: 1000, discountPercent: 20 }),
  createTopUpPackage({ id: 'recharge-2000', name: '$2000 Recharge', amountUsd: 2000, discountPercent: 40 })
] as const;

function resolveTopUpSelection(input: { packageId?: string; customAmountUsd?: number; activationCode?: string }) {
  const normalizedCustomAmount =
    input.customAmountUsd === undefined ? null : normalizeTopUpAmountUsd(input.customAmountUsd);
  if (input.customAmountUsd !== undefined && normalizedCustomAmount === null) {
    return { ok: false as const, status: 400, error: 'Custom recharge amount must be between $1.00 and $50,000.00.' };
  }

  const selectedPackage = normalizedCustomAmount
    ? createCustomTopUpPackage(normalizedCustomAmount)
    : TOP_UP_PACKAGES.find((item) => item.id === input.packageId);
  if (!selectedPackage) {
    return { ok: false as const, status: 404, error: 'Top-up package not found.' };
  }

  const submittedActivationCode = input.activationCode?.trim() ?? '';
  let effectivePackage: BillingPackage = selectedPackage;
  let activationCode: BillingActivationCode | null = null;

  if (submittedActivationCode) {
    activationCode = store.getActivationCodeByCode(submittedActivationCode);
    if (!activationCode || !isActivationCodeAvailable(activationCode)) {
      return { ok: false as const, status: 404, error: '激活码无效。' };
    }

    if (activationCode.packageId && activationCode.packageId !== selectedPackage.id) {
      return { ok: false as const, status: 400, error: '这个激活码不能用于当前充值档位。' };
    }

    effectivePackage = applyActivationCodeToPackage(selectedPackage, activationCode);
  }

  return { ok: true as const, selectedPackage, effectivePackage, activationCode };
}

type PublicHdrItemStatus = 'review' | 'processing' | 'completed' | 'error';
type PublicJobStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
type AuthContext = NonNullable<ReturnType<typeof getAuthenticatedContext>>;

app.set('trust proxy', true);

function getConfiguredAdminEmails() {
  return String(process.env.METROVAN_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

function isConfiguredAdminEmail(email: string) {
  return getConfiguredAdminEmails().includes(normalizeEmail(email));
}

function getEffectiveUserRole(user: UserRecord) {
  return user.role === 'admin' || isConfiguredAdminEmail(user.email) ? 'admin' : 'user';
}

function isUserDisabled(user: UserRecord) {
  return user.accountStatus === 'disabled';
}

function isAdminUser(user: UserRecord) {
  return !isUserDisabled(user) && getEffectiveUserRole(user) === 'admin';
}

function appendSetCookie(res: express.Response, cookieValue: string) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookieValue]);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }

  res.setHeader('Set-Cookie', [String(current), cookieValue]);
}

function buildAuthSessionResponse(user: NonNullable<ReturnType<typeof store.getUserById>>, csrfToken?: string) {
  return {
    csrfToken,
    user: {
      id: user.id,
      userKey: user.userKey,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      displayName: user.displayName,
      locale: user.locale,
      role: getEffectiveUserRole(user),
      accountStatus: user.accountStatus
    }
  };
}

function addQueryParam(target: string, key: string, value: string) {
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      const url = new URL(target);
      url.searchParams.set(key, value);
      return url.toString();
    }

    const url = new URL(target, 'http://127.0.0.1');
    url.searchParams.set(key, value);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/?${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function getForwardedHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean) ?? '';
}

function getRawHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function getRequestProtocol(req: express.Request) {
  const forwardedProto = getForwardedHeader(req.headers['x-forwarded-proto']);
  if (forwardedProto) {
    return forwardedProto;
  }
  return req.secure ? 'https' : 'http';
}

function getRequestHost(req: express.Request) {
  const forwardedHost = getForwardedHeader(req.headers['x-forwarded-host']);
  if (forwardedHost) {
    return forwardedHost;
  }
  return req.headers.host || `127.0.0.1:${port}`;
}

function getRequestOrigin(req: express.Request) {
  return `${getRequestProtocol(req)}://${getRequestHost(req)}`;
}

function buildGoogleRedirectUri(req: express.Request) {
  return `${getRequestOrigin(req)}/api/auth/google/callback`;
}

function shouldUseSecureCookies(req: express.Request) {
  return getRequestProtocol(req) === 'https';
}

function getPublicAppOrigin(req: express.Request) {
  const configured =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.METROVAN_PUBLIC_APP_URL?.trim() ||
    process.env.FRONTEND_PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const origin = getRequestOrigin(req);
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === 'api.metrovanai.com') {
      return 'https://metrovanai.com';
    }
  } catch {
    return origin;
  }

  return origin;
}

function buildEmailVerificationUrl(req: express.Request, token: string) {
  const url = new URL(getPublicAppOrigin(req));
  url.searchParams.set('auth', 'verify');
  url.searchParams.set('token', token);
  return url.toString();
}

function buildPasswordResetUrl(req: express.Request, token: string) {
  const url = new URL(getPublicAppOrigin(req));
  url.searchParams.set('auth', 'reset');
  url.searchParams.set('token', token);
  return url.toString();
}

function getClientIp(req: express.Request) {
  const forwardedFor = getForwardedHeader(req.headers['x-forwarded-for']);
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isStrongPassword(password: string) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function checkRateLimit(
  req: express.Request,
  res: express.Response,
  input: { scope: string; limit: number; windowMs: number; message?: string }
) {
  const now = Date.now();
  const key = `${input.scope}:${getClientIp(req)}`;
  const existing = rateLimitBuckets.get(key);
  const bucket: RateLimitBucket =
    existing && existing.resetAt > now
      ? existing
      : {
          count: 0,
          resetAt: now + input.windowMs
        };

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count <= input.limit) {
    return true;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: input.message ?? 'Too many attempts. Please try again later.' });
  return false;
}

async function sendVerificationForUser(req: express.Request, user: NonNullable<ReturnType<typeof store.getUserById>>) {
  if (user.emailVerifiedAt) {
    return null;
  }

  const rawToken = createSessionToken();
  const verificationToken = store.createEmailVerificationToken(
    user.id,
    hashSessionToken(rawToken),
    EMAIL_VERIFICATION_TTL_MS
  );
  const delivery = await sendEmailVerificationEmail({
    to: user.email,
    displayName: user.displayName,
    verificationUrl: buildEmailVerificationUrl(req, rawToken),
    expiresAt: verificationToken.expiresAt
  });
  return { verificationToken, delivery };
}

function getAuthenticatedContext(req: express.Request, touchSession = true) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionToken = cookies[AUTH_COOKIE_NAME];
  if (!sessionToken) {
    return null;
  }

  const session = store.getSessionByTokenHash(hashSessionToken(sessionToken));
  if (!session) {
    return null;
  }

  const user = store.getUserById(session.userId);
  if (!user) {
    return null;
  }
  if (isUserDisabled(user)) {
    store.deleteSessionsForUser(user.id);
    return null;
  }

  if (touchSession) {
    store.touchSession(session.id);
  }

  return { user, session };
}

function requireAuthenticatedUser(req: express.Request, res: express.Response) {
  const auth = getAuthenticatedContext(req);
  if (!auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return auth.user;
}

function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createCsrfTokenForSession(sessionId: string) {
  const token = createSessionToken();
  store.setSessionCsrfTokenHash(sessionId, hashSessionToken(token));
  return token;
}

function getCsrfTokenFromRequest(req: express.Request) {
  const headerValue = req.headers['x-csrf-token'];
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() ?? '';
  }
  return typeof headerValue === 'string' ? headerValue.trim() : '';
}

function isCsrfProtectedRequest(req: express.Request) {
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

function requireValidCsrf(req: express.Request, res: express.Response, auth: AuthContext) {
  const submittedToken = getCsrfTokenFromRequest(req);
  if (!submittedToken || !auth.session.csrfTokenHash) {
    res.status(403).json({ error: 'CSRF token is required. Refresh and try again.' });
    return false;
  }

  if (!safeHashEqual(hashSessionToken(submittedToken), auth.session.csrfTokenHash)) {
    res.status(403).json({ error: 'Invalid CSRF token. Refresh and try again.' });
    return false;
  }

  return true;
}

function buildBillingPayload(userKey: string) {
  return {
    summary: store.getBillingSummary(userKey),
    entries: store.listBillingEntries(userKey),
    packages: TOP_UP_PACKAGES
  };
}

function getStripeObjectId(value: string | { id?: string } | null | undefined) {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id ?? null;
}

function buildStripeCheckoutReturnUrls(req: express.Request) {
  const appOrigin = getPublicAppOrigin(req).replace(/\/+$/, '');
  return {
    successUrl: `${appOrigin}/studio?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appOrigin}/studio?payment=cancelled`
  };
}

function isInternalTopUpAllowed() {
  const value = String(process.env.METROVAN_ALLOW_INTERNAL_TOP_UP ?? '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function getOrderFromStripeSession(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.metrovanOrderId || session.client_reference_id || '';
  if (orderId) {
    const order = store.getPaymentOrderById(orderId);
    if (order) {
      return order;
    }
  }
  return store.getPaymentOrderByStripeSessionId(session.id);
}

function settlePaidStripeCheckoutSession(
  req: express.Request | null,
  session: Stripe.Checkout.Session,
  source: 'webhook' | 'confirm'
) {
  const order = getOrderFromStripeSession(session);
  if (!order) {
    return { ok: false as const, status: 404, error: 'Payment order not found.' };
  }

  const stripePaymentIntentId = getStripeObjectId(session.payment_intent);
  const stripeCustomerId = getStripeObjectId(session.customer);

  if (session.payment_status !== 'paid') {
    const status = session.status === 'expired' ? 'expired' : 'checkout_created';
    store.markPaymentOrderStatus(order.id, {
      status,
      stripePaymentIntentId,
      stripeCustomerId,
      errorMessage: session.payment_status ? `Stripe payment status: ${session.payment_status}` : null
    });
    return { ok: false as const, status: 402, error: 'Payment has not been completed yet.' };
  }

  const fulfilled = store.fulfillPaymentOrder(order.id, {
    stripePaymentIntentId,
    stripeCustomerId,
    note: `Stripe payment: ${order.packageName}${order.activationCode ? ` with ${order.activationCode}` : ''}`
  });
  if (!fulfilled) {
    return { ok: false as const, status: 404, error: 'Payment order not found.' };
  }

  if (req && fulfilled.created) {
    writeSecurityAuditLog(req, {
      action: 'billing.stripe.fulfilled',
      targetUserId: order.userId,
      details: {
        source,
        orderId: order.id,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId,
        points: order.points,
        amountUsd: order.amountUsd
      }
    });
  }

  return { ok: true as const, order: fulfilled.order, entry: fulfilled.entry, created: fulfilled.created };
}

interface AdminAccessContext {
  actorUser: UserRecord;
  actorType: 'admin-user';
  actorEmail: string;
}

function requireAdminApiAccess(req: express.Request, res: express.Response) {
  const auth = getAuthenticatedContext(req);
  if (auth?.user && isAdminUser(auth.user)) {
    return {
      actorUser: auth.user,
      actorType: 'admin-user' as const,
      actorEmail: auth.user.email
    };
  }

  if (auth?.user && !isAdminUser(auth.user)) {
    res.status(403).json({ error: 'Admin role is required.' });
    return null;
  }

  res.status(401).json({ error: 'Admin authentication required.' });
  return null;
}

function writeAdminAuditLog(
  req: express.Request,
  actor: AdminAccessContext,
  input: {
    action: string;
    targetUserId?: string | null;
    targetProjectId?: string | null;
    details?: Record<string, unknown>;
  }
) {
  return store.createAuditLog({
    actorUserId: actor.actorUser?.id ?? null,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    targetProjectId: input.targetProjectId ?? null,
    ipAddress: getClientIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
    details: input.details ?? {}
  });
}

function writeSecurityAuditLog(
  req: express.Request,
  input: {
    action: string;
    targetUserId?: string | null;
    targetProjectId?: string | null;
    details?: Record<string, unknown>;
  }
) {
  return store.createAuditLog({
    actorUserId: null,
    actorEmail: null,
    actorType: 'system',
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    targetProjectId: input.targetProjectId ?? null,
    ipAddress: getClientIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
    details: input.details ?? {}
  });
}

function parseAdminExpiresAt(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function buildAdminActivationCodePayload() {
  return {
    items: store.listActivationCodes().map((item) => ({
      ...item,
      available: isActivationCodeAvailable(item),
      packageName: item.packageId ? TOP_UP_PACKAGES.find((pkg) => pkg.id === item.packageId)?.name ?? null : null
    })),
    packages: TOP_UP_PACKAGES
  };
}

function buildAdminUserRecord(user: UserRecord) {
  const projects = store.listProjects(user.userKey);
  const billingSummary = store.getBillingSummary(user.userKey);
  const sessions = store.listUserSessions(user.id);
  return {
    id: user.id,
    userKey: user.userKey,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    displayName: user.displayName,
    locale: user.locale,
    role: getEffectiveUserRole(user),
    accountStatus: user.accountStatus,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    auth: {
      password: Boolean(user.passwordHash),
      google: Boolean(user.googleSubject)
    },
    projectCount: projects.length,
    completedProjectCount: projects.filter((project) => project.status === 'completed').length,
    processingProjectCount: projects.filter((project) => project.status === 'processing' || project.status === 'uploading').length,
    photoCount: projects.reduce((sum, project) => sum + project.photoCount, 0),
    resultCount: projects.reduce((sum, project) => sum + project.resultAssets.length, 0),
    activeSessionCount: sessions.length,
    lastSeenAt: sessions[0]?.lastSeenAt ?? null,
    billingSummary
  };
}

function buildAdminUserSummary(input: {
  search?: string;
  role?: 'all' | 'user' | 'admin';
  accountStatus?: 'all' | 'active' | 'disabled';
  emailVerified?: 'all' | 'verified' | 'unverified';
  page?: number;
  pageSize?: number;
} = {}) {
  const search = input.search?.trim().toLowerCase() ?? '';
  const role = input.role ?? 'all';
  const accountStatus = input.accountStatus ?? 'all';
  const emailVerified = input.emailVerified ?? 'all';
  const pageSize = Math.max(5, Math.min(100, Math.round(input.pageSize ?? 25)));
  const page = Math.max(1, Math.round(input.page ?? 1));
  const users = store.listUsers().filter((user) => {
    if (search) {
      const haystack = `${user.email} ${user.displayName} ${user.userKey}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    if (role !== 'all' && getEffectiveUserRole(user) !== role) {
      return false;
    }
    if (accountStatus !== 'all' && user.accountStatus !== accountStatus) {
      return false;
    }
    if (emailVerified === 'verified' && !user.emailVerifiedAt) {
      return false;
    }
    if (emailVerified === 'unverified' && user.emailVerifiedAt) {
      return false;
    }
    return true;
  });
  const total = users.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const startIndex = (normalizedPage - 1) * pageSize;
  return {
    total,
    page: normalizedPage,
    pageSize,
    pageCount,
    items: users.slice(startIndex, startIndex + pageSize).map((user) => buildAdminUserRecord(user))
  };
}

function buildProjectAssetRoute(projectId: string, segments: string[]) {
  return `/api/projects/${encodeURIComponent(projectId)}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function appendAssetVersion(url: string | null, version: string | null | undefined) {
  if (!url || !version) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function getRegeneratedAssetVersion(regeneration: HdrItem['regeneration'] | ResultAsset['regeneration']) {
  if (!regeneration) {
    return null;
  }
  return regeneration.completedAt ?? regeneration.startedAt ?? regeneration.taskId ?? null;
}

function getPublicHdrItemStatus(status: HdrItem['status']): PublicHdrItemStatus {
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'error') {
    return 'error';
  }
  if (status === 'review') {
    return 'review';
  }
  return 'processing';
}

function getPublicHdrItemStatusText(status: PublicHdrItemStatus) {
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'error') {
    return '处理失败';
  }
  if (status === 'review') {
    return '待确认';
  }
  return '处理中';
}

const activePublicJobPhases = new Set<ProjectJobState['phase']>([
  'uploading',
  'grouping',
  'queued',
  'hdr_merging',
  'workflow_uploading',
  'workflow_running',
  'result_returning',
  'regenerating'
]);

function hasUnfinishedRemoteWork(job: ProjectJobState) {
  const total = job.workflowRealtime?.total ?? 0;
  if (total <= 0) {
    return (job.workflowRealtime?.active ?? 0) > 0;
  }

  const finished = (job.workflowRealtime?.returned ?? 0) + (job.workflowRealtime?.failed ?? 0);
  return finished < total || (job.workflowRealtime?.active ?? 0) > 0;
}

function getPublicJobStatus(job: ProjectJobState): PublicJobStatus {
  if (job.status === 'completed') {
    return 'completed';
  }
  if (job.status === 'failed' && !hasUnfinishedRemoteWork(job)) {
    return 'failed';
  }
  if (job.phase === 'queued' || job.status === 'queued') {
    return 'pending';
  }
  if (job.status === 'running' || activePublicJobPhases.has(job.phase) || hasUnfinishedRemoteWork(job)) {
    return 'processing';
  }
  return job.status;
}

function getPublicJobPhaseLabel(phase: ProjectJobState['phase'], status: PublicJobStatus) {
  if (status === 'completed' || phase === 'completed') {
    return '处理完成';
  }
  if (status === 'failed' || phase === 'failed') {
    return '处理失败';
  }
  if (phase === 'uploading') {
    return '正在上传照片';
  }
  if (phase === 'grouping') {
    return '正在确认分组';
  }
  if (phase === 'queued') {
    return '排队中';
  }
  if (phase === 'hdr_merging') {
    return '正在合成照片';
  }
  if (phase === 'workflow_uploading') {
    return '正在提交处理';
  }
  if (phase === 'workflow_running') {
    return '正在处理照片';
  }
  if (phase === 'result_returning') {
    return '正在回传结果';
  }
  if (phase === 'regenerating') {
    return '正在重新生成';
  }
  return status === 'pending' ? '准备中' : '等待处理';
}

function getPublicJobDetail(job: ProjectJobState, status: PublicJobStatus) {
  if (status === 'completed') {
    return '结果已生成，可在线查看和下载。';
  }
  if (status === 'failed') {
    return '部分照片暂时未能完成，请检查后重试。';
  }

  const realtime = job.workflowRealtime;
  if (realtime?.total) {
    const finished = realtime.returned + realtime.failed;
    const parts = [`已完成 ${finished}/${realtime.total}`];
    if (realtime.active > 0) {
      parts.push(`处理中 ${realtime.active}`);
    }
    if (realtime.failed > 0) {
      parts.push(`待重试 ${realtime.failed}`);
    }
    return parts.join(' · ');
  }

  if (status === 'pending') {
    return '系统正在准备当前任务。';
  }
  if (job.phase === 'hdr_merging') {
    return '正在合成并准备照片。';
  }
  if (job.phase === 'workflow_uploading') {
    return '正在提交照片，请稍候。';
  }
  if (job.phase === 'workflow_running') {
    return '照片正在处理中，完成后会自动显示结果。';
  }
  if (job.phase === 'result_returning') {
    return '正在保存处理结果。';
  }
  return '上传照片后即可开始处理。';
}

function getPublicErrorMessage(error: unknown, fallback = '处理失败，请稍后再试。') {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('runninghub') ||
    lower.includes('runpod') ||
    lower.includes('workflow') ||
    lower.includes('remote executor') ||
    lower.includes('api key') ||
    lower.includes('apikey')
  ) {
    return '处理服务暂时不可用，请稍后再试。';
  }

  if (
    lower.includes('exiftool') ||
    lower.includes('imagemagick') ||
    lower.includes('magick') ||
    lower.includes('rawtherapee') ||
    lower.includes('align_image_stack') ||
    lower.includes('enfuse') ||
    lower.includes('hdr alignment') ||
    lower.includes('scene classifier')
  ) {
    return '照片读取或处理失败，请重新选择照片或稍后再试。';
  }

  return message || fallback;
}

function canServeExposurePreview(exposure: ExposureFile) {
  if (exposure.previewPath && exposure.previewKey !== null && fs.existsSync(exposure.previewPath)) {
    return true;
  }

  return Boolean(exposure.storagePath && fs.existsSync(exposure.storagePath));
}

function buildPublicExposure(projectId: string, hdrItemId: string, exposure: ExposureFile) {
  return {
    id: exposure.id,
    fileName: exposure.fileName,
    originalName: exposure.originalName,
    extension: exposure.extension,
    mimeType: exposure.mimeType,
    size: exposure.size,
    isRaw: exposure.isRaw,
    previewUrl: canServeExposurePreview(exposure)
      ? buildProjectAssetRoute(projectId, ['hdr-items', hdrItemId, 'exposures', exposure.id, 'preview'])
      : null,
    captureTime: exposure.captureTime,
    sequenceNumber: exposure.sequenceNumber,
    exposureCompensation: exposure.exposureCompensation,
    exposureSeconds: exposure.exposureSeconds,
    iso: exposure.iso,
    fNumber: exposure.fNumber,
    focalLength: exposure.focalLength
  };
}

function buildPublicHdrItem(project: ProjectRecord, hdrItem: HdrItem) {
  const status = getPublicHdrItemStatus(hdrItem.status);
  const resultVersion = getRegeneratedAssetVersion(hdrItem.regeneration);
  const selectedExposure =
    hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0] ?? null;
  const previewUrl =
    hdrItem.resultPath || (selectedExposure && canServeExposurePreview(selectedExposure))
      ? appendAssetVersion(
          buildProjectAssetRoute(project.id, ['hdr-items', hdrItem.id, 'preview']),
          hdrItem.resultPath ? resultVersion : null
        )
      : null;
  const resultUrl = hdrItem.resultPath
    ? appendAssetVersion(
        buildProjectAssetRoute(project.id, ['hdr-items', hdrItem.id, 'result']),
        resultVersion
      )
    : null;
  return {
    id: hdrItem.id,
    index: hdrItem.index,
    title: hdrItem.title,
    groupId: hdrItem.groupId,
    sceneType: hdrItem.sceneType,
    selectedExposureId: hdrItem.selectedExposureId,
    previewUrl,
    status,
    statusText: getPublicHdrItemStatusText(status),
    errorMessage: hdrItem.errorMessage ? '这张照片暂时未能处理，请稍后重试。' : null,
    resultUrl,
    resultFileName: hdrItem.resultFileName,
    regeneration: hdrItem.regeneration ?? null,
    exposures: hdrItem.exposures.map((exposure) => buildPublicExposure(project.id, hdrItem.id, exposure))
  };
}

function buildPublicResultAsset(projectId: string, asset: ResultAsset) {
  const fileUrl = appendAssetVersion(
    buildProjectAssetRoute(projectId, ['results', asset.id, 'file']),
    getRegeneratedAssetVersion(asset.regeneration)
  );
  return {
    id: asset.id,
    hdrItemId: asset.hdrItemId,
    fileName: asset.fileName,
    storageUrl: fileUrl,
    previewUrl: fileUrl,
    sortOrder: asset.sortOrder,
    regeneration: asset.regeneration ?? null
  };
}

function buildPublicJob(job: ProjectJobState | null) {
  if (!job) {
    return null;
  }

  const status = getPublicJobStatus(job);
  const phase = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : job.phase;
  return {
    id: job.id,
    status,
    phase,
    phaseLabel: getPublicJobPhaseLabel(phase, status),
    percent: Math.max(0, Math.min(100, Math.round(job.percent))),
    label: getPublicJobPhaseLabel(phase, status),
    detail: getPublicJobDetail(job, status),
    currentHdrItemId: job.currentHdrItemId,
    taskId: job.workflowRealtime?.currentNodeId ?? null,
    metrics: {
      total: job.workflowRealtime?.total ?? 0,
      submitted: job.workflowRealtime?.entered ?? 0,
      returned: job.workflowRealtime?.returned ?? 0,
      succeeded: job.workflowRealtime?.succeeded ?? 0,
      failed: job.workflowRealtime?.failed ?? 0,
      active: job.workflowRealtime?.active ?? 0,
      queuePosition: job.workflowRealtime?.queuePosition ?? 0,
      remoteProgress: job.workflowRealtime?.remoteProgress ?? 0
    },
    startedAt: job.startedAt,
    completedAt: job.completedAt
  };
}

function buildPublicProject(project: ProjectRecord) {
  const regenerationUsage = project.regenerationUsage ?? {
    freeLimit: 10,
    freeUsed: project.hdrItems.filter((hdrItem) => hdrItem.regeneration?.freeUsed).length,
    paidUsed: 0
  };

  return {
    id: project.id,
    userKey: project.userKey,
    userDisplayName: project.userDisplayName,
    name: project.name,
    address: project.address,
    status: project.status,
    currentStep: project.currentStep,
    pointsEstimate: project.pointsEstimate,
    pointsSpent: project.pointsSpent,
    regenerationUsage,
    photoCount: project.photoCount,
    groupCount: project.groupCount,
    downloadReady: project.downloadReady,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    uploadCompletedAt: project.uploadCompletedAt ?? null,
    hdrItems: project.hdrItems.map((hdrItem) => buildPublicHdrItem(project, hdrItem)),
    groups: project.groups,
    resultAssets: project.resultAssets.map((asset) => buildPublicResultAsset(project.id, asset)),
    job: buildPublicJob(project.job)
  };
}

function respondWithProject(res: express.Response, project: ProjectRecord, statusCode = 200) {
  res.status(statusCode).json({ project: buildPublicProject(project) });
}

function collectProjectObjectStorageKeys(project: ProjectRecord) {
  const keys = new Set<string>();
  const addKey = (key: string | null | undefined) => {
    if (key) {
      keys.add(key);
    }
  };

  for (const hdrItem of project.hdrItems) {
    addKey(hdrItem.mergedKey);
    addKey(hdrItem.resultKey);
    for (const exposure of hdrItem.exposures) {
      addKey(exposure.storageKey);
      addKey(exposure.previewKey);
    }
  }
  for (const asset of project.resultAssets) {
    addKey(asset.storageKey);
  }

  return Array.from(keys);
}

async function deleteProjectObjectStorage(project: ProjectRecord) {
  const [cleanup, incomingCleanup] = await Promise.all([
    deleteObjectsFromStorage(collectProjectObjectStorageKeys(project)),
    deleteProjectIncomingObjects({
      userKey: project.userKey,
      projectId: project.id,
      userDisplayName: project.userDisplayName,
      projectName: project.name
    })
  ]);
  const combined = {
    deleted: cleanup.deleted + incomingCleanup.deleted,
    failed: [...cleanup.failed, ...incomingCleanup.failed]
  };
  if (combined.failed.length) {
    console.warn(`R2 cleanup skipped ${combined.failed.length} objects for project ${project.id}`, combined.failed);
  }
  return combined;
}

function sendProtectedStorageFile(res: express.Response, filePath: string | null, storageKey?: string | null) {
  if (!filePath) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const resolvedPath = path.resolve(filePath);
  if (!isPathInsideDirectory(resolvedPath, store.getStorageRoot())) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    void restoreObjectToFileIfAvailable(storageKey, resolvedPath)
      .then((restored) => {
        if (!restored) {
          res.status(404).json({ error: 'File not found.' });
          return;
        }
        sendProtectedStorageFile(res, filePath);
      })
      .catch(() => {
        res.status(404).json({ error: 'File not found.' });
      });
    return;
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(resolvedPath);
}

async function ensureExposurePreviewFile(exposure: ExposureFile) {
  try {
    if (!exposure.previewPath) {
      return null;
    }

    const previewPath = path.resolve(exposure.previewPath);
    const storageRoot = store.getStorageRoot();
    if (!isPathInsideDirectory(previewPath, storageRoot)) {
      return null;
    }

    if (fs.existsSync(previewPath) && fs.statSync(previewPath).isFile()) {
      return previewPath;
    }

    const sourcePath = path.resolve(exposure.storagePath);
    if (!isPathInsideDirectory(sourcePath, storageRoot)) {
      return null;
    }

    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      await restoreObjectToFileIfAvailable(exposure.storageKey, sourcePath);
    }

    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return null;
    }

    await extractPreviewOrConvertToJpeg(sourcePath, previewPath, 88, 1600);
    return previewPath;
  } catch {
    return null;
  }
}

function getOwnedProjectFromRequest(req: express.Request, res: express.Response) {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return null;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return null;
  }

  return { user, project };
}

function isPathInsideDirectory(filePath: string, directory: string) {
  const normalizedPath = path.resolve(filePath).toLowerCase();
  const normalizedDirectory = path.resolve(directory).toLowerCase();
  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}${path.sep}`);
}

function createUploadBatchId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DIRECT_UPLOAD_MANIFEST_FILE = '.metrovan-direct-upload-manifest.json';

type DirectUploadManifestEntry = {
  originalName?: string;
  storageKey?: string;
  localPath?: string;
};

function normalizeDirectUploadManifestName(value: string) {
  return path.basename(value.replace(/\\/g, '/')).trim().toLowerCase();
}

function collectDirectUploadManifestEntriesByName(stagingRoot: string) {
  const byName = new Map<string, DirectUploadManifestEntry[]>();

  const visit = (directory: string) => {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || entry.name !== DIRECT_UPLOAD_MANIFEST_FILE) {
        continue;
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(entryPath, 'utf8')) as { files?: DirectUploadManifestEntry[] };
        for (const file of parsed.files ?? []) {
          if (!file.originalName || !file.storageKey) {
            continue;
          }

          const normalizedName = normalizeDirectUploadManifestName(file.originalName);
          byName.set(normalizedName, [...(byName.get(normalizedName) ?? []), file]);
        }
      } catch (error) {
        console.warn('Direct upload manifest read failed:', error);
      }
    }
  };

  visit(stagingRoot);
  return byName;
}

function parseDirectUploadCompleteConcurrency() {
  const raw = Number(process.env.METROVAN_DIRECT_UPLOAD_COMPLETE_CONCURRENCY ?? 16);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 16;
  }
  return Math.max(1, Math.min(32, Math.round(raw)));
}

function shouldStageDirectUploadObjectsLocally() {
  const raw = String(process.env.METROVAN_DIRECT_UPLOAD_STAGE_LOCAL ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(raw)) {
    return false;
  }
  return !isProductionRuntime();
}

async function runWithConcurrency<T>(items: T[], concurrency: number, handler: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      await handler(item, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

function trimObjectStoragePrefix(value: string | undefined, fallback: string) {
  return String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function isCloudObjectStorageKey(storageKey: string | null | undefined) {
  if (!storageKey) {
    return false;
  }

  const normalizedKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefixes = [
    trimObjectStoragePrefix(process.env.METROVAN_OBJECT_STORAGE_INCOMING_PREFIX, 'incoming'),
    trimObjectStoragePrefix(process.env.METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX, 'projects')
  ].filter(Boolean);

  return prefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`));
}

function allocateOriginalTargetPath(originalsDir: string, desiredFileName: string, reservedPaths: Set<string>) {
  const parsed = path.parse(desiredFileName);
  const safeStem = sanitizeSegment(parsed.name) || 'source';
  const safeExtension = sanitizeSegment(parsed.ext) || parsed.ext || '';

  let attempt = 1;
  while (true) {
    const fileName = attempt === 1 ? `${safeStem}${safeExtension}` : `${safeStem}-${attempt}${safeExtension}`;
    const targetPath = path.join(originalsDir, fileName);
    const normalizedTargetPath = path.resolve(targetPath).toLowerCase();
    if (!reservedPaths.has(normalizedTargetPath) && !fs.existsSync(targetPath)) {
      reservedPaths.add(normalizedTargetPath);
      return targetPath;
    }
    attempt += 1;
  }
}

async function commitStagedOriginals(projectId: string) {
  const project = store.getProject(projectId);
  if (!project) {
    return null;
  }

  const dirs = store.ensureProjectDirectories(project);
  const stagedSourcePaths = Array.from(
    new Set(
      project.hdrItems
        .flatMap((hdrItem) => hdrItem.exposures.map((exposure) => path.resolve(exposure.storagePath)))
        .filter((filePath) => isPathInsideDirectory(filePath, dirs.staging))
    )
  );

  if (!stagedSourcePaths.length) {
    return project;
  }

  const reservedPaths = new Set(
    fs
      .readdirSync(dirs.originals)
      .map((fileName) => path.join(dirs.originals, fileName))
      .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
      .map((filePath) => path.resolve(filePath).toLowerCase())
  );
  const committedPaths = new Map<string, string>();
  const committedStorageKeys = new Map<string, string>();
  const manifestEntriesByName = collectDirectUploadManifestEntriesByName(dirs.staging);
  const stagedExposureByPath = new Map<string, (typeof project.hdrItems)[number]['exposures'][number]>();
  const uploadStillOpen = !project.uploadCompletedAt;

  for (const hdrItem of project.hdrItems) {
    for (const exposure of hdrItem.exposures) {
      const resolvedStoragePath = path.resolve(exposure.storagePath);
      if (isPathInsideDirectory(resolvedStoragePath, dirs.staging)) {
        stagedExposureByPath.set(resolvedStoragePath.toLowerCase(), exposure);
      }
    }
  }

  for (const sourcePath of stagedSourcePaths) {
    const exposure = stagedExposureByPath.get(path.resolve(sourcePath).toLowerCase());
    const normalizedSourcePath = path.resolve(sourcePath).toLowerCase();
    let storageKey = exposure?.storageKey ?? null;
    if (!isCloudObjectStorageKey(storageKey) && exposure) {
      const manifestEntry = manifestEntriesByName
        .get(normalizeDirectUploadManifestName(exposure.originalName || exposure.fileName || path.basename(sourcePath)))
        ?.shift();
      storageKey = manifestEntry?.storageKey ?? storageKey;
    }

    if ((!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) && isCloudObjectStorageKey(storageKey)) {
      const targetPath = allocateOriginalTargetPath(dirs.originals, path.basename(sourcePath), reservedPaths);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      committedPaths.set(normalizedSourcePath, targetPath);
      committedStorageKeys.set(normalizedSourcePath, storageKey as string);
      continue;
    }

    if ((!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) && uploadStillOpen) {
      continue;
    }

    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      await restoreObjectToFileIfAvailable(storageKey, sourcePath);
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`暂存原图不存在：${path.basename(sourcePath)}`);
    }

    const targetPath = allocateOriginalTargetPath(dirs.originals, path.basename(sourcePath), reservedPaths);
    fs.copyFileSync(sourcePath, targetPath);
    committedPaths.set(normalizedSourcePath, targetPath);
  }

  const updated = store.updateProject(projectId, (current) => ({
    ...current,
    hdrItems: current.hdrItems.map((hdrItem) => ({
      ...hdrItem,
      exposures: hdrItem.exposures.map((exposure) => {
        const resolvedSourcePath = path.resolve(exposure.storagePath);
        if (!isPathInsideDirectory(resolvedSourcePath, dirs.staging)) {
          return exposure;
        }

        const committedPath = committedPaths.get(resolvedSourcePath.toLowerCase());
        if (!committedPath) {
          if (uploadStillOpen) {
            return exposure;
          }
          throw new Error(`找不到已提交的原图：${exposure.originalName || exposure.fileName}`);
        }
        const cloudStorageKey = committedStorageKeys.get(resolvedSourcePath.toLowerCase()) ?? exposure.storageKey;
        const storageKey =
          isCloudObjectStorageKey(cloudStorageKey) && cloudStorageKey ? cloudStorageKey : store.toStorageKey(committedPath);

        return {
          ...exposure,
          fileName: path.basename(committedPath),
          storageKey,
          storagePath: committedPath,
          storageUrl: isCloudObjectStorageKey(storageKey) ? store.toStorageUrlFromKey(storageKey) : store.toStorageUrl(committedPath)
        };
      })
    }))
  }));

  if (!updated) {
    throw new Error('Project not found.');
  }

  return updated;
}

const createProjectSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional()
});

const registerSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(1).optional(),
  password: z.string().refine(isStrongPassword, {
    message: 'Weak password.'
  })
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1)
});

const passwordResetRequestSchema = z.object({
  email: z.email()
});

const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(20),
  password: z.string().refine(isStrongPassword, {
    message: 'Weak password.'
  })
});

const emailVerificationConfirmSchema = z.object({
  token: z.string().trim().min(20)
});

const emailVerificationResendSchema = z.object({
  email: z.email()
});

const accountSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  locale: z.enum(['zh', 'en'])
});

const patchProjectSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  currentStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  status: z.enum(['draft', 'importing', 'review', 'uploading', 'processing', 'completed', 'failed']).optional()
});

const groupUpdateSchema = z.object({
  sceneType: z.enum(['interior', 'exterior', 'pending']).optional(),
  colorMode: z.enum(['default', 'replace']).optional(),
  replacementColor: z.string().nullable().optional()
});

const exposureSelectionSchema = z.object({
  exposureId: z.string().min(1)
});

const moveHdrSchema = z.object({
  targetGroupId: z.string().min(1)
});

const hdrLayoutSchema = z.object({
  mode: z.enum(['replace', 'merge']).optional().default('replace'),
  inputComplete: z.boolean().optional().default(false),
  hdrItems: z
    .array(
      z.object({
        exposureOriginalNames: z.array(z.string().trim().min(1)).min(1),
        selectedOriginalName: z.string().trim().min(1).nullable().optional(),
        exposures: z
          .array(
            z.object({
              originalName: z.string().trim().min(1).max(260),
              fileName: z.string().trim().min(1).max(260).optional(),
              extension: z.string().trim().max(24).optional(),
              mimeType: z.string().trim().max(120).optional(),
              size: z.number().int().min(1).optional(),
              isRaw: z.boolean().optional(),
              storageKey: z.string().trim().min(1).max(1024).nullable().optional(),
              captureTime: z.string().trim().min(1).nullable().optional(),
              sequenceNumber: z.number().int().nullable().optional(),
              exposureCompensation: z.number().nullable().optional(),
              exposureSeconds: z.number().nullable().optional(),
              iso: z.number().nullable().optional(),
              fNumber: z.number().nullable().optional(),
              focalLength: z.number().nullable().optional()
            })
          )
          .optional()
      })
    )
    .default([])
});

const directUploadFileSchema = z.object({
  originalName: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().max(120).optional().default('application/octet-stream'),
  size: z.number().int().min(1)
});

const directUploadTargetSchema = z.object({
  files: z.array(directUploadFileSchema).min(1).max(1000)
});

const directUploadCompleteSchema = z.object({
  files: z
    .array(
      directUploadFileSchema.extend({
        storageKey: z.string().trim().min(1).max(1024)
      })
    )
    .min(1)
    .max(1000)
});

const reorderResultsSchema = z.object({
  orderedHdrItemIds: z.array(z.string().min(1)).min(1)
});

const regenerateResultSchema = z.object({
  colorCardNo: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/)
});

const downloadVariantSchema = z.object({
  key: z.enum(['hd', 'custom']),
  label: z.string().trim().min(1).max(48),
  longEdge: z.number().int().min(320).max(12000).nullable().optional(),
  width: z.number().int().min(320).max(12000).nullable().optional(),
  height: z.number().int().min(320).max(12000).nullable().optional()
});

const downloadRequestSchema = z.object({
  folderMode: z.enum(['grouped', 'flat']).optional(),
  namingMode: z.enum(['original', 'sequence', 'custom-prefix']).optional(),
  customPrefix: z.string().trim().max(40).optional(),
  variants: z.array(downloadVariantSchema).min(1).optional()
});

const topUpSchema = z.object({
  packageId: z.string().trim().min(1).optional(),
  customAmountUsd: z
    .number()
    .min(MIN_CUSTOM_TOP_UP_USD)
    .max(MAX_CUSTOM_TOP_UP_USD)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, {
      message: 'Custom recharge amount supports up to two decimal places.'
    })
    .optional(),
  activationCode: z.string().trim().max(80).optional()
}).refine((value) => Boolean(value.packageId) || value.customAmountUsd !== undefined, {
  message: 'Choose a recharge tier or enter a custom recharge amount.',
  path: ['packageId']
});
const activationCodeRedeemSchema = z.object({
  activationCode: z.string().trim().min(1).max(80)
});
const checkoutConfirmSchema = z.object({
  sessionId: z.string().trim().min(1).max(240)
});
const adminActivationCodeBaseSchema = z.object({
  code: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  packageId: z.string().trim().min(1).nullable().optional(),
  discountPercentOverride: z.number().min(0).max(100).nullable().optional(),
  bonusPoints: z.number().int().min(0).optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  redemptionCount: z.number().int().min(0).optional(),
  expiresAt: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .refine((value) => value === undefined || value === null || Boolean(parseAdminExpiresAt(value)), {
      message: 'expiresAt must be a valid ISO date-time string.'
    })
});
const adminActivationCodeCreateSchema = adminActivationCodeBaseSchema.extend({
  confirm: z.literal(true)
});
const adminActivationCodeUpdateSchema = adminActivationCodeBaseSchema.partial().extend({
  confirm: z.literal(true)
});

const adminUserUpdateSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  accountStatus: z.enum(['active', 'disabled']).optional(),
  confirm: z.literal(true)
});

const adminBillingAdjustmentSchema = z.object({
  type: z.enum(['credit', 'charge']),
  points: z.number().int().min(1).max(100000),
  note: z.string().trim().min(1).max(240),
  confirm: z.literal(true)
});

const adminSystemSettingsSchema = z.object({
  runpodHdrBatchSize: z.number().int().min(MIN_RUNPOD_HDR_BATCH_SIZE).max(MAX_RUNPOD_HDR_BATCH_SIZE),
  confirm: z.literal(true)
});

const adminConfirmSchema = z.object({
  confirm: z.literal(true)
});

function isSupportedUploadFileName(fileName: string) {
  const extension = path.extname(fileName);
  return isRawExtension(extension) || isImageExtension(extension);
}

function normalizeUploadedFileName(fileName: string) {
  const baseName = path.basename(fileName.replace(/\\/g, '/'));
  return sanitizeSegment(baseName) || `source-${Date.now()}`;
}

const upload = multer({
  fileFilter(_req, file, callback) {
    if (!isSupportedUploadFileName(file.originalname)) {
      callback(new Error('Only RAW and JPG files are supported.'));
      return;
    }
    callback(null, true);
  },
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      const auth = getAuthenticatedContext(req, false);
      if (!auth) {
        callback(new Error('Authentication required.'), '');
        return;
      }

      const project = store.getProjectForUser(String(req.params.id ?? ''), auth.user.userKey);
      if (!project) {
        callback(new Error('Project not found.'), '');
        return;
      }

      const requestWithBatch = req as express.Request & {
        uploadBatchId?: string;
        uploadFileIndex?: number;
      };
      const dirs = store.ensureProjectDirectories(project);
      if (!requestWithBatch.uploadBatchId) {
        requestWithBatch.uploadBatchId = createUploadBatchId();
        requestWithBatch.uploadFileIndex = 0;
      }

      const nextIndex = requestWithBatch.uploadFileIndex ?? 0;
      requestWithBatch.uploadFileIndex = nextIndex + 1;
      const destination = path.join(
        dirs.staging,
        requestWithBatch.uploadBatchId,
        String(nextIndex).padStart(4, '0')
      );
      fs.mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename(_req, file, callback) {
      callback(null, file.originalname);
    }
  })
});

function isAllowedCorsOrigin(origin: string | undefined) {
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

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: false,
    originAgentCluster: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
);
app.use((req, res, next) => {
  const traceId = createTraceId('req');
  (req as express.Request & { traceId?: string }).traceId = traceId;
  res.setHeader('X-Metrovan-Trace-Id', traceId);
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (shouldUseSecureCookies(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!isStripeConfigured() || !getStripeWebhookSecret()) {
    res.status(503).json({ error: 'Stripe webhook is not configured.' });
    return;
  }

  const signature = getRawHeaderValue(req.headers['stripe-signature']);
  if (!signature) {
    res.status(400).json({ error: 'Missing Stripe signature.' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = constructStripeWebhookEvent({
      rawBody: req.body as Buffer,
      signature
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid Stripe webhook.' });
    return;
  }

  if (store.hasProcessedStripeEvent(event.id)) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = settlePaidStripeCheckoutSession(req, session, 'webhook');
      if (!result.ok && result.status !== 402) {
        res.status(result.status).json({ error: result.error });
        return;
      }
    } else if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = getOrderFromStripeSession(session);
      if (order) {
        store.markPaymentOrderStatus(order.id, {
          status: 'failed',
          stripePaymentIntentId: getStripeObjectId(session.payment_intent),
          stripeCustomerId: getStripeObjectId(session.customer),
          errorMessage: 'Stripe async payment failed.'
        });
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = getOrderFromStripeSession(session);
      if (order) {
        store.markPaymentOrderStatus(order.id, {
          status: 'expired',
          stripePaymentIntentId: getStripeObjectId(session.payment_intent),
          stripeCustomerId: getStripeObjectId(session.customer),
          errorMessage: 'Stripe checkout session expired.'
        });
      }
    }

    store.markStripeEventProcessed(event.id, event.type);
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handling failed:', error);
    res.status(500).json({ error: 'Stripe webhook handling failed.' });
  }
});
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin) ? origin || true : false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.post('/api/observability/client-event', (req, res) => {
  const parsed = clientEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(204).end();
    return;
  }

  const auth = getAuthenticatedContext(req, false);
  const traceId = (req as express.Request & { traceId?: string }).traceId ?? null;
  logServerEvent({
    level: parsed.data.level,
    event: 'client.event',
    traceId,
    userKey: auth?.user.userKey ?? null,
    projectId: parsed.data.projectId ?? null,
    taskId: parsed.data.taskId ?? null,
    details: {
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      route: parsed.data.route ?? null,
      userAgent: parsed.data.userAgent ?? null,
      occurredAt: parsed.data.occurredAt ?? null,
      context: parsed.data.context ?? {}
    }
  });
  res.status(204).end();
});
app.use((req, res, next) => {
  if (!isCsrfProtectedRequest(req)) {
    next();
    return;
  }

  const auth = getAuthenticatedContext(req, false);
  if (!auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  if (!requireValidCsrf(req, res, auth)) {
    return;
  }

  next();
});

app.get(/^\/storage\/(.+)$/, (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const storageKey = String(req.params[0] ?? '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
  const [ownerKey, projectId] = storageKey.split('/');
  if (!storageKey || storageKey.includes('..') || ownerKey !== user.userKey || !projectId) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  sendProtectedStorageFile(res, store.resolveStoragePath(storageKey), storageKey);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'metrovan-ai-api'
  });
});

app.get('/api/auth/providers', (req, res) => {
  const config = resolveGoogleAuthConfig(buildGoogleRedirectUri(req));
  res.json({
    google: {
      enabled: Boolean(config)
    }
  });
});

app.get('/api/auth/session', (req, res) => {
  const auth = getAuthenticatedContext(req);
  const csrfToken = auth ? createCsrfTokenForSession(auth.session.id) : undefined;
  res.json({
    session: auth ? buildAuthSessionResponse(auth.user, csrfToken) : null
  });
});

app.get('/api/upload/capabilities', (_req, res) => {
  const localProxyEnabled = isLocalProxyUploadEnabled();
  res.json({
    localProxy: {
      enabled: localProxyEnabled,
      maxBatchBytes: 40 * 1024 * 1024,
      maxBatchFiles: 16,
      recommendedConcurrency: localProxyEnabled ? 24 : 0
    },
    directObject: getDirectObjectUploadCapabilities()
  });
});

app.patch('/api/account/settings', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const parsed = accountSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updatedUser = store.updateUser(user.id, (current) => ({
    ...current,
    displayName: parsed.data.displayName,
    locale: parsed.data.locale
  }));

  if (!updatedUser) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  res.json({ session: buildAuthSessionResponse(updatedUser) });
});

app.get('/api/billing', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  res.json(buildBillingPayload(user.userKey));
});

app.post('/api/billing/checkout', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: '支付服务暂时不可用，请稍后再试。' });
    return;
  }

  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const selection = resolveTopUpSelection(parsed.data);
  if (!selection.ok) {
    res.status(selection.status).json({ error: selection.error });
    return;
  }

  const order = store.createPaymentOrder({
    userId: user.id,
    userKey: user.userKey,
    email: user.email,
    packageId: selection.selectedPackage.id,
    packageName: selection.selectedPackage.name,
    points: selection.effectivePackage.points,
    amountUsd: selection.effectivePackage.amountUsd,
    currency: getStripeCurrency(),
    activationCodeId: selection.activationCode?.id ?? null,
    activationCode: selection.activationCode?.code ?? null,
    activationCodeLabel: selection.activationCode?.label ?? null
  });

  try {
    const checkoutSession = await createStripeCheckoutSession({
      order,
      ...buildStripeCheckoutReturnUrls(req)
    });
    const attached = store.attachStripeCheckoutSession(order.id, {
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      customerId: getStripeObjectId(checkoutSession.customer)
    });

    if (!attached || !checkoutSession.url) {
      store.markPaymentOrderStatus(order.id, {
        status: 'failed',
        errorMessage: 'Stripe did not return a checkout URL.'
      });
      res.status(502).json({ error: '支付页面创建失败，请稍后再试。' });
      return;
    }

    writeSecurityAuditLog(req, {
      action: 'billing.stripe.checkout_created',
      targetUserId: user.id,
      details: {
        orderId: order.id,
        stripeCheckoutSessionId: checkoutSession.id,
        packageId: order.packageId,
        points: order.points,
        amountUsd: order.amountUsd
      }
    });

    res.status(201).json({
      order: attached,
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url
    });
  } catch (error) {
    store.markPaymentOrderStatus(order.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ error: '支付页面创建失败，请稍后再试。' });
  }
});

app.post('/api/billing/checkout/confirm', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: '支付服务暂时不可用，请稍后再试。' });
    return;
  }

  const parsed = checkoutConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const checkoutSession = await getStripeClient().checkout.sessions.retrieve(parsed.data.sessionId);
    const order = getOrderFromStripeSession(checkoutSession);
    if (!order || order.userKey !== user.userKey) {
      res.status(404).json({ error: 'Payment order not found.' });
      return;
    }

    const result = settlePaidStripeCheckoutSession(req, checkoutSession, 'confirm');
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({
      order: result.order,
      billing: buildBillingPayload(user.userKey)
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to confirm Stripe payment.' });
  }
});

app.post('/api/billing/activation-code/redeem', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const parsed = activationCodeRedeemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const activationCode = store.getActivationCodeByCode(parsed.data.activationCode);
  if (!activationCode || !isActivationCodeAvailable(activationCode)) {
    res.status(404).json({ error: '激活码无效。' });
    return;
  }

  if (activationCode.packageId) {
    res.status(400).json({ error: '这个激活码只能在充值付款时使用。' });
    return;
  }

  if (activationCode.bonusPoints <= 0) {
    res.status(400).json({ error: '这个激活码不能直接兑换积分。' });
    return;
  }

  if (store.hasUserRedeemedActivationCode(user.userKey, activationCode.id)) {
    res.status(409).json({ error: '这个激活码已被当前账号兑换过。' });
    return;
  }

  const entry = store.createBillingEntry({
    userKey: user.userKey,
    type: 'credit',
    points: activationCode.bonusPoints,
    amountUsd: 0,
    note: `激活码兑换：${activationCode.label} (${activationCode.code})`,
    activationCodeId: activationCode.id,
    activationCode: activationCode.code,
    activationCodeLabel: activationCode.label
  });
  store.redeemActivationCode(activationCode.id);

  writeSecurityAuditLog(req, {
    action: 'billing.activation_code.redeem',
    targetUserId: user.id,
    details: {
      activationCodeId: activationCode.id,
      code: activationCode.code,
      points: activationCode.bonusPoints
    }
  });

  res.status(201).json({
    entry,
    billing: buildBillingPayload(user.userKey)
  });
});

app.post('/api/billing/top-up', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (!isInternalTopUpAllowed()) {
    res.status(410).json({ error: 'Direct top-up is disabled. Use secure Stripe checkout.' });
    return;
  }

  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const selectedPackage = TOP_UP_PACKAGES.find((item) => item.id === parsed.data.packageId);
  if (!selectedPackage) {
    res.status(404).json({ error: 'Top-up package not found.' });
    return;
  }

  const submittedActivationCode = parsed.data.activationCode?.trim() ?? '';
  let effectivePackage: BillingPackage = selectedPackage;
  let activationCode: BillingActivationCode | null = null;

  if (submittedActivationCode) {
    activationCode = store.getActivationCodeByCode(submittedActivationCode);
    if (!activationCode || !isActivationCodeAvailable(activationCode)) {
      res.status(404).json({ error: '激活码无效。' });
      return;
    }

    if (activationCode.packageId && activationCode.packageId !== selectedPackage.id) {
      res.status(400).json({ error: '这个激活码不能用于当前充值档位。' });
      return;
    }

    effectivePackage = applyActivationCodeToPackage(selectedPackage, activationCode);
  }

  const billingNote = activationCode
    ? `Top-up: ${selectedPackage.name} with ${activationCode.code} (${activationCode.label})`
    : `Top-up: ${selectedPackage.name} (+${selectedPackage.discountPercent}% credits)`;

  store.createBillingEntry(Object.assign({
    userKey: user.userKey,
    type: 'credit' as const,
    points: effectivePackage.points,
    amountUsd: effectivePackage.amountUsd,
    note: `积分充值：${selectedPackage.name}`,
    projectId: null,
    projectName: ''
  }, { note: billingNote }));

  if (activationCode) {
    store.redeemActivationCode(activationCode.id);
  }

  res.status(201).json(buildBillingPayload(user.userKey));
});

app.get('/api/admin/users', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const role = String(req.query.role ?? 'all');
  const accountStatus = String(req.query.accountStatus ?? 'all');
  const emailVerified = String(req.query.emailVerified ?? 'all');
  res.json(
    buildAdminUserSummary({
      search: String(req.query.search ?? ''),
      role: role === 'user' || role === 'admin' ? role : 'all',
      accountStatus: accountStatus === 'active' || accountStatus === 'disabled' ? accountStatus : 'all',
      emailVerified: emailVerified === 'verified' || emailVerified === 'unverified' ? emailVerified : 'all',
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25)
    })
  );
});

app.get('/api/admin/audit-logs', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const limit = Number(req.query.limit ?? 100);
  const targetUserId = String(req.query.targetUserId ?? '').trim();
  res.json({
    items: store.listAuditLogs({
      limit: Number.isFinite(limit) ? limit : 100,
      targetUserId: targetUserId || undefined
    })
  });
});

app.get('/api/admin/readiness', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json(
    buildDeploymentReadiness({
      metadata: store.getMetadataInfo(),
      storage: store.getStorageInfo(),
      executor: processor.getExecutionInfo()
    })
  );
});

app.get('/api/admin/settings', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json({
    settings: store.getSystemSettings()
  });
});

app.patch('/api/admin/settings', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminSystemSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const before = store.getSystemSettings();
  const settings = store.updateSystemSettings({
    runpodHdrBatchSize: parsed.data.runpodHdrBatchSize
  });
  writeAdminAuditLog(req, actor, {
    action: 'admin.settings.update',
    details: {
      before,
      after: settings
    }
  });

  res.json({ settings });
});

app.get('/api/admin/users/:id', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  writeAdminAuditLog(req, actor, {
    action: 'admin.user.view',
    targetUserId: user.id
  });

  res.json({
    user: buildAdminUserRecord(user),
    projects: store.listProjects(user.userKey).map((project) => buildPublicProject(project)),
    billingEntries: store.listBillingEntries(user.userKey),
    auditLogs: store.listAuditLogs({ targetUserId: user.id, limit: 100 })
  });
});

app.get('/api/admin/users/:id/projects', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  res.json({
    user: buildAdminUserRecord(user),
    items: store.listProjects(user.userKey).map((project) => buildPublicProject(project))
  });
});

app.patch('/api/admin/users/:id', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const parsed = adminUserUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (actor.actorUser?.id === user.id && parsed.data.accountStatus === 'disabled') {
    res.status(400).json({ error: 'You cannot disable your own admin account.' });
    return;
  }

  if (actor.actorUser?.id === user.id && parsed.data.role === 'user' && !isConfiguredAdminEmail(user.email)) {
    res.status(400).json({ error: 'You cannot remove your own admin role.' });
    return;
  }

  const previous = buildAdminUserRecord(user);
  const updated = store.updateUser(user.id, (current) => ({
    ...current,
    role: parsed.data.role ?? current.role,
    accountStatus: parsed.data.accountStatus ?? current.accountStatus
  }));
  if (!updated) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (parsed.data.accountStatus === 'disabled') {
    store.deleteSessionsForUser(updated.id);
  }

  writeAdminAuditLog(req, actor, {
    action: 'admin.user.update',
    targetUserId: updated.id,
    details: {
      before: {
        role: previous.role,
        accountStatus: previous.accountStatus
      },
      after: {
        role: getEffectiveUserRole(updated),
        accountStatus: updated.accountStatus
      }
    }
  });

  res.json({ user: buildAdminUserRecord(updated) });
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (actor.actorUser?.id === user.id) {
    res.status(400).json({ error: 'You cannot delete your own admin account.' });
    return;
  }

  const userProjects = store.listProjects(user.userKey);
  const cloudCleanups = await Promise.all(userProjects.map((project) => deleteProjectObjectStorage(project)));
  const deletion = store.deleteUser(user.id);
  if (!deletion) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const cloudCleanup = {
    deleted: cloudCleanups.reduce((sum, cleanup) => sum + cleanup.deleted, 0),
    failed: cloudCleanups.flatMap((cleanup) => cleanup.failed)
  };

  writeAdminAuditLog(req, actor, {
    action: 'admin.user.delete',
    targetUserId: user.id,
    details: {
      email: user.email,
      userKey: user.userKey,
      removed: deletion.removed,
      archiveCount: deletion.archives.length,
      archiveErrors: deletion.archiveErrors,
      cloudCleanup
    }
  });

  res.json({
    ok: true,
    deletedUserId: user.id,
    deletedUserEmail: user.email,
    removed: deletion.removed,
    archiveErrors: deletion.archiveErrors,
    cloudCleanup
  });
});

app.post('/api/admin/users/:id/billing-adjustments', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const parsed = adminBillingAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const entry = store.createBillingEntry({
    userKey: user.userKey,
    type: parsed.data.type,
    points: parsed.data.points,
    amountUsd: 0,
    note: `Admin adjustment: ${parsed.data.note}`,
    projectId: null,
    projectName: ''
  });

  writeAdminAuditLog(req, actor, {
    action: 'admin.billing.adjust',
    targetUserId: user.id,
    details: {
      entryId: entry.id,
      type: entry.type,
      points: entry.points,
      note: entry.note
    }
  });

  res.status(201).json({
    user: buildAdminUserRecord(store.getUserById(user.id) ?? user),
    entry,
    billingSummary: store.getBillingSummary(user.userKey),
    billingEntries: store.listBillingEntries(user.userKey),
    auditLogs: store.listAuditLogs({ targetUserId: user.id, limit: 100 })
  });
});

app.post('/api/admin/users/:id/logout', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const removed = store.deleteSessionsForUser(user.id);
  writeAdminAuditLog(req, actor, {
    action: 'admin.user.logout',
    targetUserId: user.id,
    details: { removedSessions: removed }
  });

  res.json({
    ok: true,
    removedSessions: removed,
    user: buildAdminUserRecord(store.getUserById(user.id) ?? user),
    auditLogs: store.listAuditLogs({ targetUserId: user.id, limit: 100 })
  });
});

app.get('/api/admin/activation-codes', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json(buildAdminActivationCodePayload());
});

app.post('/api/admin/activation-codes', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminActivationCodeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const nextPackageId = parsed.data.packageId ?? null;
  if (nextPackageId && !TOP_UP_PACKAGES.some((item) => item.id === nextPackageId)) {
    res.status(404).json({ error: 'Recharge tier not found for this activation code.' });
    return;
  }

  const created = store.upsertActivationCode({
    code: parsed.data.code,
    label: parsed.data.label,
    active: parsed.data.active,
    packageId: nextPackageId,
    discountPercentOverride: parsed.data.discountPercentOverride,
    bonusPoints: parsed.data.bonusPoints,
    maxRedemptions: parsed.data.maxRedemptions,
    redemptionCount: parsed.data.redemptionCount,
    expiresAt: parseAdminExpiresAt(parsed.data.expiresAt)
  });
  writeAdminAuditLog(req, actor, {
    action: 'admin.activation_code.create',
    details: { activationCodeId: created.id, code: created.code, active: created.active }
  });

  res.status(201).json({
    item: {
      ...created,
      available: isActivationCodeAvailable(created),
      packageName: created.packageId ? TOP_UP_PACKAGES.find((pkg) => pkg.id === created.packageId)?.name ?? null : null
    }
  });
});

app.patch('/api/admin/activation-codes/:id', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const activationCodeId = String(req.params.id ?? '');
  const existing = store.getActivationCodeById(activationCodeId);
  if (!existing) {
    res.status(404).json({ error: 'Activation code not found.' });
    return;
  }

  const parsed = adminActivationCodeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const nextPackageId = parsed.data.packageId === undefined ? existing.packageId : parsed.data.packageId;
  if (nextPackageId && !TOP_UP_PACKAGES.some((item) => item.id === nextPackageId)) {
    res.status(404).json({ error: 'Recharge tier not found for this activation code.' });
    return;
  }

  const updated = store.upsertActivationCode({
    id: existing.id,
    code: parsed.data.code ?? existing.code,
    label: parsed.data.label ?? existing.label,
    active: parsed.data.active ?? existing.active,
    packageId: nextPackageId,
    discountPercentOverride:
      parsed.data.discountPercentOverride === undefined
        ? existing.discountPercentOverride
        : parsed.data.discountPercentOverride,
    bonusPoints: parsed.data.bonusPoints ?? existing.bonusPoints,
    maxRedemptions:
      parsed.data.maxRedemptions === undefined ? existing.maxRedemptions : parsed.data.maxRedemptions,
    redemptionCount: parsed.data.redemptionCount ?? existing.redemptionCount,
    expiresAt:
      parsed.data.expiresAt === undefined ? existing.expiresAt : parseAdminExpiresAt(parsed.data.expiresAt)
  });
  writeAdminAuditLog(req, actor, {
    action: 'admin.activation_code.update',
    details: {
      activationCodeId: updated.id,
      code: updated.code,
      before: { active: existing.active, maxRedemptions: existing.maxRedemptions, expiresAt: existing.expiresAt },
      after: { active: updated.active, maxRedemptions: updated.maxRedemptions, expiresAt: updated.expiresAt }
    }
  });

  res.json({
    item: {
      ...updated,
      available: isActivationCodeAvailable(updated),
      packageName: updated.packageId ? TOP_UP_PACKAGES.find((pkg) => pkg.id === updated.packageId)?.name ?? null : null
    }
  });
});

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !checkRateLimit(req, res, {
      scope: `auth-register:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    }) ||
    !checkRateLimit(req, res, {
      scope: 'auth-register-ip',
      limit: 20,
      windowMs: 1000 * 60 * 60
    })
  ) {
    return;
  }

  if (store.getUserByEmail(email)) {
    res.status(409).json({ error: 'This email is already registered.' });
    return;
  }

  const user = store.createUser({
    email,
    displayName: parsed.data.displayName ?? email.split('@')[0] ?? 'user',
    passwordHash: await hashPassword(parsed.data.password)
  });
  writeSecurityAuditLog(req, {
    action: 'auth.register.created',
    targetUserId: user.id,
    details: { email: user.email }
  });
  try {
    const verification = await sendVerificationForUser(req, user);
    if (verification && !verification.delivery.sent) {
      res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
      return;
    }
  } catch (error) {
    console.error('Email verification send failed:', error);
    res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
    return;
  }
  res.status(201).json({ verificationRequired: true, email: user.email });
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !checkRateLimit(req, res, {
      scope: `auth-login:${email}`,
      limit: 8,
      windowMs: 1000 * 60 * 15
    }) ||
    !checkRateLimit(req, res, {
      scope: 'auth-login-ip',
      limit: 60,
      windowMs: 1000 * 60 * 15
    })
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.failed',
      targetUserId: user.id,
      details: { reason: 'invalid_password', email: user.email }
    });
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (isUserDisabled(user)) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.disabled',
      targetUserId: user.id,
      details: { email: user.email }
    });
    res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    return;
  }

  if (!user.emailVerifiedAt) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.email_unverified',
      targetUserId: user.id,
      details: { email: user.email }
    });
    try {
      const verification = await sendVerificationForUser(req, user);
      if (verification && !verification.delivery.sent) {
        res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
        return;
      }
    } catch (error) {
      console.error('Email verification resend failed:', error);
      res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
      return;
    }
    res.status(403).json({ error: 'Email verification required.' });
    return;
  }

  const token = createSessionToken();
  const csrfToken = createSessionToken();
  const secureCookies = shouldUseSecureCookies(req);
  store.markUserLoggedIn(user.id);
  store.createSession(user.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
  writeSecurityAuditLog(req, {
    action: 'auth.login.success',
    targetUserId: user.id,
    details: { email: user.email }
  });
  appendSetCookie(res, buildSessionCookie(token, secureCookies));
  res.json({ session: buildAuthSessionResponse(store.getUserById(user.id) ?? user, csrfToken) });
});

app.post('/api/auth/email-verification/confirm', (req, res) => {
  if (
    !checkRateLimit(req, res, {
      scope: 'auth-email-verify-confirm',
      limit: 20,
      windowMs: 1000 * 60 * 60
    })
  ) {
    return;
  }

  const parsed = emailVerificationConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const verificationToken = store.getEmailVerificationTokenByHash(hashSessionToken(parsed.data.token));
  if (!verificationToken) {
    res.status(400).json({ error: 'This verification link is invalid or expired.' });
    return;
  }

  const user = store.getUserById(verificationToken.userId);
  if (!user) {
    res.status(400).json({ error: 'This verification link is invalid or expired.' });
    return;
  }

  if (isUserDisabled(user)) {
    res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    return;
  }

  const verifiedUser = store.updateUser(user.id, (current) => ({
    ...current,
    emailVerifiedAt: current.emailVerifiedAt ?? new Date().toISOString()
  }));
  if (!verifiedUser) {
    res.status(400).json({ error: 'This verification link is invalid or expired.' });
    return;
  }

  store.markEmailVerificationTokenUsed(verificationToken.id);
  const token = createSessionToken();
  const csrfToken = createSessionToken();
  const secureCookies = shouldUseSecureCookies(req);
  store.markUserLoggedIn(verifiedUser.id);
  store.createSession(verifiedUser.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
  writeSecurityAuditLog(req, {
    action: 'auth.email.verify',
    targetUserId: verifiedUser.id,
    details: { email: verifiedUser.email }
  });
  appendSetCookie(res, buildSessionCookie(token, secureCookies));
  res.json({ session: buildAuthSessionResponse(store.getUserById(verifiedUser.id) ?? verifiedUser, csrfToken) });
});

app.post('/api/auth/email-verification/resend', async (req, res) => {
  const parsed = emailVerificationResendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !checkRateLimit(req, res, {
      scope: `auth-email-verify-resend:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    })
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (user && !isUserDisabled(user) && !user.emailVerifiedAt) {
    try {
      await sendVerificationForUser(req, user);
    } catch (error) {
      console.error('Email verification resend failed:', error);
    }
  }

  res.json({ ok: true });
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !checkRateLimit(req, res, {
      scope: `auth-password-reset:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    })
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (user && !isUserDisabled(user)) {
    const rawToken = createSessionToken();
    const resetToken = store.createPasswordResetToken(user.id, hashSessionToken(rawToken), PASSWORD_RESET_TTL_MS);
    writeSecurityAuditLog(req, {
      action: 'auth.password_reset.request',
      targetUserId: user.id,
      details: { email: user.email }
    });
    try {
      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.displayName,
        resetUrl: buildPasswordResetUrl(req, rawToken),
        expiresAt: resetToken.expiresAt
      });
    } catch (error) {
      console.error('Password reset email failed:', error);
    }
  }

  res.json({ ok: true });
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  if (
    !checkRateLimit(req, res, {
      scope: 'auth-password-reset-confirm',
      limit: 20,
      windowMs: 1000 * 60 * 60
    })
  ) {
    return;
  }

  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const resetToken = store.getPasswordResetTokenByHash(hashSessionToken(parsed.data.token));
  if (!resetToken) {
    res.status(400).json({ error: 'This reset link is invalid or expired.' });
    return;
  }

  const user = store.getUserById(resetToken.userId);
  if (!user) {
    res.status(400).json({ error: 'This reset link is invalid or expired.' });
    return;
  }

  if (isUserDisabled(user)) {
    res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    return;
  }

  const newPasswordHash = await hashPassword(parsed.data.password);
  const updatedUser = store.updateUser(user.id, (current) => ({
    ...current,
    emailVerifiedAt: current.emailVerifiedAt ?? new Date().toISOString(),
    passwordHash: newPasswordHash
  }));
  if (!updatedUser) {
    res.status(400).json({ error: 'This reset link is invalid or expired.' });
    return;
  }

  store.markPasswordResetTokenUsed(resetToken.id);
  store.deleteSessionsForUser(user.id);
  writeSecurityAuditLog(req, {
    action: 'auth.password_reset.confirm',
    targetUserId: user.id,
    details: { email: user.email }
  });
  appendSetCookie(res, clearSessionCookie(shouldUseSecureCookies(req)));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionToken = cookies[AUTH_COOKIE_NAME];
  const secureCookies = shouldUseSecureCookies(req);
  if (sessionToken) {
    store.deleteSessionByTokenHash(hashSessionToken(sessionToken));
  }

  appendSetCookie(res, clearSessionCookie(secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_STATE_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_VERIFIER_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_RETURN_COOKIE_NAME, secureCookies));
  res.json({ ok: true });
});

app.get('/api/auth/google/start', (req, res) => {
  const returnTo = sanitizeReturnTo(String(req.query.returnTo ?? '/'));
  const secureCookies = shouldUseSecureCookies(req);
  const config = resolveGoogleAuthConfig(buildGoogleRedirectUri(req));
  if (!config) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_not_configured'));
    return;
  }

  const state = createOAuthState();
  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  appendSetCookie(res, buildOAuthCookie(OAUTH_STATE_COOKIE_NAME, state, 600, secureCookies));
  appendSetCookie(res, buildOAuthCookie(OAUTH_VERIFIER_COOKIE_NAME, verifier, 600, secureCookies));
  appendSetCookie(res, buildOAuthCookie(OAUTH_RETURN_COOKIE_NAME, returnTo, 600, secureCookies));
  res.redirect(302, buildGoogleAuthUrl(config, state, challenge));
});

app.get('/api/auth/google/callback', async (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const returnTo = sanitizeReturnTo(cookies[OAUTH_RETURN_COOKIE_NAME] ?? '/');
  const secureCookies = shouldUseSecureCookies(req);
  appendSetCookie(res, clearCookie(OAUTH_STATE_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_VERIFIER_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_RETURN_COOKIE_NAME, secureCookies));

  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const storedState = cookies[OAUTH_STATE_COOKIE_NAME];
  const verifier = cookies[OAUTH_VERIFIER_COOKIE_NAME];
  const config = resolveGoogleAuthConfig(buildGoogleRedirectUri(req));

  if (!config) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_not_configured'));
    return;
  }

  if (!code || !state || !storedState || !verifier || state !== storedState) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_oauth_state_failed'));
    return;
  }

  try {
    const tokenSet = await exchangeGoogleCode(config, code, verifier);
    const profile = await fetchGoogleProfile(tokenSet.access_token);
    if (!profile.email) {
      res.redirect(302, addQueryParam(returnTo, 'authError', 'google_email_missing'));
      return;
    }
    if (profile.email_verified === false) {
      res.redirect(302, addQueryParam(returnTo, 'authError', 'google_email_unverified'));
      return;
    }

    const user = store.upsertGoogleUser({
      email: profile.email,
      displayName: profile.name ?? profile.email.split('@')[0] ?? 'Google User',
      googleSubject: profile.sub
    });
    if (isUserDisabled(user)) {
      writeSecurityAuditLog(req, {
        action: 'auth.google.disabled',
        targetUserId: user.id,
        details: { email: user.email }
      });
      res.redirect(302, addQueryParam(returnTo, 'authError', 'account_disabled'));
      return;
    }
    const token = createSessionToken();
    const csrfToken = createSessionToken();
    store.markUserLoggedIn(user.id);
    store.createSession(user.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
    writeSecurityAuditLog(req, {
      action: 'auth.google.success',
      targetUserId: user.id,
      details: { email: user.email }
    });
    appendSetCookie(res, buildSessionCookie(token, secureCookies));
    res.redirect(302, addQueryParam(returnTo, 'authProvider', 'google'));
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_oauth_failed'));
  }
});

app.get('/api/projects', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  res.json({
    items: store.listProjects(user.userKey).map((project) => buildPublicProject(project))
  });
});

app.get('/api/projects/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  respondWithProject(res, project);
});

app.post('/api/projects', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.createProject({
    userKey: user.userKey,
    userDisplayName: user.displayName,
    name: parsed.data.name,
    address: parsed.data.address
  });
  respondWithProject(res, project, 201);
});

app.patch('/api/projects/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (!store.getProjectForUser(String(req.params.id ?? ''), user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = patchProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.updateProject(String(req.params.id ?? ''), (current) => ({
    ...current,
    ...parsed.data
  }));
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  respondWithProject(res, project);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/preview', async (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const selectedExposure =
    hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0] ?? null;
  if (hdrItem.resultPath) {
    sendProtectedStorageFile(res, hdrItem.resultPath, hdrItem.resultKey);
    return;
  }

  let previewPath: string | null = null;
  if (selectedExposure) {
    previewPath = await ensureExposurePreviewFile(selectedExposure);
  }

  sendProtectedStorageFile(res, previewPath ?? selectedExposure?.storagePath ?? null, previewPath ? selectedExposure?.previewKey : selectedExposure?.storageKey);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/result', (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  sendProtectedStorageFile(res, hdrItem.resultPath, hdrItem.resultKey);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/exposures/:exposureId/preview', async (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const exposure = hdrItem.exposures.find((item) => item.id === String(req.params.exposureId ?? ''));
  if (!exposure) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const previewPath = await ensureExposurePreviewFile(exposure);
  sendProtectedStorageFile(res, previewPath ?? exposure.storagePath, previewPath ? exposure.previewKey : exposure.storageKey);
});

app.get('/api/projects/:id/results/:resultAssetId/file', (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const asset = owned.project.resultAssets.find((item) => item.id === String(req.params.resultAssetId ?? ''));
  if (!asset) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  sendProtectedStorageFile(res, asset.storagePath, asset.storageKey);
});

app.delete('/api/projects/:id', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  try {
    const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
    const cloudCleanup = project ? await deleteProjectObjectStorage(project) : null;
    const deletion = project ? store.deleteProject(project.id) : null;
    if (!deletion) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    res.json({
      ok: true,
      pendingCleanup: Boolean(deletion.archive?.pending),
      cloudCleanup: cloudCleanup
        ? {
            deleted: cloudCleanup.deleted,
            failed: cloudCleanup.failed.length
          }
        : null
    });
  } catch (error) {
    console.error('Project delete failed:', error);
    res.status(500).json({ error: '项目删除失败，请稍后再试。' });
  }
});

app.get('/api/projects/:id/download', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  try {
    const archive = await buildProjectDownloadArchive(project, getDefaultDownloadOptions());
    res.download(archive.zipPath, archive.downloadName);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, '下载生成失败，请稍后再试。') });
  }
});

app.post('/api/projects/:id/download', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = downloadRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const archive = await buildProjectDownloadArchive(project, {
      ...getDefaultDownloadOptions(),
      ...parsed.data
    });
    res.download(archive.zipPath, archive.downloadName);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, '下载生成失败，请稍后再试。') });
  }
});

app.post('/api/projects/:id/direct-upload/targets', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  try {
    assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: 'Direct upload is not configured.' });
    return;
  }

  const parsed = directUploadTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const targets = parsed.data.files.map((file) => {
      if (!isSupportedUploadFileName(file.originalName)) {
        throw new Error('Only RAW and JPG files are supported.');
      }

      return createDirectObjectUploadTarget({
        userKey: user.userKey,
        projectId,
        userDisplayName: project.userDisplayName,
        projectName: project.name,
        originalName: normalizeUploadedFileName(file.originalName),
        mimeType: file.mimeType,
        size: file.size
      });
    });

    res.json({ targets });
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Could not prepare direct upload.') });
  }
});

app.post('/api/projects/:id/direct-upload/complete', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  try {
    assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: 'Direct upload is not configured.' });
    return;
  }

  const parsed = directUploadCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const dirs = store.ensureProjectDirectories(project);
  const batchId = createUploadBatchId();
  const manifestEntries: Array<{
    originalName: string;
    mimeType: string;
    size: number;
    storageKey: string;
    localPath: string;
  } | null> = new Array(parsed.data.files.length).fill(null);

  try {
    const downloadInputs = parsed.data.files.map((file, index) => {
      if (!isSupportedUploadFileName(file.originalName)) {
        throw new Error('Only RAW and JPG files are supported.');
      }
      if (
        !isDirectUploadKeyForProject({
          userKey: user.userKey,
          projectId,
          userDisplayName: project.userDisplayName,
          projectName: project.name,
          storageKey: file.storageKey
        })
      ) {
        throw new Error('Direct upload key does not belong to this project.');
      }

      const destination = path.join(dirs.staging, batchId, String(index).padStart(4, '0'));
      const targetPath = path.join(destination, normalizeUploadedFileName(file.originalName));
      return {
        index,
        originalName: normalizeUploadedFileName(file.originalName),
        mimeType: file.mimeType,
        size: file.size,
        storageKey: file.storageKey,
        localPath: targetPath
      };
    });

    const shouldDownloadToLocalStaging = shouldStageDirectUploadObjectsLocally();
    if (shouldDownloadToLocalStaging) {
      await runWithConcurrency(downloadInputs, parseDirectUploadCompleteConcurrency(), async (file) => {
        await downloadDirectObjectToFile(file.storageKey, file.localPath);
        manifestEntries[file.index] = {
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          storageKey: file.storageKey,
          localPath: file.localPath
        };
      });
    } else {
      for (const file of downloadInputs) {
        fs.mkdirSync(path.dirname(file.localPath), { recursive: true });
        manifestEntries[file.index] = {
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          storageKey: file.storageKey,
          localPath: file.localPath
        };
      }
    }

    const manifestPath = path.join(dirs.staging, batchId, DIRECT_UPLOAD_MANIFEST_FILE);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          files: manifestEntries.filter((entry): entry is NonNullable<(typeof manifestEntries)[number]> => Boolean(entry))
        },
        null,
        2
      ),
      'utf8'
    );

    const updated = store.updateProject(projectId, (current) => ({
      ...current,
      status: 'uploading',
      currentStep: 3
    }));

    if (!updated) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    respondWithProject(res, updated);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Direct upload completion failed.') });
  }
});

app.post('/api/projects/:id/files', (req, res, next) => {
  if (!isLocalProxyUploadEnabled()) {
    res.status(409).json({ error: 'Cloud direct upload is required.' });
    return;
  }

  upload.array('files')(req, res, (error) => {
    if (error) {
      res.status(400).json({ error: getPublicErrorMessage(error, '上传失败，请重新选择照片。') });
      return;
    }
    next();
  });
}, async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const uploadedFiles = (req.files ?? []) as Express.Multer.File[];
  if (!uploadedFiles.length) {
    res.status(400).json({ error: 'No files uploaded.' });
    return;
  }

  store.updateProject(projectId, (current) => ({
    ...current,
    status: 'uploading',
    currentStep: 3
  }));

  const updated = store.getProjectForUser(projectId, user.userKey);
  if (!updated) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, updated);
});

app.post('/api/projects/:id/hdr-layout', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = hdrLayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const stagedFiles = store
      .listProjectStagedFiles(project)
      .filter((filePath) => path.basename(filePath) !== DIRECT_UPLOAD_MANIFEST_FILE);
    const hasFrontendExposureMetadata = parsed.data.hdrItems.some((item) => item.exposures?.length);
    if (!parsed.data.hdrItems.length && !(parsed.data.mode === 'merge' && parsed.data.inputComplete)) {
      res.status(400).json({ error: 'No HDR groups were provided.' });
      return;
    }
    if (parsed.data.hdrItems.length > 0 && !stagedFiles.length && !hasFrontendExposureMetadata) {
      res.status(400).json({ error: 'No uploaded photos are available to group.' });
      return;
    }

    const hdrItems = parsed.data.hdrItems.length
      ? await buildHdrItemsFromFrontendLayout(project, store, stagedFiles, parsed.data.hdrItems)
      : [];
    const updated =
      parsed.data.mode === 'merge'
        ? store.mergeHdrItems(projectId, hdrItems, { inputComplete: parsed.data.inputComplete })
        : store.replaceHdrItems(projectId, hdrItems, { inputComplete: parsed.data.inputComplete });
    if (!updated) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    respondWithProject(res, updated);
  } catch (error) {
    store.updateProject(projectId, (current) => ({
      ...current,
      status: 'failed'
    }));
    res.status(500).json({ error: getPublicErrorMessage(error) });
  }
});

app.post('/api/projects/:id/groups', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const project = store.createGroup(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, project, 201);
});

app.patch('/api/projects/:id/groups/:groupId', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = groupUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.updateGroup(projectId, String(req.params.groupId ?? ''), parsed.data);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, project);
});

app.patch('/api/projects/:id/hdr-items/:hdrItemId/select', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = exposureSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.setHdrExposureSelection(
    projectId,
    String(req.params.hdrItemId ?? ''),
    parsed.data.exposureId
  );
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, project);
});

app.post('/api/projects/:id/hdr-items/:hdrItemId/move', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = moveHdrSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.moveHdrItem(
    projectId,
    String(req.params.hdrItemId ?? ''),
    parsed.data.targetGroupId
  );
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, project);
});

app.delete('/api/projects/:id/hdr-items/:hdrItemId', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const currentProject = store.getProjectForUser(projectId, user.userKey);
  if (!currentProject) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const targetItem = currentProject.hdrItems.find((item) => item.id === String(req.params.hdrItemId ?? ''));
  if (targetItem) {
    const cleanup = await deleteObjectsFromStorage([
      targetItem.mergedKey,
      targetItem.resultKey,
      ...targetItem.exposures.flatMap((exposure) => [exposure.storageKey, exposure.previewKey])
    ]);
    if (cleanup.failed.length) {
      console.warn(`R2 cleanup skipped ${cleanup.failed.length} objects for HDR item ${targetItem.id}`, cleanup.failed);
    }
  }

  const project = store.deleteHdrItem(projectId, String(req.params.hdrItemId ?? ''));
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  respondWithProject(res, project);
});

app.post('/api/projects/:id/results/reorder', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = reorderResultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.reorderResultAssets(projectId, parsed.data.orderedHdrItemIds);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  respondWithProject(res, project);
});

app.post('/api/projects/:id/hdr-items/:hdrItemId/regenerate', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const parsed = regenerateResultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const project = await processor.regenerateResult(projectId, String(req.params.hdrItemId ?? ''), {
      colorCardNo: parsed.data.colorCardNo
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    writeSecurityAuditLog(req, {
      action: 'project.result.regenerate',
      targetUserId: user.id,
      targetProjectId: projectId,
      details: {
        hdrItemId: String(req.params.hdrItemId ?? ''),
        colorCardNo: parsed.data.colorCardNo
      }
    });

    respondWithProject(res, project);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, '重新生成失败，请稍后再试。') });
  }
});

app.post('/api/projects/:id/start', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const ownedProject = store.getProjectForUser(projectId, user.userKey);
  if (!ownedProject) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  try {
    if (!ownedProject.hdrItems.length) {
      res.status(400).json({ error: 'No uploaded photos are available to process yet.' });
      return;
    }

    const billingSummary = store.getBillingSummary(user.userKey);
    if (ownedProject.pointsEstimate > billingSummary.availablePoints) {
      res.status(402).json({
        error: `积分不足，当前余额 ${billingSummary.availablePoints}，至少需要 ${ownedProject.pointsEstimate}。请先充值。`
      });
      return;
    }

    await commitStagedOriginals(projectId);
    const reservation = store.reserveProjectProcessingCredits(projectId, POINT_PRICE_USD);
    if (!reservation.ok) {
      res.status(402).json({
        error:
          reservation.error ||
          `Insufficient credits. Current balance ${reservation.availablePoints}, required ${reservation.requiredPoints}.`
      });
      return;
    }

    writeSecurityAuditLog(req, {
      action: 'project.processing.reserve_credits',
      targetUserId: user.id,
      targetProjectId: projectId,
      details: {
        requiredPoints: reservation.requiredPoints,
        reservedEntryId: reservation.entry?.id ?? null
      }
    });

    const project = await processor.start(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    respondWithProject(res, project);
  } catch (error) {
    captureServerError(error, {
      event: 'project.start.failed',
      traceId: (req as express.Request & { traceId?: string }).traceId ?? null,
      userKey: user.userKey,
      projectId,
      phase: ownedProject.job?.phase ?? ownedProject.job?.status ?? null
    });
    res.status(500).json({ error: getPublicErrorMessage(error) });
  }
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  captureServerError(error, {
    event: 'request.unhandled_error',
    traceId: (req as express.Request & { traceId?: string }).traceId ?? null,
    phase: 'request',
    details: {
      method: req.method,
      path: req.path
    }
  });
  res.status(500).json({ error: '服务器暂时无法完成请求，请稍后再试。' });
});

if (fs.existsSync(clientIndexPath)) {
  app.use(
    express.static(clientDistRoot, {
      etag: true,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }

        const assetsRoot = `${path.join(clientDistRoot, 'assets')}${path.sep}`;
        if (filePath.startsWith(assetsRoot)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    })
  );
  app.get(/^(?!\/api(?:\/|$))(?!\/storage(?:\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(clientIndexPath);
  });
}

app.listen(port, () => {
  console.log(`Metrovan AI API listening on port ${port}`);

  void processor
    .recoverInterruptedProjects()
    .then((count) => {
      if (count > 0) {
        console.log(`Recovered ${count} interrupted project job(s).`);
      }
    })
    .catch((error) => {
      console.error('Failed to recover interrupted project jobs:', error);
    });
});
