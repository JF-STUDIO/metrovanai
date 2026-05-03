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

function assertNotIncludes(relativePath, needle, message) {
  const source = readRepoFile(relativePath);
  if (source.includes(needle)) {
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

assertIncludes(
  'server/src/store.ts',
  'NEW_USER_TRIAL_CREDIT_POINTS = 3',
  'New accounts must receive exactly 3 trial credits.'
);

assertIncludes(
  'server/src/index.ts',
  'hashEmailVerificationCode(user.email, verificationCode)',
  'Email verification codes must be stored hashed, not in plaintext.'
);

assertIncludes(
  'server/src/routes/auth.ts',
  'sendVerificationForUser(req, user, { force: true })',
  'Unverified login must send a fresh code so users can verify without an old link.'
);

assertIncludes(
  'server/src/routes/auth.ts',
  'getEmailVerificationTokenRecordByHash(verificationTokenHash)',
  'Already-used verification links for verified accounts must remain idempotent.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "app.post('/api/admin/users/:id/allow-access'",
  'Admin must be able to manually allow access for verified-support recovery.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "action: 'admin.user.allow_access'",
  'Manual user access recovery must be audited.'
);

assertIncludes(
  'client/src/App.tsx',
  '账号实时状态',
  'Admin user detail must expose live account diagnostics.'
);

assertIncludes(
  'client/src/App.tsx',
  '<option value="verified">已验证</option>',
  'Admin verified-user filter must use the backend verified value.'
);

assertIncludes(
  'client/src/studio-features.ts',
  'normalizeStudioFeatureDraft(feature)',
  'Studio feature cards must be normalized before admin preview/rendering.'
);

assertIncludes(
  'client/src/App.tsx',
  "String(feature.workflowId ?? '').trim()",
  'Admin feature workflow display must tolerate legacy cards with missing workflow ids.'
);

assertIncludes(
  'client/src/App.tsx',
  'const isOpen = event.currentTarget.open;',
  'Admin feature card toggle must capture the details open state before the React event is released.'
);

assertNotIncludes(
  'client/src/App.tsx',
  '[feature.id]: event.currentTarget.open',
  'Admin feature card toggle must not read currentTarget inside a state updater.'
);

assertIncludes(
  'client/src/api.ts',
  'isCsrfVerificationError(error)',
  'API requests must detect stale CSRF failures.'
);

assertIncludes(
  'client/src/api.ts',
  "await refreshCsrfToken();",
  'API requests must refresh the CSRF token before retrying a stale-token mutation.'
);

assertIncludes(
  'client/src/api.ts',
  "return await jsonRequest<T>(requestPath, init, { retryCsrf: false });",
  'CSRF retry must only happen once per request.'
);

assertIncludes(
  'client/src/App.tsx',
  "feature.enabled ? '前台显示' : '前台隐藏'",
  'Admin feature cards must clearly show whether a saved card is visible on the frontend.'
);

assertIncludes(
  'client/src/App.tsx',
  '关闭时保存成功也不会在前台显示',
  'Admin feature enable checkbox must explain that disabled cards are hidden from the frontend.'
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

assertMatches(
  'server/src/index.ts',
  /function shouldTrustStripeWebhookEventSession\(\) \{[\s\S]*isProductionRuntime\(\)[\s\S]*return false;/,
  'Stripe webhook event-session trust mode must stay disabled in production.'
);

assertIncludes(
  'client/src/api.ts',
  'const DIRECT_OBJECT_UPLOAD_SMALL_FILE_CONCURRENCY = 6;',
  'Direct upload should keep balanced browser concurrency for production RAW batches.'
);

assertIncludes(
  'client/src/api.ts',
  'const MAX_UPLOAD_BATCH_RETRIES = 5;',
  'Direct upload should tolerate transient browser/R2 upload failures.'
);

assertIncludes(
  'client/src/api.ts',
  'const CLIENT_DIRECT_UPLOAD_TARGET_MAX_FILES = 48;',
  'Direct upload should request signed upload targets in smaller browser-stable batches.'
);

assertIncludes(
  'client/src/api.ts',
  'ensurePreparedDirectTargets(batchIndex + 1)',
  'Direct upload should prefetch the next signed target batch while the current batch uploads.'
);

assertIncludes(
  'client/src/api.ts',
  'completeDirectObjectUploadReferencesInBatches',
  'Direct upload completion must verify large RAW projects in bounded batches.'
);

assertIncludes(
  'client/src/api.ts',
  "return {\n        directUploadFiles: completedObjects\n      };",
  'Partial upload failures must preserve local completed-object checkpoints without finalizing.'
);

assertIncludes(
  'client/src/App.tsx',
  "inputComplete: true",
  'Local upload flow must finalize layout only after all originals are uploaded.'
);

assertIncludes(
  'client/src/components/ReviewUploadStatus.tsx',
  'Retry all failed files',
  'Upload retry UI must support batch retry instead of one-file-only recovery.'
);

assertIncludes(
  'client/src/components/ProcessingStatusPanel.tsx',
  'Choose files to resume',
  'Upload recovery UI must let users reselect files after a browser refresh.'
);

assertIncludes(
  'client/src/App.tsx',
  'collectUploadedObjectReferencesFromProject',
  'Upload recovery must preserve already uploaded R2 objects when local draft state is rebuilt.'
);

assertIncludes(
  'client/src/api.ts',
  'const MULTIPART_UPLOAD_THRESHOLD_BYTES = 512 * 1024 * 1024;',
  'Typical RAW photo uploads should stay on stable single-object PUT uploads.'
);

assertIncludes(
  'server/src/index.ts',
  'METROVAN_DIRECT_UPLOAD_COMPLETE_CONCURRENCY ?? 12',
  'Direct upload completion should verify R2 objects with practical concurrency.'
);

assertIncludes(
  'client/src/api.ts',
  "type: 'upload.performance'",
  'Upload performance diagnostics must stay emitted for speed investigations.'
);

assertIncludes(
  'server/src/downloads.ts',
  'isDownloadAssetFileComplete',
  'Project downloads must validate result file integrity before packaging.'
);

assertIncludes(
  'server/src/downloads.ts',
  'end[0] === 0xff && end[1] === 0xd9',
  'Project downloads must reject truncated JPEG results before packaging.'
);

assertIncludes(
  'server/src/downloads.ts',
  "diagnostic.includes('premature')",
  'Project downloads must decode-check JPEGs for premature/corrupt image data.'
);

assertIncludes(
  'server/src/download-jobs.ts',
  'getProjectDownloadFingerprint',
  'Download job reuse must include a project result fingerprint.'
);

assertIncludes(
  'server/src/routes/projects.ts',
  'validateHdrLayoutForProcessing',
  'Backend HDR layout submission must validate groups before processing.'
);

assertIncludes(
  'server/src/routes/projects.ts',
  '同时包含 RAW 和同名 JPG 副本',
  'Backend HDR validation must reject RAW/JPG sidecar duplicates.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'adminHealth: buildAdminProjectHealth(project)',
  'Admin project payloads must expose project health diagnostics.'
);

assertIncludes(
  'client/src/App.tsx',
  '项目健康检查',
  'Admin works view must surface project health diagnostics.'
);

assertNotIncludes(
  'client/src/App.tsx',
  'slice(0, 32)',
  'Admin works view must not hide projects behind a hard 32-item display cap.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'pageSize',
  'Admin projects endpoint must support paginated loading for all user works.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  '/api/admin/projects/:id/deep-health',
  'Admin must provide an on-demand project deep health check endpoint.'
);

assertIncludes(
  'client/src/App.tsx',
  '深度巡检',
  'Admin project detail must expose an on-demand deep health check button.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  '/api/admin/projects/:id/repair',
  'Admin must provide a project repair endpoint for diagnosed issues.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "action: 'project.repair.retry_failed_processing'",
  'Admin repair retries must be audited.'
);

assertIncludes(
  'server/src/processor.ts',
  'WORKFLOW_ITEM_AUTO_RETRY_ATTEMPTS',
  'Transient cloud processing failures must be retried automatically before marking a photo failed.'
);

assertIncludes(
  'server/src/processor.ts',
  'METROVAN_WORKFLOW_ITEM_AUTO_RETRY_ATTEMPTS ?? 2',
  'Processing should run once, automatically retry once on failure, then mark the item failed.'
);

assertIncludes(
  'server/src/processor.ts',
  '自动重试后仍失败',
  'Final processing errors should explain when automatic retry was exhausted.'
);

assertIncludes(
  'server/src/index.ts',
  'persistOriginalStorageKey',
  'Uploaded originals must be copied from incoming storage into persistent project storage before processing.'
);

assertIncludes(
  'server/src/object-storage.ts',
  'x-amz-copy-source',
  'Object storage must support server-side copies for long-lived original backups.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  "action: 'project.repair.regenerate_download'",
  'Admin download regeneration repairs must be audited.'
);

assertIncludes(
  'client/src/App.tsx',
  '重新生成下载包',
  'Admin project detail must expose a download regeneration repair action.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'rootCauseSummary',
  'Admin project health must include a root-cause summary.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  'recommendedActions',
  'Admin project health must include recommended repair actions.'
);

assertIncludes(
  'client/src/App.tsx',
  '诊断建议',
  'Admin project detail must surface root-cause diagnosis recommendations.'
);

assertIncludes(
  'client/src/App.tsx',
  '待处理队列',
  'Admin works view must surface a prioritized issue queue.'
);

assertIncludes(
  'client/src/App.tsx',
  'adminPriorityProjects',
  'Admin works view must compute prioritized projects from health diagnostics.'
);

assertIncludes(
  'scripts/maintenance-check.mjs',
  'checkApplicationData',
  'Maintenance automation must inspect production application data.'
);

assertIncludes(
  'scripts/maintenance-check.mjs',
  'sendMaintenanceAlert',
  'Maintenance automation must notify when checks fail.'
);

assertIncludes(
  'scripts/maintenance-check.mjs',
  'buildApplicationPriorityQueue',
  'Maintenance automation must compute prioritized project issues.'
);

assertIncludes(
  'scripts/maintenance-check.mjs',
  'Top project issues:',
  'Maintenance alert email must include prioritized project issues.'
);

assertIncludes(
  'scripts/maintenance-check.mjs',
  'recommendedActionLabels',
  'Maintenance report must include human-readable recommended actions.'
);

assertIncludes(
  'server/src/routes/admin.ts',
  '/api/admin/maintenance/reports',
  'Admin must provide a maintenance report history endpoint.'
);

assertIncludes(
  'client/src/App.tsx',
  '维护报告',
  'Admin console must expose a maintenance report history page.'
);

assertIncludes(
  'client/src/api.ts',
  'fetchAdminMaintenanceReports',
  'Client API must fetch admin maintenance reports.'
);

assertIncludes(
  'client/src/App.tsx',
  'confirmCheckoutSessionWithRetry',
  'Stripe return flow must retry checkout confirmation while payment settlement catches up.'
);

assertIncludes(
  'client/src/components/BillingPanel.tsx',
  'copy.topUpRedirecting',
  'Recharge button must show a Stripe redirect state while checkout is being created.'
);

assertIncludes(
  'client/src/App.tsx',
  'openRechargeForInsufficientCredits',
  'Project processing must open recharge before upload when credits are insufficient.'
);

assertIncludes(
  'client/src/App.tsx',
  'STRIPE_RETURN_PROJECT_STORAGE_KEY',
  'Stripe checkout return flow must preserve the active project context.'
);

assertIncludes(
  'client/src/app-utils.ts',
  "if (normalized === '/billing' || normalized === '/账单') return 'billing';",
  'Billing must be available as a first-class route.'
);

assertIncludes(
  'client/src/pages/BillingPage.tsx',
  '积分使用情况',
  'Billing page must split credit usage from recharge records.'
);

assertIncludes(
  'client/src/pages/BillingPage.tsx',
  'renderStripeInvoiceLink(order, copy)',
  'Billing page must expose recharge records with a single Stripe invoice link.'
);

assertIncludes(
  'server/src/store.ts',
  'totalChargedPoints: totalProjectChargedPoints',
  'Billing summary charged total must exclude manual admin adjustments.'
);

assertIncludes(
  'client/src/pages/BillingPage.tsx',
  "entry.type === 'charge' && !isAdminBillingAdjustmentEntry(entry)",
  'Billing usage list must show project charges instead of manual admin adjustments.'
);

assertIncludes(
  'client/src/pages/BillingPage.tsx',
  '每次充值金额和 Invoice。',
  'Billing page must keep recharge records concise with Stripe invoice links.'
);

assertIncludes(
  'client/src/app-utils.ts',
  'ignoredRawSidecars',
  'Import filtering must report matching JPG sidecars that were ignored.'
);

assertIncludes(
  'client/src/App.tsx',
  'copy.uploadRawSidecarFiles(ignoredRawSidecars.length)',
  'Upload UI must tell users when matching JPG sidecars are ignored.'
);

assertIncludes(
  'client/src/local-import.ts',
  'isJpegFile(file.name) && rawFileKeys.has(getRawSidecarKey(file))',
  'Local import must prefer RAW originals over same-name JPG sidecars before grouping.'
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
  'client/src/App.tsx',
  'handleDeleteAdminFeatureCard',
  'Admin content operations must allow removing feature cards.'
);

assertIncludes(
  'client/src/App.tsx',
  'feature-admin-preview',
  'Admin content operations must preview feature cards before saving.'
);

assertIncludes(
  'client/src/App.tsx',
  'handleMoveAdminFeatureCard',
  'Admin content operations must allow ordering feature cards.'
);

assertIncludes(
  'client/src/App.tsx',
  'studioFeatures: adminFeatureDrafts',
  'Admin content saves must preserve the exact edited feature card list.'
);

assertNotIncludes(
  'server/src/studio-features.ts',
  'normalized.push(normalizeStudioFeature(feature, feature))',
  'Deleted studio feature cards must not be silently restored by defaults.'
);

assertIncludes(
  'client/src/landing-copy.ts',
  'landingTrustBilling',
  'Landing page must surface pricing trust text in the hero.'
);

console.log('Regression checks passed.');
