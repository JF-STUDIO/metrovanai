import express from 'express';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { extractPreviewOrConvertToJpeg } from '../images.js';
import {
  createPersistentObjectKey,
  getObjectStorageMetadata,
  isObjectStorageConfigured,
  uploadFileToObjectStorage
} from '../object-storage.js';
import { captureServerError } from '../observability.js';
import { ensureDir, sanitizeSegment } from '../utils.js';
import type { RouteContext } from './context.js';
import type { BillingEntry, ProjectRecord, ProjectDownloadJobRecord, UserRecord } from '../types.js';
import { POINT_PRICE_USD } from '../billing-packages.js';

export function createAdminRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    adminActivationCodeCreateSchema,
    adminActivationCodeUpdateSchema,
    adminBillingAdjustmentSchema,
    adminDeleteUserConfirmSchema,
    adminRefundConfirmSchema,
    adminSystemSettingsSchema,
    adminUserAllowAccessSchema,
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
    enqueueDownloadJob,
    featureImageUpload,
    getDefaultDownloadOptions,
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
    requireAdminReadinessAccess,
    sendPublicFeatureImageFile,
    store,
    syncStripeRefundToOrder,
    writeAdminAuditLog,
    getStripeObjectId
  } = ctx;

  function getStudioFeaturePublishIssues(feature: {
    id: string;
    enabled: boolean;
    titleZh: string;
    titleEn: string;
    descriptionZh: string;
    descriptionEn: string;
    beforeImageUrl: string;
    afterImageUrl: string;
    workflowId: string;
    inputNodeId: string;
    outputNodeId: string;
    pointsPerPhoto: number;
  }) {
    const workflows = buildAdminWorkflowPayload();
    const workflowItems = workflows.items as Array<{
      name: string;
      workflowId?: string | null;
      inputNodeIds?: string[];
      outputNodeIds?: string[];
    }>;
    const configuredWorkflowId = feature.workflowId.trim();
    const matched = configuredWorkflowId
      ? workflowItems.find((item) => item.workflowId === configuredWorkflowId) ?? null
      : null;
    const activeName = workflows.active?.trim().toLowerCase();
    const active = activeName
      ? workflowItems.find((item) => item.name.trim().toLowerCase() === activeName) ?? null
      : null;
    const defaultWorkflow = workflowItems.find((item) => item.workflowId) ?? null;
    const shouldUseDefaultWorkflow = feature.id === 'hdr-true-color' || feature.id === 'hdr-white-wall';
    const fallback = matched ?? (shouldUseDefaultWorkflow ? active ?? defaultWorkflow : null);
    const workflowId = configuredWorkflowId || fallback?.workflowId || '';
    const inputNodeId = feature.inputNodeId.trim() || fallback?.inputNodeIds?.join(', ') || '';
    const outputNodeId = feature.outputNodeId.trim() || fallback?.outputNodeIds?.join(', ') || '';
    const issues: string[] = [];
    if (!feature.titleZh.trim() || !feature.titleEn.trim()) issues.push('中英文名称');
    if (!feature.descriptionZh.trim() || !feature.descriptionEn.trim()) issues.push('中英文描述');
    if (!feature.beforeImageUrl.trim() || !feature.afterImageUrl.trim()) issues.push('Before / After 对比图');
    if (!workflowId.trim()) issues.push('Workflow ID');
    if (!inputNodeId.trim()) issues.push('输入节点');
    if (!outputNodeId.trim()) issues.push('输出节点');
    if (!Number.isFinite(feature.pointsPerPhoto) || feature.pointsPerPhoto <= 0) issues.push('每张积分');
    return issues;
  }

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

app.get('/api/admin/billing-ledger', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const search = String(req.query.search ?? '').trim().toLowerCase();
  const type = String(req.query.type ?? 'all');
  const page = Math.max(1, Math.round(Number(req.query.page ?? 1)));
  const pageSize = Math.max(1, Math.min(5000, Math.round(Number(req.query.pageSize ?? 50))));
  const startDate = String(req.query.startDate ?? '').trim();
  const endDate = String(req.query.endDate ?? '').trim();
  const startTime = startDate ? Date.parse(`${startDate}T00:00:00.000Z`) : null;
  const endTime = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : null;
  const usersByKey = new Map<string, UserRecord>(store.listUsers().map((user: UserRecord) => [user.userKey, user]));
  const allEntries = store
    .listUsers()
    .flatMap((user: UserRecord) =>
      store.listBillingEntries(user.userKey).map((entry: BillingEntry) => ({
        ...entry,
        userId: user.id,
        userEmail: user.email,
        userDisplayName: user.displayName
      }))
    )
    .filter((entry: BillingEntry & { userId: string; userEmail: string; userDisplayName: string }) => {
      const createdTime = Date.parse(entry.createdAt);
      if (Number.isFinite(startTime) && Number.isFinite(createdTime) && createdTime < startTime!) return false;
      if (Number.isFinite(endTime) && Number.isFinite(createdTime) && createdTime > endTime!) return false;
      if (type === 'charge' || type === 'credit') {
        if (entry.type !== type) return false;
      }
      if (!search) return true;
      const user = usersByKey.get(entry.userKey);
      const haystack = [
        user?.email,
        user?.displayName,
        user?.userKey,
        entry.userEmail,
        entry.userDisplayName,
        entry.projectName,
        entry.note,
        entry.activationCode,
        entry.activationCodeLabel
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const total = allEntries.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const offset = (normalizedPage - 1) * pageSize;

  res.json({
    total,
    page: normalizedPage,
    pageSize,
    pageCount,
    totals: {
      chargePoints: allEntries.filter((entry) => entry.type === 'charge').reduce((sum, entry) => sum + entry.points, 0),
      creditPoints: allEntries.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.points, 0),
      amountUsd: Number(allEntries.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.amountUsd, 0).toFixed(2))
    },
    items: allEntries.slice(offset, offset + pageSize)
  });
});

