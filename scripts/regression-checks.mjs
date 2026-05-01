import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(relativePath, needle, message) {
  const source = readRepoFile(relativePath);
  if (!source.includes(needle)) {
    throw new Error(`${message} (${relativePath})`);
  }
}

function assertMatches(relativePath, pattern, message) {
  const source = readRepoFile(relativePath);
  if (!pattern.test(source)) {
    throw new Error(`${message} (${relativePath})`);
  }
}

assertIncludes(
  'client/src/demo-mode.ts',
  "import.meta.env.VITE_METROVAN_ENABLE_DEMO === 'true'",
  'Demo mode must stay gated outside normal production builds.'
);

assertIncludes(
  'server/src/runtime-config.ts',
  'METROVAN_DIRECT_UPLOAD_ENABLED=true',
  'Production runtime must require direct object upload.'
);

assertIncludes(
  'server/src/rate-limit.ts',
  'export function createRateLimiter()',
  'Rate limit infrastructure must stay isolated from the main route file.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'idempotencyKey: `metrovan-refund-${order.id}`',
  'Admin Stripe refunds must use an idempotency key.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'adminRefundConfirmSchema',
  'Admin Stripe refunds must require a server-side confirmation payload.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'confirmOrderId',
  'Admin Stripe refund confirmation must include the order id.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'adminDeleteUserConfirmSchema',
  'Admin user deletion must require explicit server-side user confirmation.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'confirmUserId',
  'Admin destructive user actions must include the target user id.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'normalizeEmail(parsed.data.confirmEmail) !== normalizeEmail(user.email)',
  'Admin user deletion must match the confirmed email to the target user.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'adminBillingAdjustmentSchema.safeParse',
  'Admin billing adjustments must validate a confirmation payload.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'parsed.data.confirmUserId !== user.id',
  'Admin billing adjustments must match the confirmed target user id.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'adminConfirmSchema.safeParse',
  'Admin force logout must validate a confirmation payload.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "action: 'admin.billing.adjust'",
  'Admin billing adjustments must be audited.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "action: 'admin.user.logout'",
  'Admin force logout must be audited.'
);

for (const routeFile of [
  'server/src/routes/auth.ts',
  'server/src/routes/billing.ts',
  'server/src/routes/admin.ts',
  'server/src/routes/projects.ts',
  'server/src/routes/project-downloads.ts',
  'server/src/routes/project-results.ts',
  'server/src/routes/project-uploads.ts'
]) {
  assertIncludes(routeFile, 'express.Router()', `Route module must own an Express router: ${routeFile}`);
}

assertIncludes(
  'server/src/csrf.ts',
  "if (req.path === '/api/stripe/webhook')",
  'Stripe webhook must remain excluded from JSON CSRF middleware.'
);

assertIncludes(
  'server/src/csrf.ts',
  'timingSafeEqual',
  'CSRF hash comparison must use a timing-safe comparison.'
);

assertMatches(
  'server/src/index.ts',
  /app\.use\(\(req, res, next\) => \{[\s\S]*requireValidCsrf\(req, res, auth\)/,
  'Authenticated API mutations must stay protected by the CSRF middleware.'
);

assertIncludes(
  'server/src/auth.ts',
  "'SameSite=Lax'",
  'Session cookies must keep SameSite protection.'
);

assertIncludes(
  'client/src/pages/LandingPage.tsx',
  "scrollToHomeSection('examples')",
  'Landing page must keep a low-friction examples CTA.'
);

assertIncludes(
  'client/src/landing-copy.ts',
  'landingTrustBilling',
  'Landing page must surface pricing trust text in the hero.'
);

console.log('Regression checks passed.');
