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
import type { ProjectRecord, ProjectDownloadJobRecord } from '../types.js';

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

  const limit = Math.max(1, Math.min(500, Math.round(Number(req.query.limit ?? 120))));
  const projects = listAllProjectsForAdmin();

  res.json({
    total: projects.length,
    items: projects.slice(0, limit).map((project: ProjectRecord) => buildAdminProjectPayload(project))
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
      priorityQueue: [],
      alert: null
    };
  }
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
  const stalledMinutes = getPotentiallyStalledMinutes(project);
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
  const issues = [
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
  const recommendedActions = Array.from(
    new Set(issues.map((issue: any) => issue.action).filter(Boolean))
  ).slice(0, 4);
  const status =
    issues.some((issue: any) => issue.severity === 'error') || warnings.length || failedCount
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
    warnings,
    rootCauseSummary: issues.length ? (issues[0] as any).detail : '未发现需要处理的项目健康问题。',
    issues,
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