app.get('/api/admin/project-costs', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const runningHubUnitCostUsd = 0.07;
  const projects = listAllProjectsForAdmin();
  type AdminProjectCostRow = {
    projectId: string;
    projectName: string;
    userKey: string;
    userDisplayName: string;
    status: ProjectRecord['status'];
    photoCount: number;
    resultCount: number;
    chargedPoints: number;
    refundedPoints: number;
    netPoints: number;
    revenueUsd: number;
    listRevenueUsd: number;
    cashRevenueUsd: number;
    blendedPointPriceUsd: number;
    runningHubRuns: number;
    workflowRuns: number;
    regenerationRuns: number;
    runningHubCostUsd: number;
    profitUsd: number;
    updatedAt: string;
  };
  type AdminProjectCostTotals = {
    projects: number;
    revenueUsd: number;
    listRevenueUsd: number;
    cashRevenueUsd: number;
    runningHubRuns: number;
    runningHubCostUsd: number;
    profitUsd: number;
    netPoints: number;
  };
  const userBillingCache = new Map<string, BillingEntry[]>();
  const userPointValueCache = new Map<string, number>();

  const getUserBillingEntries = (userKey: string) => {
    const cached = userBillingCache.get(userKey);
    if (cached) {
      return cached;
    }
    const entries = store.listBillingEntries(userKey);
    userBillingCache.set(userKey, entries);
    return entries;
  };

  const getUserBlendedPointPriceUsd = (userKey: string) => {
    const cached = userPointValueCache.get(userKey);
    if (typeof cached === 'number') {
      return cached;
    }
    const entries = getUserBillingEntries(userKey).filter((entry) => !entry.projectId && entry.amountUsd > 0);
    const paid = entries.reduce(
      (sum, entry) => {
        const sign = entry.type === 'credit' ? 1 : -1;
        return {
          points: sum.points + sign * entry.points,
          amountUsd: sum.amountUsd + sign * entry.amountUsd
        };
      },
      { points: 0, amountUsd: 0 }
    );
    const pointPrice =
      paid.points > 0 && paid.amountUsd > 0
        ? Number((paid.amountUsd / paid.points).toFixed(4))
        : POINT_PRICE_USD;
    userPointValueCache.set(userKey, pointPrice);
    return pointPrice;
  };

  const rows: AdminProjectCostRow[] = projects.map((project: ProjectRecord) => {
    const projectEntries = getUserBillingEntries(project.userKey).filter(
      (entry: BillingEntry) => entry.projectId === project.id
    );
    const listRevenueUsd = Number(
      projectEntries
        .reduce((sum, entry) => sum + (entry.type === 'charge' ? entry.amountUsd : -entry.amountUsd), 0)
        .toFixed(2)
    );
    const chargedPoints = projectEntries
      .filter((entry: BillingEntry) => entry.type === 'charge')
      .reduce((sum, entry) => sum + entry.points, 0);
    const refundedPoints = projectEntries
      .filter((entry: BillingEntry) => entry.type === 'credit')
      .reduce((sum, entry) => sum + entry.points, 0);
    const netPoints = chargedPoints - refundedPoints;
    const blendedPointPriceUsd = getUserBlendedPointPriceUsd(project.userKey);
    const cashRevenueUsd = Number((netPoints * blendedPointPriceUsd).toFixed(2));
    const revenueUsd = cashRevenueUsd;
    const workflowRuns = project.hdrItems.reduce((sum, item) => {
      const count = Math.max(
        item.workflow?.runningHubTaskId ? 1 : 0,
        Math.round(Number(item.workflow?.runningHubRunCount ?? 0))
      );
      return sum + count;
    }, 0);
    const regenerationRuns = project.hdrItems.reduce((sum, item) => {
      const count = Math.max(
        item.regeneration?.taskId ? 1 : 0,
        Math.round(Number(item.regeneration?.runningHubRunCount ?? 0))
      );
      return sum + count;
    }, 0);
    const runningHubRuns = workflowRuns + regenerationRuns;
    const runningHubCostUsd = Number((runningHubRuns * runningHubUnitCostUsd).toFixed(2));
    const profitUsd = Number((revenueUsd - runningHubCostUsd).toFixed(2));
    return {
      projectId: project.id,
      projectName: project.name,
      userKey: project.userKey,
      userDisplayName: project.userDisplayName,
      status: project.status,
      photoCount: project.photoCount,
      resultCount: project.resultAssets.length,
      chargedPoints,
      refundedPoints,
      netPoints,
      revenueUsd,
      listRevenueUsd,
      cashRevenueUsd,
      blendedPointPriceUsd,
      runningHubRuns,
      workflowRuns,
      regenerationRuns,
      runningHubCostUsd,
      profitUsd,
      updatedAt: project.updatedAt
    };
  });

  const totals = rows.reduce(
    (sum: AdminProjectCostTotals, row: AdminProjectCostRow) => ({
      projects: sum.projects + 1,
      revenueUsd: sum.revenueUsd + row.revenueUsd,
      listRevenueUsd: sum.listRevenueUsd + row.listRevenueUsd,
      cashRevenueUsd: sum.cashRevenueUsd + row.cashRevenueUsd,
      runningHubRuns: sum.runningHubRuns + row.runningHubRuns,
      runningHubCostUsd: sum.runningHubCostUsd + row.runningHubCostUsd,
      profitUsd: sum.profitUsd + row.profitUsd,
      netPoints: sum.netPoints + row.netPoints
    }),
    {
      projects: 0,
      revenueUsd: 0,
      listRevenueUsd: 0,
      cashRevenueUsd: 0,
      runningHubRuns: 0,
      runningHubCostUsd: 0,
      profitUsd: 0,
      netPoints: 0
    }
  );

  res.json({
    unitCostUsd: runningHubUnitCostUsd,
    totals: {
      ...totals,
      revenueUsd: Number(totals.revenueUsd.toFixed(2)),
      listRevenueUsd: Number(totals.listRevenueUsd.toFixed(2)),
      cashRevenueUsd: Number(totals.cashRevenueUsd.toFixed(2)),
      runningHubCostUsd: Number(totals.runningHubCostUsd.toFixed(2)),
      profitUsd: Number(totals.profitUsd.toFixed(2))
    },
    items: rows.sort((a: AdminProjectCostRow, b: AdminProjectCostRow) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 500)
  });
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
  if (!requireAdminReadinessAccess(req, res)) {
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

  const page = Math.max(1, Math.round(Number(req.query.page ?? 1)));
  const pageSize = Math.max(1, Math.min(500, Math.round(Number(req.query.pageSize ?? req.query.limit ?? 200))));
  const projects = listAllProjectsForAdmin();
  const pageCount = Math.max(1, Math.ceil(projects.length / pageSize));
  const offset = (page - 1) * pageSize;

  res.json({
    total: projects.length,
    page,
    pageSize,
    pageCount,
    items: projects.slice(offset, offset + pageSize).map((project: ProjectRecord) => buildAdminProjectPayload(project))
  });
});

