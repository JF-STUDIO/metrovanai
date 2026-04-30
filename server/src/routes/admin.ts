import express from 'express';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { extractPreviewOrConvertToJpeg } from '../images.js';
import {
  createPersistentObjectKey,
  isObjectStorageConfigured,
  uploadFileToObjectStorage
} from '../object-storage.js';
import { captureServerError } from '../observability.js';
import { ensureDir, sanitizeSegment } from '../utils.js';
import type { RouteContext } from './context.js';

export function createAdminRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    adminActivationCodeCreateSchema,
    adminActivationCodeUpdateSchema,
    adminBillingAdjustmentSchema,
    adminDeleteUserConfirmSchema,
    adminRefundConfirmSchema,
    adminSystemSettingsSchema,
    adminUserUpdateSchema,
    buildAdminActivationCodePayload,
    buildAdminOpsHealthPayload,
    buildAdminUserRecord,
    buildAdminUserSummary,
    buildAdminWorkflowPayload,
    buildBillingPayload,
    buildDeploymentReadiness,
    buildPublicProject,
    checkRateLimit,
    deleteProjectObjectStorage,
    featureImageUpload,
    getEnabledStudioFeatures,
    getEffectiveUserRole,
    getFeatureImagePreviewPath,
    getStripeClient,
    isActivationCodeAvailable,
    isConfiguredAdminEmail,
    isStripeConfigured,
    listAllProjectsForAdmin,
    normalizeEmail,
    adminConfirmSchema,
    ADMIN_FEATURE_IMAGE_PREVIEW_DIR,
    ADMIN_FEATURE_IMAGE_ROOT,
    ADMIN_FEATURE_IMAGE_SOURCE_DIR,
    buildAbsoluteApiUrl,
    encodeStorageKeyForRoute,
    getTopUpPackages,
    parseAdminExpiresAt,
    processor,
    requireAdminApiAccess,
    sendPublicFeatureImageFile,
    store,
    syncStripeRefundToOrder,
    writeAdminAuditLog,
    getStripeObjectId
  } = ctx;

app.use('/api/admin', async (req, res, next) => {
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (
    !(await checkRateLimit(req, res, {
      scope: isMutation ? 'admin-api-write' : 'admin-api-read',
      limit: isMutation ? 120 : 600,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }
  next();
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

app.get('/api/admin/projects', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const limit = Math.max(1, Math.min(500, Math.round(Number(req.query.limit ?? 120))));
  const projects = listAllProjectsForAdmin();

  res.json({
    total: projects.length,
    items: projects.slice(0, limit).map((project: any) => buildPublicProject(project))
  });
});

app.get('/api/admin/ops/health', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json(buildAdminOpsHealthPayload());
});

app.post('/api/admin/projects/:id/recover-runninghub-results', async (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const projectId = String(req.params.id ?? '').trim();
  if (!projectId) {
    res.status(400).json({ error: 'Project id is required.' });
    return;
  }

  const summary = await processor.recoverRunningHubResults(projectId);
  writeAdminAuditLog(req, actor, {
    action: 'project.recover_runninghub_results',
    targetProjectId: projectId,
    details: { ...summary }
  });

  res.json({
    summary,
    project: store.getProject(projectId) ? buildPublicProject(store.getProject(projectId)!) : null
  });
});

app.get('/api/admin/orders', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const limit = Math.max(1, Math.min(500, Math.round(Number(req.query.limit ?? 120))));
  const orders = store.listPaymentOrders();

  res.json({
    total: orders.length,
    items: orders.slice(0, limit)
  });
});

app.get('/api/admin/orders/:id/refund-preview', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const orderId = String(req.params.id ?? '').trim();
  const order = orderId ? store.getPaymentOrderById(orderId) : null;
  if (!order) {
    res.status(404).json({ error: '找不到该订单。' });
    return;
  }
  if (!order.fulfilledAt || !order.billingEntryId || order.status !== 'paid') {
    res.status(409).json({ error: '只有已支付且未退款的订单可以退款。' });
    return;
  }

  const preview = store.getPaymentOrderRefundPreview(order.id);
  if (!preview) {
    res.status(404).json({ error: '找不到该订单。' });
    return;
  }

  res.json({ order, preview });
});

app.post('/api/admin/orders/:id/refund', async (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminRefundConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: 'Stripe is not configured.' });
    return;
  }

  const orderId = String(req.params.id ?? '').trim();
  const order = orderId ? store.getPaymentOrderById(orderId) : null;
  if (!order) {
    res.status(404).json({ error: '找不到该订单。' });
    return;
  }
  if (parsed.data.confirmOrderId !== order.id || normalizeEmail(parsed.data.confirmEmail) !== normalizeEmail(order.email)) {
    res.status(400).json({ error: '退款确认信息与订单不匹配。' });
    return;
  }
  if (!order.fulfilledAt || !order.billingEntryId || order.status !== 'paid') {
    res.status(409).json({ error: '只有已支付且未退款的订单可以退款。' });
    return;
  }
  if (!order.stripePaymentIntentId) {
    res.status(409).json({ error: '该订单缺少 Stripe payment intent，不能自动退款。' });
    return;
  }

  const preview = store.getPaymentOrderRefundPreview(order.id);
  if (!preview || preview.refundableAmountUsd <= 0 || preview.refundablePoints <= 0) {
    res.status(409).json({ error: '该订单没有可退金额或可扣回积分。' });
    return;
  }

  try {
    const refund = await getStripeClient().refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount: Math.round(preview.refundableAmountUsd * 100),
      reason: 'requested_by_customer',
      metadata: {
        metrovanOrderId: order.id,
        userId: order.userId,
        userKey: order.userKey
      }
    }, {
      idempotencyKey: `metrovan-refund-${order.id}`
    });

    if (refund.status !== 'succeeded') {
      writeAdminAuditLog(req, actor, {
        action: 'billing.stripe.refund_pending',
        targetUserId: order.userId,
        details: {
          orderId: order.id,
          stripeRefundId: refund.id,
          status: refund.status,
          refundAmountUsd: preview.refundableAmountUsd,
          refundPoints: preview.refundablePoints
        }
      });
      res.status(202).json({
        order,
        preview,
        refundStatus: refund.status,
        message: 'Stripe退款已提交，等待 Stripe 成功回调后再扣回积分。'
      });
      return;
    }

    const result = syncStripeRefundToOrder(req, order, {
      stripeRefundId: refund.id,
      refundAmountUsd: preview.refundableAmountUsd,
      source: 'admin'
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    writeAdminAuditLog(req, actor, {
      action: 'billing.stripe.refund',
      targetUserId: order.userId,
      details: {
        orderId: order.id,
        stripeRefundId: refund.id,
        refundAmountUsd: preview.refundableAmountUsd,
        refundPoints: preview.refundablePoints,
        balanceAfterRefund: preview.balanceAfterRefund
      }
    });

    res.json({
      order: result.order,
      preview,
      refundStatus: refund.status,
      billing: buildBillingPayload(order.userKey)
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Stripe refund failed.' });
  }
});

app.get('/api/admin/workflows', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json({
    workflows: buildAdminWorkflowPayload(),
    settings: store.getSystemSettings()
  });
});

