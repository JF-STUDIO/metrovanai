import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(relativePath, needle, message) {
  const source = read(relativePath);
  if (!source.includes(needle)) {
    throw new Error(`${message} (${relativePath})`);
  }
}

function assertMatches(relativePath, pattern, message) {
  const source = read(relativePath);
  if (!pattern.test(source)) {
    throw new Error(`${message} (${relativePath})`);
  }
}

const routeContracts = [
  {
    file: 'server/src/routes/auth.ts',
    checks: [
      ['app.post(\'/api/auth/register\'', 'Auth registration route must exist.'],
      ['scope: `auth-register:${email}`', 'Registration must keep per-email rate limiting.'],
      ['verificationRequired: true', 'Registration must require email verification.'],
      ['app.post(\'/api/auth/login\'', 'Auth login route must exist.'],
      ['scope: `auth-login:${email}`', 'Login must keep per-email rate limiting.'],
      ['if (!user.emailVerifiedAt)', 'Login must reject unverified users.'],
      ['csrfToken', 'Successful login must return a CSRF token.'],
      ['app.post(\'/api/auth/password-reset/request\'', 'Password reset request route must exist.'],
      ['app.post(\'/api/auth/password-reset/confirm\'', 'Password reset confirm route must exist.']
    ]
  },
  {
    file: 'server/src/routes/billing.ts',
    checks: [
      ['app.post(\'/api/billing/checkout\'', 'Stripe checkout route must exist.'],
      ['scope: \'billing-checkout\'', 'Checkout must keep user rate limiting.'],
      ['if (!isStripeConfigured())', 'Checkout must reject when Stripe is not configured.'],
      ['createStripeCheckoutSession', 'Checkout must create a Stripe session.'],
      ['app.post(\'/api/billing/checkout/confirm\'', 'Checkout confirm route must exist.'],
      ['settlePaidStripeCheckoutSession', 'Checkout confirm must settle paid sessions through the shared settlement helper.'],
      ['app.post(\'/api/billing/activation-code/redeem\'', 'Activation code redeem route must exist.'],
      ['store.hasUserRedeemedActivationCode', 'Activation code redemption must be idempotent per user.']
    ]
  },
  {
    file: 'server/src/routes/project-uploads.ts',
    checks: [
      ['app.post(\'/api/projects/:id/uploads/multipart/init\'', 'Multipart init route must exist.'],
      ['scope: \'multipart-upload-init\'', 'Multipart init must keep user rate limiting.'],
      ['multipartUploadInitSchema.safeParse', 'Multipart init must validate request body.'],
      ['checkDirectUploadTargetLimits', 'Direct upload must enforce target limits.'],
      ['isSupportedUploadFileName', 'Direct upload must enforce supported file types.'],
      ['app.post(\'/api/projects/:id/uploads/multipart/complete\'', 'Multipart complete route must exist.'],
      ['completeMultipartObjectUpload', 'Multipart complete must finalize object storage upload.'],
      ['assertDirectUploadObjectReady', 'Upload completion must verify uploaded objects.'],
      ['respondWithProject', 'Upload completion must return the updated project.']
    ]
  },
  {
    file: 'server/src/routes/project-downloads.ts',
    checks: [
      ['app.post(\'/api/projects/:id/download/jobs\'', 'Download job route must exist.'],
      ['scope: \'project-download\'', 'Downloads must keep user rate limiting.'],
      ['downloadRequestSchema.safeParse', 'Download requests must validate options.'],
      ['assertProjectDownloadAssetsReady', 'Downloads must verify assets are ready.'],
      ['DownloadIncompleteError', 'Downloads must expose incomplete-asset failures safely.'],
      ['cancelDownloadJob', 'Download jobs must remain cancellable.']
    ]
  },
  {
    file: 'server/src/routes/admin.ts',
    checks: [
      ['app.post(\'/api/admin/orders/:id/refund\'', 'Admin refund route must exist.'],
      ['adminRefundConfirmSchema.safeParse', 'Admin refunds must validate confirmation body.'],
      ['confirmOrderId', 'Admin refunds must require order id confirmation.'],
      ['confirmEmail', 'Admin refunds must require email confirmation.'],
      ['idempotencyKey: `metrovan-refund-${order.id}`', 'Stripe refunds must keep idempotency keys.'],
      ['writeAdminAuditLog', 'Admin refund actions must be audited.'],
      ['app.delete(\'/api/admin/users/:id\'', 'Admin user delete route must exist.'],
      ['adminDeleteUserConfirmSchema.safeParse', 'Admin user delete must validate confirmation body.']
    ]
  }
];

for (const contract of routeContracts) {
  for (const [needle, message] of contract.checks) {
    assertIncludes(contract.file, needle, message);
  }
}

assertMatches(
  'server/src/index.ts',
  /app\.post\('\/api\/stripe\/webhook', express\.raw\(\{ type: 'application\/json' \}\)[\s\S]*constructStripeWebhookEvent[\s\S]*checkout\.session\.completed[\s\S]*settlePaidStripeCheckoutSession/,
  'Stripe webhook must use raw body signature verification and shared checkout settlement.'
);

assertIncludes(
  'server/src/csrf.ts',
  "if (req.path === '/api/stripe/webhook')",
  'Stripe webhook must stay exempt from JSON CSRF middleware so signature verification receives the raw body.'
);

assertIncludes(
  'server/src/middleware/security-headers.ts',
  'METROVAN_STRICT_CSP',
  'CSP must expose a strict mode for removing style-src unsafe-inline after inline styles are migrated.'
);

assertIncludes(
  'scripts/smoke-auth-billing.mjs',
  'stripe_checkout_webhook_credit_idempotent',
  'Auth/billing smoke test must keep Stripe webhook idempotency coverage.'
);

assertIncludes(
  'scripts/smoke-auth-billing.mjs',
  'project_start_without_photos_rejected_before_charge',
  'Auth/billing smoke test must keep no-photo processing charge protection coverage.'
);

console.log('Critical flow contract checks passed.');