app.get('/api/admin/failed-photos', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const page = Math.max(1, Math.round(Number(req.query.page ?? 1)));
  const pageSize = Math.max(1, Math.min(200, Math.round(Number(req.query.pageSize ?? 50))));
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const cause = String(req.query.cause ?? 'all').trim();
  const projects = listAllProjectsForAdmin();
  type FailedPhotoRow = {
    id: string;
    projectId: string;
    projectName: string;
    projectStatus: ProjectRecord['status'];
    projectUpdatedAt: string;
    userKey: string;
    userDisplayName: string;
    photoCount: number;
    resultCount: number;
    hdrCount: number;
    diagnostic: ReturnType<typeof buildFailedItemDiagnostic>;
  };
  const rows: FailedPhotoRow[] = projects.flatMap((project: ProjectRecord) => {
    const health = buildAdminProjectHealth(project);
    return (health.failedItemDiagnostics ?? []).map((diagnostic: ReturnType<typeof buildFailedItemDiagnostic>) => ({
      id: `${project.id}:${diagnostic.id}`,
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      projectUpdatedAt: project.updatedAt,
      userKey: project.userKey,
      userDisplayName: project.userDisplayName,
      photoCount: project.photoCount,
      resultCount: project.resultAssets.length,
      hdrCount: project.hdrItems.length,
      diagnostic
    }));
  });

  const searchMatchedRows = search
    ? rows.filter((row) => {
        const taskId =
          row.diagnostic.runpodJobId || row.diagnostic.runpodBatchJobId || row.diagnostic.runningHubTaskId || '';
        return [
          row.projectName,
          row.projectStatus,
          row.userKey,
          row.userDisplayName,
          row.diagnostic.fileName,
          row.diagnostic.causeTitle,
          row.diagnostic.causeDetail,
          row.diagnostic.errorMessage ?? '',
          row.diagnostic.provider ?? '',
          row.diagnostic.stage ?? '',
          taskId
        ].some((value) => String(value ?? '').toLowerCase().includes(search));
      })
    : rows;
  const causeCounts = searchMatchedRows.reduce<Record<string, { title: string; count: number }>>((counts, row) => {
    const code = row.diagnostic.causeCode;
    counts[code] = {
      title: row.diagnostic.causeTitle,
      count: (counts[code]?.count ?? 0) + 1
    };
    return counts;
  }, {});
  const filteredRows =
    cause && cause !== 'all'
      ? searchMatchedRows.filter((row) => row.diagnostic.causeCode === cause)
      : searchMatchedRows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const offset = (page - 1) * pageSize;

  res.json({
    total: filteredRows.length,
    totalAll: rows.length,
    page,
    pageSize,
    pageCount,
    causeCounts,
    items: filteredRows.slice(offset, offset + pageSize)
  });
});

app.get('/api/admin/projects/:id', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const project = store.getProject(String(req.params.id ?? ''));
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  res.json({
    project: buildAdminProjectPayload(project)
  });
});

app.get('/api/admin/ops/health', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  res.json(buildAdminOpsHealthPayload());
});

