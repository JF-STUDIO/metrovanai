import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { HdrItem, ProjectRecord } from '../types.js';
import type { RouteContext } from './context.js';
import { createProjectDownloadsRouter } from './project-downloads.js';
import { createProjectResultsRouter } from './project-results.js';
import { createProjectUploadsRouter } from './project-uploads.js';

export function createProjectRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    DIRECT_UPLOAD_MANIFEST_FILE,
    DIRECT_UPLOAD_MULTIPART_PART_SIZE,
    POINT_PRICE_USD,
    RESULT_THUMBNAIL_URL_TTL_SECONDS,
    abortMultipartObjectUpload,
    appendAssetVersion,
    assertDirectObjectUploadConfigured,
    assertDirectUploadObjectReady,
    buildProjectAssetRoute,
    buildHdrItemsFromFrontendLayout,
    buildPublicExposure,
    buildPublicProject,
    buildPublicResultAsset,
    canServeExposurePreview,
    checkDirectUploadTargetLimits,
    checkUserRateLimit,
    captureServerError,
    collectDirectUploadManifestEntriesByName,
    collectMissingExposureSourceNames,
    commitStagedOriginals,
    completeMultipartObjectUpload,
    createDirectObjectMultipartUpload,
    createDirectObjectUploadTarget,
    createMultipartUploadPartUrl,
    createProjectSchema,
    createUploadBatchId,
    deleteObjectsFromStorage,
    deleteProjectObjectStorage,
    directUploadCompleteSchema,
    directUploadTargetSchema,
    downloadDirectObjectToFile,
    downloadRequestSchema,
    downloadVariantSchema,
    enqueueDownloadJob,
    ensureExposurePreviewFile,
    ensureHdrItemResultPreviewFile,
    ensureResultAssetPreviewFile,
    ensureResultThumbnailManifestItem,
    exposureSelectionSchema,
    getDownloadJob,
    getDirectObjectUploadCapabilities,
    getHdrItemExposureIdentity,
    getObjectStorageMetadata,
    getOwnedProjectFromRequest,
    getProjectDownloadFileName,
    getProjectForAuthenticatedRead,
    getRegeneratedAssetVersion,
    getResultAssetThumbnailKey,
    getResultAssetThumbnailPath,
    getResultAssetVersionSegment,
    groupUpdateSchema,
    hasUsableExposureSource,
    hdrLayoutSchema,
    isCloudObjectStorageKey,
    isDirectUploadKeyForProject,
    isLocalProxyUploadEnabled,
    isPathInsideDirectory,
    isProductionRuntime,
    logServerEvent,
    moveHdrSchema,
    multipartPartNumbersSchema,
    multipartUploadAbortSchema,
    multipartUploadCompleteSchema,
    multipartUploadInitSchema,
    normalizeDirectUploadManifestName,
    normalizeUploadedFileName,
    patchProjectSchema,
    parseDirectUploadCompleteConcurrency,
    processor,
    projectHdrItemsAfterLayout,
    regenerateResultSchema,
    reorderResultsSchema,
    requireAuthenticatedUser,
    respondWithProject,
    restoreObjectToFileIfAvailable,
    runWithConcurrency,
    sendCachedPreviewFile,
    sendProtectedStorageFile,
    shouldStageDirectUploadObjectsLocally,
    store,
    streamProjectDownloadArchive,
    upload,
    uploadFileToObjectStorage,
    writeSecurityAuditLog,
    getDefaultDownloadOptions,
    assertProjectDownloadAssetsReady,
    DownloadIncompleteError,
    cancelDownloadJob,
    sanitizeSegment,
    isSupportedUploadFileName,
    allocateOriginalTargetPath,
    trimObjectStoragePrefix,
    isObjectStorageConfigured,
    getPublicErrorMessage,
    getClientIp
  } = ctx;

  app.use(createProjectResultsRouter(ctx));
  app.use(createProjectDownloadsRouter(ctx));
  app.use(createProjectUploadsRouter(ctx));

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

  const project = getProjectForAuthenticatedRead(user, String(req.params.id ?? ''));
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
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
    address: parsed.data.address,
    studioFeatureId: parsed.data.studioFeatureId
  });
  respondWithProject(res, project, 201);
});

app.patch('/api/projects/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  if (!store.getProjectForUser(String(req.params.id ?? ''), user.userKey)) {
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  respondWithProject(res, project);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/preview', async (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item: any) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  const selectedExposure =
    hdrItem.exposures.find((exposure: any) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0] ?? null;
  if (hdrItem.resultPath) {
    const previewPath = await ensureHdrItemResultPreviewFile(owned.project, hdrItem);
    if (previewPath) {
      sendCachedPreviewFile(res, previewPath);
      return;
    }
    res.status(404).json({ error: '找不到该预览图。' });
    return;
  }

  let previewPath: string | null = null;
  if (selectedExposure) {
    previewPath = await ensureExposurePreviewFile(selectedExposure);
  }

  if (!previewPath) {
    res.status(404).json({ error: '找不到该预览图。' });
    return;
  }
  sendProtectedStorageFile(res, previewPath, selectedExposure?.previewKey);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/result', (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item: any) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  sendProtectedStorageFile(res, hdrItem.resultPath, hdrItem.resultKey);
});