app.post('/api/admin/studio-feature-image', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  featureImageUpload!.single('file')(req, res, async (error: unknown) => {
    if (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Feature image upload failed.' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '请上传图片文件。' });
      return;
    }

    const originalExtension = path.extname(file.originalname).toLowerCase() || '.jpg';
    const baseName = sanitizeSegment(path.basename(file.originalname, originalExtension)) || 'comparison';
    const sourceFileName = `${Date.now()}-${nanoid(8)}-${baseName}${originalExtension}`;
    const outputFileName = `${Date.now()}-${nanoid(8)}-${baseName}.jpg`;
    const sourceDir = path.join(store.getStorageRoot(), ADMIN_FEATURE_IMAGE_ROOT, ADMIN_FEATURE_IMAGE_SOURCE_DIR);
    const previewDir = path.join(store.getStorageRoot(), ADMIN_FEATURE_IMAGE_ROOT, ADMIN_FEATURE_IMAGE_PREVIEW_DIR);
    const sourcePath = path.join(sourceDir, sourceFileName);
    const previewPath = path.join(previewDir, outputFileName);

    try {
      ensureDir(sourceDir);
      ensureDir(previewDir);
      fs.writeFileSync(sourcePath, file.buffer);
      await extractPreviewOrConvertToJpeg(sourcePath, previewPath, 84, 1600);

      let routePath = `/api/studio/feature-images/local/${encodeURIComponent(outputFileName)}`;
      let storageKey: string | null = null;
      if (isObjectStorageConfigured()) {
        storageKey = createPersistentObjectKey({
          userKey: 'admin',
          userDisplayName: 'Admin',
          projectId: ADMIN_FEATURE_IMAGE_ROOT,
          projectName: 'Studio Feature Images',
          category: 'previews',
          fileName: outputFileName
        });
        await uploadFileToObjectStorage({
          sourcePath: previewPath,
          storageKey,
          contentType: 'image/jpeg'
        });
        routePath = `/api/studio/feature-images/object/${encodeStorageKeyForRoute(storageKey)}`;
      }

      writeAdminAuditLog(req, actor, {
        action: 'admin.studio_feature_image.upload',
        details: {
          fileName: outputFileName,
          storageKey,
          size: file.size
        }
      });

      res.json({
        url: buildAbsoluteApiUrl(req, routePath),
        fileName: outputFileName
      });
    } catch (uploadError) {
      captureServerError(uploadError, {
        event: 'admin.studio_feature_image.upload_failed',
        details: { fileName: file.originalname }
      });
      res.status(500).json({ error: uploadError instanceof Error ? uploadError.message : 'Feature image upload failed.' });
    }
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
    runpodHdrBatchSize: parsed.data.runpodHdrBatchSize,
    runningHubMaxInFlight: parsed.data.runningHubMaxInFlight ?? before.runningHubMaxInFlight,
    billingPackages: parsed.data.billingPackages ?? before.billingPackages,
    studioFeatures: parsed.data.studioFeatures ?? before.studioFeatures
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
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  writeAdminAuditLog(req, actor, {
    action: 'admin.user.view',
    targetUserId: user.id
  });

  res.json({
    user: buildAdminUserRecord(user),
    projects: store.listProjects(user.userKey).map((project: any) => buildPublicProject(project)),
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
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  res.json({
    user: buildAdminUserRecord(user),
    items: store.listProjects(user.userKey).map((project: any) => buildPublicProject(project))
  });
});

app.patch('/api/admin/users/:id', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  const parsed = adminUserUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (actor.actorUser?.id === user.id && parsed.data.accountStatus === 'disabled') {
    res.status(400).json({ error: '不能停用自己的管理员账号。' });
    return;
  }

  if (actor.actorUser?.id === user.id && parsed.data.role === 'user' && !isConfiguredAdminEmail(user.email)) {
    res.status(400).json({ error: '不能撤销自己的管理员权限。' });
    return;
  }

  const previous = buildAdminUserRecord(user);
  const updated = store.updateUser(user.id, (current) => ({
    ...current,
    role: parsed.data.role ?? current.role,
    accountStatus: parsed.data.accountStatus ?? current.accountStatus
  }));
  if (!updated) {
    res.status(404).json({ error: '找不到该用户。' });
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

  const parsed = adminDeleteUserConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  if (actor.actorUser?.id === user.id) {
    res.status(400).json({ error: '不能删除自己的管理员账号。' });
    return;
  }
  if (parsed.data.confirmUserId !== user.id || normalizeEmail(parsed.data.confirmEmail) !== normalizeEmail(user.email)) {
    res.status(400).json({ error: '删除确认信息与用户不匹配。' });
    return;
  }

  const userProjects = store.listProjects(user.userKey);
  const cloudCleanups = await Promise.all(userProjects.map((project: any) => deleteProjectObjectStorage(project)));
  const deletion = store.deleteUser(user.id);
  if (!deletion) {
    res.status(404).json({ error: '找不到该用户。' });
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
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  const parsed = adminBillingAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.confirmUserId !== user.id) {
    res.status(400).json({ error: '积分调整确认信息与用户不匹配。' });
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
    res.status(404).json({ error: '找不到该用户。' });
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
  const packages = getTopUpPackages();
  if (nextPackageId && !packages.some((item: any) => item.id === nextPackageId)) {
    res.status(404).json({ error: '该兑换码对应的充值档位不存在。' });
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
      packageName: created.packageId ? packages.find((pkg: any) => pkg.id === created.packageId)?.name ?? null : null
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
    res.status(404).json({ error: '找不到该兑换码。' });
    return;
  }

  const parsed = adminActivationCodeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const nextPackageId = parsed.data.packageId === undefined ? existing.packageId : parsed.data.packageId;
  const packages = getTopUpPackages();
  if (nextPackageId && !packages.some((item: any) => item.id === nextPackageId)) {
    res.status(404).json({ error: '该兑换码对应的充值档位不存在。' });
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
      packageName: updated.packageId ? packages.find((pkg: any) => pkg.id === updated.packageId)?.name ?? null : null
    }
  });
});

app.delete('/api/admin/activation-codes/:id', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const activationCodeId = String(req.params.id ?? '');
  const existing = store.getActivationCodeById(activationCodeId);
  if (!existing) {
    res.status(404).json({ error: '找不到该兑换码。' });
    return;
  }

  if (existing.redemptionCount > 0) {
    res.status(409).json({ error: '该兑换码已被使用，无法删除，请改为停用。' });
    return;
  }

  store.deleteActivationCode(activationCodeId);
  writeAdminAuditLog(req, actor, {
    action: 'admin.activation_code.delete',
    details: { activationCodeId: existing.id, code: existing.code }
  });

  res.json({ ok: true });
});

  return app;
}