app.get('/api/admin/maintenance/reports', (req, res) => {
  if (!requireAdminApiAccess(req, res)) {
    return;
  }

  const limit = Math.max(1, Math.min(30, Math.round(Number(req.query.limit ?? 10))));
  const reportsDir = process.env.METROVAN_MAINTENANCE_REPORT_DIR || path.resolve(process.cwd(), 'reports', 'maintenance');
  if (!fs.existsSync(reportsDir)) {
    res.json({ total: 0, items: [] });
    return;
  }

  const items = fs
    .readdirSync(reportsDir)
    .filter((name) => /^maintenance-\d{8}T\d{6}Z\.json$/.test(name))
    .map((name) => {
      const fullPath = path.join(reportsDir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map(({ name, fullPath }) => buildAdminMaintenanceReportPayload(name, fullPath))
    .filter(Boolean);

  res.json({
    total: items.length,
    items
  });
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

app.post('/api/admin/projects/:id/deep-health', async (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const projectId = String(req.params.id ?? '').trim();
  const project = projectId ? store.getProject(projectId) : null;
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const deepHealth = await buildAdminProjectDeepHealth(project);
  writeAdminAuditLog(req, actor, {
    action: 'project.deep_health_check',
    targetProjectId: project.id,
    details: {
      status: deepHealth.status,
      checkedObjects: deepHealth.checkedObjects,
      issueCount: deepHealth.issues.length
    }
  });

  res.json({
    project: buildAdminProjectPayload(project),
    deepHealth
  });
});

app.post('/api/admin/projects/:id/repair', async (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const projectId = String(req.params.id ?? '').trim();
  const action = String(req.body?.action ?? '').trim();
  const project = projectId ? store.getProject(projectId) : null;
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  if (action === 'retry-failed-processing') {
    const failedItems = project.hdrItems.filter(
      (item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl)
    );
    if (!failedItems.length) {
      res.json({
        action,
        summary: {
          status: 'idle',
          message: '这个项目没有可重试的失败照片。',
          failedItems: 0
        },
        project: buildAdminProjectPayload(project)
      });
      return;
    }

    const nextProject = await processor.start(project.id, { retryFailed: true });
    writeAdminAuditLog(req, actor, {
      action: 'project.repair.retry_failed_processing',
      targetProjectId: project.id,
      details: {
        failedItems: failedItems.length
      }
    });

    res.json({
      action,
      summary: {
        status: 'started',
        message: `已重新排队 ${failedItems.length} 张失败照片。`,
        failedItems: failedItems.length
      },
      project: nextProject ? buildAdminProjectPayload(nextProject) : buildAdminProjectPayload(project)
    });
    return;
  }

  if (action === 'regenerate-download') {
    const { job, reused } = enqueueDownloadJob({
      project,
      userKey: project.userKey,
      options: getDefaultDownloadOptions()
    });
    writeAdminAuditLog(req, actor, {
      action: 'project.repair.regenerate_download',
      targetProjectId: project.id,
      details: {
        jobId: job.jobId,
        jobStatus: job.status,
        reused
      }
    });

    res.json({
      action,
      summary: {
        status: reused ? 'reused' : 'started',
        message: reused ? '已有可复用下载包，已返回现有下载任务。' : '已开始重新生成下载包。',
        jobId: job.jobId,
        jobStatus: job.status,
        reused
      },
      job,
      project: buildAdminProjectPayload(store.getProject(project.id) ?? project)
    });
    return;
  }

  if (action === 'mark-stalled-failed') {
    const now = new Date().toISOString();
    const nextProject = store.updateProject(project.id, (current) => ({
      ...current,
      status: 'failed',
      job: {
        ...(current.job ?? {
          id: nanoid(10),
          status: 'failed',
          phase: 'failed',
          percent: 100,
          label: '',
          detail: '',
          currentHdrItemId: null,
          startedAt: null,
          completedAt: null,
          workflowRealtime: {
            total: 0,
            entered: 0,
            returned: 0,
            active: 0,
            failed: 0,
            succeeded: 0,
            currentNodeName: '',
            currentNodeId: '',
            currentNodePercent: 0,
            monitorState: '',
            transport: '',
            detail: '',
            queuePosition: 0,
            remoteProgress: 0
          }
        }),
        status: 'failed',
        phase: 'failed',
        percent: 100,
        label: '处理失败',
        detail: '管理员已将卡住项目标记为失败。',
        completedAt: now
      }
    }));
    writeAdminAuditLog(req, actor, {
      action: 'project.repair.mark_stalled_failed',
      targetProjectId: project.id,
      details: {
        previousStatus: project.status,
        previousJobStatus: project.job?.status ?? null,
        previousJobPhase: project.job?.phase ?? null
      }
    });

    res.json({
      action,
      summary: {
        status: 'done',
        message: '已将项目标记为失败，用户可重新处理或联系管理员。'
      },
      project: buildAdminProjectPayload(nextProject ?? project)
    });
    return;
  }

  if (action === 'acknowledge-maintenance') {
    const latestDownloadJob = store
      .listProjectDownloadJobs(project.id)
      .sort((left: ProjectDownloadJobRecord, right: ProjectDownloadJobRecord) => right.createdAt - left.createdAt)[0] ?? null;
    const now = new Date().toISOString();
    const note = typeof req.body?.note === 'string' && req.body.note.trim()
      ? req.body.note.trim().slice(0, 240)
      : '当前问题已人工审核，无需重新处理。';
    const signature = buildMaintenanceReviewSignature(project, latestDownloadJob);
    const nextProject = store.updateProject(project.id, (current) => ({
      ...current,
      maintenanceReview: {
        signature,
        reviewedAt: now,
        reviewedBy: actor.actorEmail,
        note
      },
      updatedAt: now
    }));
    writeAdminAuditLog(req, actor, {
      action: 'project.repair.acknowledge_maintenance',
      targetProjectId: project.id,
      details: {
        signature,
        note,
        failedItems: project.hdrItems.filter(
          (item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl)
        ).length
      }
    });

    res.json({
      action,
      summary: {
        status: 'done',
        message: '已标记为已审核；当前这批维护提示会从优先处理和巡检告警中清除。'
      },
      project: buildAdminProjectPayload(nextProject ?? project)
    });
    return;
  }

  res.status(400).json({ error: 'Unsupported repair action.' });
});

function buildAdminProjectPayload(project: ProjectRecord) {
  return {
    ...buildPublicProject(project),
    adminHealth: buildAdminProjectHealth(project)
  };
}

function buildAdminMaintenanceReportPayload(name: string, fullPath: string) {
  try {
    const report = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const results = Array.isArray(report.results) ? report.results : [];
    const applicationData = results.find((item: any) => item?.id === 'application_data') ?? null;
    const maintenanceReport = results.find((item: any) => item?.id === 'maintenance_report') ?? null;
    return {
      id: name.replace(/\.json$/, ''),
      fileName: name,
      startedAt: report.startedAt ?? null,
      completedAt: report.completedAt ?? null,
      ok: Boolean(report.ok),
      failedCount: Number(report.failedCount ?? results.filter((item: any) => item && item.ok === false).length),
      checks: results.map((item: any) => ({
        id: String(item?.id ?? 'unknown'),
        ok: Boolean(item?.ok),
        status: item?.status ?? null,
        latestStatus: item?.latestStatus ?? null,
        alertCount: Array.isArray(item?.alerts) ? item.alerts.length : 0,
        error: item?.error ? String(item.error).slice(0, 240) : null
      })),
      totals: applicationData?.totals ?? null,
      alerts: Array.isArray(applicationData?.alerts) ? applicationData.alerts.slice(0, 12) : [],
      reviewedProjects: Array.isArray(applicationData?.reviewedProjects) ? applicationData.reviewedProjects.slice(0, 10) : [],
      priorityQueue: Array.isArray(applicationData?.priorityQueue) ? applicationData.priorityQueue.slice(0, 5) : [],
      alert: maintenanceReport?.alert ?? null
    };
  } catch (error) {
    return {
      id: name.replace(/\.json$/, ''),
      fileName: name,
      startedAt: null,
      completedAt: null,
      ok: false,
      failedCount: 1,
      checks: [{ id: 'report_parse', ok: false, status: null, latestStatus: null, alertCount: 0, error: error instanceof Error ? error.message : String(error) }],
      totals: null,
      alerts: [],
      reviewedProjects: [],
      priorityQueue: [],
      alert: null
    };
  }
}

function buildMaintenanceReviewSignature(project: ProjectRecord, latestDownloadJob?: ProjectDownloadJobRecord | null) {
  const failedItems = project.hdrItems
    .filter((item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl))
    .map((item) => item.id)
    .sort();
  const rawJpegSidecars = project.hdrItems
    .filter((item) => hasRawJpegSidecarMix(item.exposures.map((exposure) => exposure.originalName || exposure.fileName)))
    .map((item) => item.id)
    .sort();
  const duplicateSources = project.hdrItems
    .filter((item) => hasDuplicateSources(item.exposures.map((exposure) => exposure.originalName || exposure.fileName)))
    .map((item) => item.id)
    .sort();
  const missingSourceCount = project.hdrItems.reduce(
    (sum, item) =>
      sum +
      item.exposures.filter((exposure) => !exposure.storageKey && !exposure.storagePath && !exposure.storageUrl).length,
    0
  );
  return JSON.stringify({
    projectId: project.id,
    status: project.status,
    jobStatus: project.job?.status ?? null,
    failedItems,
    rawJpegSidecars,
    duplicateSources,
    missingSourceCount,
    failedDownloadJobId: latestDownloadJob?.status === 'failed' ? latestDownloadJob.jobId : null,
    stalled: getPotentiallyStalledMinutes(project) > 0
  });
}

function normalizeDiagnosticMessage(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function classifyFailedHdrItem(item: ProjectRecord['hdrItems'][number]) {
  const workflow = item.workflow ?? null;
  const rawMessage = normalizeDiagnosticMessage(item.errorMessage || workflow?.errorMessage || item.statusText);
  const lower = rawMessage.toLowerCase();
  const provider = workflow?.lastTaskProvider ?? (workflow?.runpodJobId || workflow?.runpodBatchJobId ? 'runpod' : workflow?.runningHubTaskId ? 'runninghub' : null);
  const missingSourceReferenceCount = item.exposures.filter(
    (exposure) => !exposure.storageKey && !exposure.storagePath && !exposure.storageUrl
  ).length;
  const incomingSourceCount = item.exposures.filter((exposure) => String(exposure.storageKey ?? '').startsWith('incoming/')).length;

  if (
    lower.includes('404') ||
    lower.includes('not found') ||
    lower.includes('source file missing') ||
    lower.includes('源文件缺失') ||
    missingSourceReferenceCount > 0
  ) {
    return {
      causeCode: 'source-missing',
      causeTitle: 'R2 原片缺失',
      causeDetail: missingSourceReferenceCount
        ? `${missingSourceReferenceCount} 个曝光没有源文件引用；需要重新上传原片后再处理。`
        : '处理节点下载原片时返回 404/Not Found；旧项目可能仍引用临时 incoming 原片。',
      recommendedAction: 'deep-health'
    };
  }

  if (lower.includes('no output') || lower.includes('没有返回') || lower.includes('empty response') || lower.includes('output')) {
    return {
      causeCode: 'result-missing',
      causeTitle: '处理完成但未返回结果',
      causeDetail: '云端任务没有给这张照片返回可用结果图，建议重新处理失败照片。',
      recommendedAction: 'retry-failed-processing'
    };
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('socket') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('temporarily') ||
    lower.includes('network') ||
    lower.includes('网络')
  ) {
    return {
      causeCode: 'cloud-transfer',
      causeTitle: '云端传输中断',
      causeDetail: '上传到处理节点、节点下载原片或回传结果时网络中断；系统已自动重试一次，仍失败则可人工重试。',
      recommendedAction: 'retry-failed-processing'
    };
  }

  if (lower.includes('runpod') || provider === 'runpod') {
    return {
      causeCode: 'runpod',
      causeTitle: 'Runpod 处理失败',
      causeDetail: '失败发生在 Runpod 阶段，建议先重试失败照片；如果反复失败，再查看 worker 日志。',
      recommendedAction: 'retry-failed-processing'
    };
  }

  if (lower.includes('runninghub') || provider === 'runninghub') {
    return {
      causeCode: 'runninghub',
      causeTitle: 'RunningHub 处理失败',
      causeDetail: '失败发生在 RunningHub 阶段，建议重试失败照片或恢复 RunningHub 结果。',
      recommendedAction: 'retry-failed-processing'
    };
  }

  return {
    causeCode: incomingSourceCount ? 'legacy-incoming-source' : 'unknown-processing',
    causeTitle: incomingSourceCount ? '旧临时原片引用' : '处理失败',
    causeDetail: incomingSourceCount
      ? `${incomingSourceCount} 个曝光仍引用 incoming 临时路径；建议深度巡检确认对象是否还在。`
      : '暂时无法从错误信息判断具体原因，建议先深度巡检，再重试失败照片。',
    recommendedAction: incomingSourceCount ? 'deep-health' : 'retry-failed-processing'
  };
}

function buildFailedItemDiagnostic(item: ProjectRecord['hdrItems'][number]) {
  const workflow = item.workflow ?? null;
  const selectedExposure =
    item.exposures.find((exposure) => exposure.id === item.selectedExposureId) ?? item.exposures[0] ?? null;
  const classification = classifyFailedHdrItem(item);
  const provider = workflow?.lastTaskProvider ?? (workflow?.runpodJobId || workflow?.runpodBatchJobId ? 'runpod' : workflow?.runningHubTaskId ? 'runninghub' : null);
  return {
    id: item.id,
    hdrIndex: item.index,
    title: item.title || `HDR ${item.index}`,
    fileName: selectedExposure?.originalName || selectedExposure?.fileName || item.resultFileName || `HDR ${item.index}`,
    status: item.status,
    provider,
    stage: workflow?.stage ?? null,
    runpodJobId: workflow?.runpodJobId ?? null,
    runpodBatchJobId: workflow?.runpodBatchJobId ?? null,
    runningHubTaskId: workflow?.runningHubTaskId ?? null,
    updatedAt: workflow?.updatedAt ?? null,
    errorMessage: normalizeDiagnosticMessage(item.errorMessage || workflow?.errorMessage || item.statusText).slice(0, 360) || null,
    exposureCount: item.exposures.length,
    missingSourceReferenceCount: item.exposures.filter(
      (exposure) => !exposure.storageKey && !exposure.storagePath && !exposure.storageUrl
    ).length,
    incomingSourceCount: item.exposures.filter((exposure) => String(exposure.storageKey ?? '').startsWith('incoming/')).length,
    ...classification
  };
}

function buildAdminProjectHealth(project: ProjectRecord) {
  const downloadJobs = store
    .listProjectDownloadJobs(project.id)
    .sort((left: ProjectDownloadJobRecord, right: ProjectDownloadJobRecord) => right.createdAt - left.createdAt);
  const latestDownloadJob = downloadJobs[0] ?? null;
  const hdrStatusCounts = project.hdrItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const exposureCount = project.hdrItems.reduce((sum, item) => sum + item.exposures.length, 0);
  const missingSourceCount = project.hdrItems.reduce(
    (sum, item) =>
      sum +
      item.exposures.filter((exposure) => !exposure.storageKey && !exposure.storagePath && !exposure.storageUrl).length,
    0
  );
  const rawJpegSidecarGroups = project.hdrItems
    .filter((item) => hasRawJpegSidecarMix(item.exposures.map((exposure) => exposure.originalName || exposure.fileName)))
    .map((item) => item.title || `HDR ${item.index}`);
  const duplicateSourceGroups = project.hdrItems
    .filter((item) => hasDuplicateSources(item.exposures.map((exposure) => exposure.originalName || exposure.fileName)))
    .map((item) => item.title || `HDR ${item.index}`);
  const suspiciousResultFiles = project.resultAssets
    .filter((asset) => isSuspiciousLocalJpeg(asset.storagePath))
    .map((asset) => asset.fileName);
  const failedItemsWithoutResult = project.hdrItems.filter(
    (item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl)
  ).length;
  const failedItemDiagnostics = project.hdrItems
    .filter((item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl))
    .map((item) => buildFailedItemDiagnostic(item));
  const stalledMinutes = getPotentiallyStalledMinutes(project);
  const maintenanceSignature = buildMaintenanceReviewSignature(project, latestDownloadJob);
  const reviewed = project.maintenanceReview?.signature === maintenanceSignature;
  const warnings = [
    missingSourceCount ? `${missingSourceCount} 个曝光缺少源文件引用` : '',
    rawJpegSidecarGroups.length ? `${rawJpegSidecarGroups.length} 组混入同名 JPG 副本` : '',
    duplicateSourceGroups.length ? `${duplicateSourceGroups.length} 组有重复文件` : '',
    suspiciousResultFiles.length ? `${suspiciousResultFiles.length} 张结果图本地文件可疑` : '',
    latestDownloadJob?.status === 'failed' ? `最近下载失败：${latestDownloadJob.error ?? 'unknown'}` : '',
    stalledMinutes ? `项目可能已卡住 ${stalledMinutes} 分钟` : ''
  ].filter(Boolean);
  const failedCount = hdrStatusCounts.error ?? 0;
  const processingCount = ['hdr-processing', 'workflow-upload', 'workflow-running'].reduce(
    (sum, status) => sum + (hdrStatusCounts[status] ?? 0),
    0
  );
  const detectedIssues = [
    failedItemsWithoutResult
      ? {
          code: 'failed-processing-items',
          severity: 'error',
          title: '照片处理失败',
          detail: `${failedItemsWithoutResult} 张失败照片没有结果图，可直接重新排队处理。`,
          action: 'retry-failed-processing'
        }
      : null,
    latestDownloadJob?.status === 'failed'
      ? {
          code: 'download-job-failed',
          severity: 'warning',
          title: '最近下载包生成失败',
          detail: latestDownloadJob.error ? `下载任务失败：${latestDownloadJob.error}` : '最近一次下载任务失败，建议重新生成下载包。',
          action: 'regenerate-download'
        }
      : null,
    suspiciousResultFiles.length
      ? {
          code: 'suspicious-result-files',
          severity: 'error',
          title: '结果图文件可疑',
          detail: `${suspiciousResultFiles.length} 张本地结果图可能截断或不完整，建议先深度巡检，再重新生成下载包。`,
          action: 'deep-health'
        }
      : null,
    missingSourceCount
      ? {
          code: 'missing-source-references',
          severity: 'error',
          title: '源文件引用缺失',
          detail: `${missingSourceCount} 个曝光缺少 R2/local 源文件引用，建议深度巡检确认对象状态。`,
          action: 'deep-health'
        }
      : null,
    rawJpegSidecarGroups.length
      ? {
          code: 'raw-jpeg-sidecars',
          severity: 'warning',
          title: 'RAW/JPG 混组',
          detail: `${rawJpegSidecarGroups.length} 个 HDR 组混入同名 JPG 副本，后续同类上传应优先使用 RAW。`,
          action: 'deep-health'
        }
      : null,
    duplicateSourceGroups.length
      ? {
          code: 'duplicate-source-files',
          severity: 'warning',
          title: '重复源文件',
          detail: `${duplicateSourceGroups.length} 个 HDR 组包含重复文件，建议检查分组。`,
          action: 'deep-health'
        }
      : null,
    stalledMinutes
      ? {
          code: 'stalled-project',
          severity: 'error',
          title: '项目疑似卡住',
          detail: `项目已超过 ${stalledMinutes} 分钟没有更新，可标记为失败后重新处理。`,
          action: 'mark-stalled-failed'
        }
      : null
  ].filter(Boolean);
  const issues = reviewed ? [] : detectedIssues;
  const visibleWarnings = reviewed ? [] : warnings;
  const recommendedActions = Array.from(
    new Set(issues.map((issue: any) => issue.action).filter(Boolean))
  ).slice(0, 4);
  if (!reviewed && (detectedIssues.length || warnings.length) && !recommendedActions.includes('acknowledge-maintenance')) {
    recommendedActions.push('acknowledge-maintenance');
  }
  const status =
    reviewed
      ? project.status === 'completed'
        ? 'healthy'
        : 'idle'
      : issues.some((issue: any) => issue.severity === 'error') || visibleWarnings.length || failedCount
      ? 'attention'
      : project.status === 'completed' && project.resultAssets.length === project.hdrItems.length
        ? 'healthy'
        : processingCount || project.status === 'processing' || project.status === 'uploading'
          ? 'processing'
          : 'idle';

  return {
    status,
    exposureCount,
    hdrCount: project.hdrItems.length,
    resultCount: project.resultAssets.length,
    failedCount,
    processingCount,
    missingSourceCount,
    downloadReady: project.downloadReady,
    latestDownloadJob: latestDownloadJob
      ? {
          jobId: latestDownloadJob.jobId,
          status: latestDownloadJob.status,
          completedAt: latestDownloadJob.completedAt,
          error: latestDownloadJob.error
        }
      : null,
    reviewed,
    maintenanceReview: project.maintenanceReview ?? null,
    warnings: visibleWarnings,
    rootCauseSummary: reviewed
      ? `已审核：${project.maintenanceReview?.note || '当前问题无需处理。'}`
      : failedItemDiagnostics.length
        ? `${failedItemDiagnostics.length} 张失败照片：${failedItemDiagnostics[0]?.causeTitle ?? '处理失败'}。`
      : issues.length
        ? (issues[0] as any).detail
        : '未发现需要处理的项目健康问题。',
    issues,
    failedItemDiagnostics: reviewed ? [] : failedItemDiagnostics,
    recommendedActions,
    rawJpegSidecarGroups,
    duplicateSourceGroups,
    suspiciousResultFiles
  };
}

function getPotentiallyStalledMinutes(project: ProjectRecord) {
  const activeProject = project.status === 'uploading' || project.status === 'processing';
  const activeJob = project.job?.status === 'queued' || project.job?.status === 'running';
  if (!activeProject && !activeJob) {
    return 0;
  }
  const updatedAt = Date.parse(project.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return 0;
  }
  const minutes = Math.floor((Date.now() - updatedAt) / 60000);
  return minutes >= 45 ? minutes : 0;
}

async function buildAdminProjectDeepHealth(project: ProjectRecord) {
  const startedAt = new Date().toISOString();
  const issues: Array<{ severity: 'warning' | 'error'; scope: string; name: string; message: string }> = [];
  let checkedObjects = 0;
  let missingObjects = 0;
  let sizeMismatchObjects = 0;

  const checkObject = async (input: {
    scope: string;
    name: string;
    storageKey?: string | null;
    expectedSize?: number | null;
    required?: boolean;
  }) => {
    if (!input.storageKey) {
      if (input.required) {
        issues.push({ severity: 'error', scope: input.scope, name: input.name, message: '缺少 R2 storage key' });
      }
      return;
    }

    checkedObjects += 1;
    const metadata = await getObjectStorageMetadata(input.storageKey).catch((error) => {
      issues.push({
        severity: 'error',
        scope: input.scope,
        name: input.name,
        message: `R2 元数据读取失败：${error instanceof Error ? error.message : String(error)}`
      });
      return null;
    });
    if (!metadata) {
      missingObjects += 1;
      issues.push({ severity: 'error', scope: input.scope, name: input.name, message: 'R2 对象不存在' });
      return;
    }
    if (typeof input.expectedSize === 'number' && metadata.size !== null && metadata.size !== input.expectedSize) {
      sizeMismatchObjects += 1;
      issues.push({
        severity: 'error',
        scope: input.scope,
        name: input.name,
        message: `大小不一致：记录 ${input.expectedSize} bytes，R2 ${metadata.size} bytes`
      });
    }
  };

  const objectChecks: Array<() => Promise<void>> = [];
  for (const hdrItem of project.hdrItems) {
    for (const exposure of hdrItem.exposures) {
      objectChecks.push(() => checkObject({
        scope: hdrItem.title || `HDR ${hdrItem.index}`,
        name: exposure.originalName || exposure.fileName,
        storageKey: exposure.storageKey,
        expectedSize: exposure.size,
        required: true
      }));
    }
  }

  for (const asset of project.resultAssets) {
    objectChecks.push(() => checkObject({
      scope: 'result',
      name: asset.fileName,
      storageKey: asset.storageKey,
      required: true
    }));
    if (isSuspiciousLocalJpeg(asset.storagePath)) {
      issues.push({ severity: 'error', scope: 'result', name: asset.fileName, message: '本地结果 JPG 文件可疑或截断' });
    }
  }

  const latestDownloadJob = store
    .listProjectDownloadJobs(project.id)
    .sort((left: ProjectDownloadJobRecord, right: ProjectDownloadJobRecord) => right.createdAt - left.createdAt)[0] ?? null;
  if (latestDownloadJob?.downloadKey) {
    objectChecks.push(() => checkObject({
      scope: 'download',
      name: latestDownloadJob.jobId,
      storageKey: latestDownloadJob.downloadKey,
      required: latestDownloadJob.status === 'ready'
    }));
  } else if (latestDownloadJob?.status === 'ready') {
    issues.push({ severity: 'error', scope: 'download', name: latestDownloadJob.jobId, message: '下载任务 ready 但缺少 downloadKey' });
  }
  if (latestDownloadJob?.status === 'failed') {
    issues.push({
      severity: 'warning',
      scope: 'download',
      name: latestDownloadJob.jobId,
      message: latestDownloadJob.error ?? '最近下载任务失败'
    });
  }

  await runAdminDeepHealthChecks(objectChecks, 12);

  const completedAt = new Date().toISOString();
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  return {
    status: errorCount ? 'failed' : issues.length ? 'warning' : 'passed',
    startedAt,
    completedAt,
    checkedObjects,
    missingObjects,
    sizeMismatchObjects,
    issueCount: issues.length,
    issues: issues.slice(0, 100)
  };
}

async function runAdminDeepHealthChecks(checks: Array<() => Promise<void>>, concurrency: number) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, checks.length) }, async () => {
    while (cursor < checks.length) {
      const index = cursor;
      cursor += 1;
      await checks[index]!();
    }
  });
  await Promise.all(workers);
}

const ADMIN_RAW_EXTENSIONS = new Set([
  '.arw',
  '.cr2',
  '.cr3',
  '.crw',
  '.nef',
  '.nrw',
  '.dng',
  '.raf',
  '.rw2',
  '.rwl',
  '.orf',
  '.srw',
  '.3fr',
  '.fff',
  '.iiq',
  '.pef',
  '.erf'
]);
const ADMIN_JPEG_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function normalizeAdminFileName(fileName: string) {
  return path.basename(String(fileName ?? '').replace(/\\/g, '/')).trim().toLowerCase();
}

function normalizeAdminFileStem(fileName: string) {
  const normalized = normalizeAdminFileName(fileName);
  const extension = path.extname(normalized);
  return extension ? normalized.slice(0, -extension.length) : normalized;
}

function hasRawJpegSidecarMix(fileNames: string[]) {
  const rawStems = new Set<string>();
  const jpegStems = new Set<string>();
  for (const fileName of fileNames) {
    const normalized = normalizeAdminFileName(fileName);
    const stem = normalizeAdminFileStem(normalized);
    const extension = path.extname(normalized);
    if (ADMIN_RAW_EXTENSIONS.has(extension)) rawStems.add(stem);
    if (ADMIN_JPEG_EXTENSIONS.has(extension)) jpegStems.add(stem);
  }
  return Array.from(jpegStems).some((stem) => rawStems.has(stem));
}

function hasDuplicateSources(fileNames: string[]) {
  const seen = new Set<string>();
  for (const fileName of fileNames) {
    const normalized = normalizeAdminFileName(fileName);
    if (!normalized) continue;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

function isSuspiciousLocalJpeg(filePath: string | null | undefined) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.jpg' && extension !== '.jpeg') {
    return false;
  }
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size < 4) {
    return true;
  }
  const handle = fs.openSync(filePath, 'r');
  try {
    const start = Buffer.alloc(2);
    const end = Buffer.alloc(2);
    fs.readSync(handle, start, 0, 2, 0);
    fs.readSync(handle, end, 0, 2, stats.size - 2);
    return !(start[0] === 0xff && start[1] === 0xd8 && end[0] === 0xff && end[1] === 0xd9);
  } finally {
    fs.closeSync(handle);
  }
}

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
  const invalidPublishedFeature = parsed.data.studioFeatures?.find((feature: {
    id: string;
    enabled: boolean;
    titleZh: string;
    titleEn: string;
    descriptionZh: string;
    descriptionEn: string;
    beforeImageUrl: string;
    afterImageUrl: string;
    workflowId: string;
    inputNodeId: string;
    outputNodeId: string;
    pointsPerPhoto: number;
  }) => feature.enabled && getStudioFeaturePublishIssues(feature).length > 0);
  if (invalidPublishedFeature) {
    res.status(400).json({
      error: `“${invalidPublishedFeature.titleZh || invalidPublishedFeature.id}” 已开启前台显示，但缺少：${getStudioFeaturePublishIssues(invalidPublishedFeature).join('、')}。`
    });
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
    projects: store.listProjects(user.userKey).map((project: ProjectRecord) => buildAdminProjectPayload(project)),
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
    items: store.listProjects(user.userKey).map((project: ProjectRecord) => buildAdminProjectPayload(project))
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

app.post('/api/admin/users/:id/allow-access', (req, res) => {
  const actor = requireAdminApiAccess(req, res);
  if (!actor) {
    return;
  }

  const parsed = adminUserAllowAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = store.getUserById(String(req.params.id ?? ''));
  if (!user) {
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }
  if (parsed.data.confirmUserId !== user.id) {
    res.status(400).json({ error: '允许访问确认信息与用户不匹配。' });
    return;
  }

  const previous = buildAdminUserRecord(user);
  const now = new Date().toISOString();
  const updated = store.updateUser(user.id, (current) => ({
    ...current,
    accountStatus: 'active',
    emailVerifiedAt: current.emailVerifiedAt ?? now
  }));
  if (!updated) {
    res.status(404).json({ error: '找不到该用户。' });
    return;
  }

  writeAdminAuditLog(req, actor, {
    action: 'admin.user.allow_access',
    targetUserId: updated.id,
    details: {
      before: {
        accountStatus: previous.accountStatus,
        emailVerifiedAt: previous.emailVerifiedAt
      },
      after: {
        accountStatus: updated.accountStatus,
        emailVerifiedAt: updated.emailVerifiedAt
      }
    }
  });

  res.json({
    user: buildAdminUserRecord(updated),
    auditLogs: store.listAuditLogs({ targetUserId: updated.id, limit: 100 })
  });
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