app.get('/api/projects/:id/hdr-items/:hdrItemId/exposures/:exposureId/preview', async (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const hdrItem = owned.project.hdrItems.find((item: any) => item.id === String(req.params.hdrItemId ?? ''));
  if (!hdrItem) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  const exposure = hdrItem.exposures.find((item: any) => item.id === String(req.params.exposureId ?? ''));
  if (!exposure) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  const previewPath = await ensureExposurePreviewFile(exposure);
  if (!previewPath) {
    res.status(404).json({ error: '找不到该预览图。' });
    return;
  }
  sendProtectedStorageFile(res, previewPath, exposure.previewKey);
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
      res.status(404).json({ error: '找不到该项目。' });
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

app.post('/api/projects/:id/hdr-layout', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
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
    const hasFrontendExposureMetadata = parsed.data.hdrItems.some((item: any) => item.exposures?.length);
    if (!parsed.data.hdrItems.length && !(parsed.data.mode === 'merge' && parsed.data.inputComplete)) {
      res.status(400).json({ error: '未提供 HDR 分组信息。' });
      return;
    }
    if (parsed.data.hdrItems.length > 0 && !stagedFiles.length && !hasFrontendExposureMetadata) {
      res.status(400).json({ error: '暂无可分组的上传照片。' });
      return;
    }

    const hdrItems = parsed.data.hdrItems.length
      ? await buildHdrItemsFromFrontendLayout(project, store, stagedFiles, parsed.data.hdrItems)
      : [];
    const finalHdrItems = projectHdrItemsAfterLayout(project, hdrItems, parsed.data.mode);
    if (parsed.data.inputComplete) {
      const layoutErrors = validateHdrLayoutForProcessing(finalHdrItems);
      if (layoutErrors.length) {
        res.status(400).json({
          error: `HDR 分组需要先修正：${layoutErrors.slice(0, 5).join('；')}${layoutErrors.length > 5 ? `；+${layoutErrors.length - 5} more` : ''}`
        });
        return;
      }

      const missingSourceNames = collectMissingExposureSourceNames(finalHdrItems);
      if (missingSourceNames.length) {
        res.status(409).json({
          error: `Upload is not complete yet. Retry the unfinished files before processing: ${missingSourceNames
            .slice(0, 5)
            .join(', ')}${missingSourceNames.length > 5 ? `, +${missingSourceNames.length - 5} more` : ''}.`
        });
        return;
      }
    }
    const updated =
      parsed.data.mode === 'merge'
        ? store.mergeHdrItems(projectId, hdrItems, { inputComplete: parsed.data.inputComplete })
        : store.replaceHdrItems(projectId, hdrItems, { inputComplete: parsed.data.inputComplete });
    if (!updated) {
      res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const project = store.createGroup(projectId);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const parsed = groupUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.updateGroup(projectId, String(req.params.groupId ?? ''), parsed.data);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const targetItem = currentProject.hdrItems.find((item: any) => item.id === String(req.params.hdrItemId ?? ''));
  if (targetItem) {
    const cleanup = await deleteObjectsFromStorage([targetItem.mergedKey, targetItem.resultKey]);
    if (cleanup.failed.length) {
      console.warn(`R2 cleanup skipped ${cleanup.failed.length} objects for HDR item ${targetItem.id}`, cleanup.failed);
    }
  }

  const project = store.deleteHdrItem(projectId, String(req.params.hdrItemId ?? ''));
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const parsed = reorderResultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const project = store.reorderResultAssets(projectId, parsed.data.orderedHdrItemIds);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  respondWithProject(res, project);
});

app.post('/api/projects/:id/hdr-items/:hdrItemId/regenerate', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-result-regenerate',
      limit: 30,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  if (!store.getProjectForUser(projectId, user.userKey)) {
    res.status(404).json({ error: '找不到该项目。' });
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
      res.status(404).json({ error: '找不到该项目。' });
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
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-processing-start',
      limit: 20,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const ownedProject = store.getProjectForUser(projectId, user.userKey);
  if (!ownedProject) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  try {
    if (!ownedProject.hdrItems.length) {
      res.status(400).json({ error: '暂无可处理的照片，请先上传图片。' });
      return;
    }

    if (ownedProject.status === 'processing') {
      respondWithProject(res, ownedProject);
      return;
    }

    const billingSummary = store.getBillingSummary(user.userKey);
    if (ownedProject.pointsEstimate > billingSummary.availablePoints) {
      res.status(402).json({
        error: `积分不足，当前余额 ${billingSummary.availablePoints}，至少需要 ${ownedProject.pointsEstimate}。请先充值。`
      });
      return;
    }

    const reservation = store.reserveProjectProcessingCredits(projectId, POINT_PRICE_USD);
    if (!reservation.ok) {
      res.status(402).json({
        error:
          reservation.error ||
          `积分不足，当前余额 ${reservation.availablePoints}，至少需要 ${reservation.requiredPoints}。请先充值。`
      });
      return;
    }

    await commitStagedOriginals(projectId);

    writeSecurityAuditLog(req, {
      action: 'project.processing.reserve_credits',
      targetUserId: user.id,
      targetProjectId: projectId,
      details: {
        requiredPoints: reservation.requiredPoints,
        reservedEntryId: reservation.entry?.id ?? null
      }
    });

    const hasRetriableFailedItems = ownedProject.hdrItems.some(
      (item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl)
    );
    const project = await processor.start(projectId, {
      retryFailed: ownedProject.status === 'failed' || hasRetriableFailedItems
    });
    if (!project) {
      res.status(404).json({ error: '找不到该项目。' });
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

app.post('/api/projects/:id/retry-failed', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-processing-retry',
      limit: 20,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const ownedProject = store.getProjectForUser(projectId, user.userKey);
  if (!ownedProject) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const failedItems = ownedProject.hdrItems.filter(
    (item: any) => item.status === 'error' && !(item.resultKey || item.resultPath || item.resultUrl)
  );
  if (!failedItems.length) {
    respondWithProject(res, ownedProject);
    return;
  }

  try {
    const reservation = store.reserveProjectProcessingCredits(projectId, POINT_PRICE_USD);
    if (!reservation.ok) {
      res.status(402).json({
        error:
          reservation.error ||
          `积分不足，当前余额 ${reservation.availablePoints}，至少需要 ${reservation.requiredPoints}。请先充值。`
      });
      return;
    }

    writeSecurityAuditLog(req, {
      action: 'project.processing.retry_failed',
      targetUserId: user.id,
      targetProjectId: projectId,
      details: {
        failedItems: failedItems.length,
        reservedEntryId: reservation.entry?.id ?? null
      }
    });

    const project = await processor.start(projectId, { retryFailed: true });
    if (!project) {
      res.status(404).json({ error: '找不到该项目。' });
      return;
    }
    respondWithProject(res, project);
  } catch (error) {
    captureServerError(error, {
      event: 'project.retry_failed.failed',
      traceId: (req as express.Request & { traceId?: string }).traceId ?? null,
      userKey: user.userKey,
      projectId,
      phase: ownedProject.job?.phase ?? ownedProject.job?.status ?? null
    });
    res.status(500).json({ error: getPublicErrorMessage(error) });
  }
});

  return app;
}

function validateHdrLayoutForProcessing(hdrItems: HdrItem[]) {
  const errors: string[] = [];
  const seenSources = new Map<string, string>();

  for (const item of hdrItems) {
    if (!item.exposures.length) {
      errors.push(`${item.title || `HDR ${item.index}`} 没有照片`);
      continue;
    }

    const seenInGroup = new Set<string>();
    const rawStems = new Set<string>();
    const jpegStems = new Set<string>();

    for (const exposure of item.exposures) {
      const sourceName = exposure.originalName || exposure.fileName;
      const sourceKey = normalizeLayoutFileIdentity(sourceName);
      if (!sourceKey) {
        errors.push(`${item.title || `HDR ${item.index}`} 有无效文件名`);
        continue;
      }

      if (seenInGroup.has(sourceKey)) {
        errors.push(`${item.title || `HDR ${item.index}`} 重复包含 ${sourceName}`);
      }
      seenInGroup.add(sourceKey);

      const previousGroup = seenSources.get(sourceKey);
      if (previousGroup && previousGroup !== item.id) {
        errors.push(`${sourceName} 被放进了多个 HDR 分组`);
      }
      seenSources.set(sourceKey, item.id);

      const stem = normalizeLayoutFileStem(sourceName);
      if (isRawLayoutFile(sourceName)) {
        rawStems.add(stem);
      } else if (isJpegLayoutFile(sourceName)) {
        jpegStems.add(stem);
      }
    }

    for (const stem of jpegStems) {
      if (rawStems.has(stem)) {
        errors.push(`${item.title || `HDR ${item.index}`} 同时包含 RAW 和同名 JPG 副本，请保留 RAW`);
      }
    }

    if (item.selectedExposureId && !item.exposures.some((exposure) => exposure.id === item.selectedExposureId)) {
      errors.push(`${item.title || `HDR ${item.index}`} 默认曝光不存在`);
    }
  }

  return Array.from(new Set(errors));
}

const RAW_LAYOUT_EXTENSIONS = new Set([
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
const JPEG_LAYOUT_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function normalizeLayoutFileIdentity(fileName: string) {
  return path.basename(String(fileName ?? '').replace(/\\/g, '/')).trim().toLowerCase();
}

function normalizeLayoutFileStem(fileName: string) {
  const normalized = normalizeLayoutFileIdentity(fileName);
  const extension = path.extname(normalized);
  return extension ? normalized.slice(0, -extension.length) : normalized;
}

function isRawLayoutFile(fileName: string) {
  return RAW_LAYOUT_EXTENSIONS.has(path.extname(normalizeLayoutFileIdentity(fileName)));
}

function isJpegLayoutFile(fileName: string) {
  return JPEG_LAYOUT_EXTENSIONS.has(path.extname(normalizeLayoutFileIdentity(fileName)));
}
