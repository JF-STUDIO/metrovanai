import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord } from '../types.js';
import type { RouteContext } from './context.js';

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

async function collectResultThumbnailManifestItems(project: ProjectRecord) {
  const items: Array<{
    assetId: string;
    sortOrder: number;
    fileName: string;
    url: string;
    width: number;
    height: number;
  }> = [];

  await runWithConcurrency(project.resultAssets, 4, async (asset: any) => {
    try {
      const thumbnail = await ensureResultThumbnailManifestItem(project, asset);
      if (thumbnail) {
        items.push({
          ...thumbnail,
          sortOrder: asset.sortOrder,
          fileName: asset.fileName
        });
      }
    } catch (error) {
      logServerEvent({
        level: 'warning',
        event: 'project.result_thumbnail.failed',
        projectId: project.id,
        details: {
          resultAssetId: asset.id,
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });

  return items.sort((left: any, right: any) => left.sortOrder - right.sortOrder);
}

async function respondWithResultThumbnailManifest(
  req: express.Request,
  res: express.Response,
  mode: 'manifest' | 'batch'
) {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, owned.user, {
      scope: 'project-result-thumbnails',
      limit: 120,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const items = await collectResultThumbnailManifestItems(owned.project);

  if (mode === 'batch') {
    res.json({ thumbnails: items });
    return;
  }

  res.json({ items, thumbnails: items, expiresInSeconds: RESULT_THUMBNAIL_URL_TTL_SECONDS });
}

app.get('/api/projects/:id/results/thumbnails', async (req, res) => {
  await respondWithResultThumbnailManifest(req, res, 'manifest');
});

app.get('/api/projects/:id/results/thumbnails-batch', async (req, res) => {
  await respondWithResultThumbnailManifest(req, res, 'batch');
});

app.get('/api/projects/:id/results/:resultAssetId/file', (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const asset = owned.project.resultAssets.find((item: any) => item.id === String(req.params.resultAssetId ?? ''));
  if (!asset) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  sendProtectedStorageFile(res, asset.storagePath, asset.storageKey);
});

app.get('/api/projects/:id/results/:resultAssetId/preview', async (req, res) => {
  const owned = getOwnedProjectFromRequest(req, res);
  if (!owned) {
    return;
  }

  const asset = owned.project.resultAssets.find((item: any) => item.id === String(req.params.resultAssetId ?? ''));
  if (!asset) {
    res.status(404).json({ error: '找不到该文件。' });
    return;
  }

  const previewPath = await ensureResultAssetPreviewFile(owned.project, asset);
  if (previewPath) {
    sendCachedPreviewFile(res, previewPath);
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

function parseDownloadQueryOptions(rawOptions: unknown) {
  if (!rawOptions) {
    return getDefaultDownloadOptions();
  }

  const encoded = Array.isArray(rawOptions) ? rawOptions[0] : String(rawOptions);
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = downloadRequestSchema.safeParse(JSON.parse(decoded));
    if (!parsed.success) {
      throw new Error('Invalid download options.');
    }
    return {
      ...getDefaultDownloadOptions(),
      ...parsed.data
    };
  } catch {
    throw new Error('Invalid download options.');
  }
}

function setArchiveDownloadHeaders(res: express.Response, fileName: string) {
  const asciiFallback = sanitizeSegment(fileName).replace(/[^\x20-\x7e]/g, '_') || 'metrovan-download.zip';
  res.status(200);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
}

async function sendProjectDownloadArchive(
  project: ProjectRecord,
  options: ReturnType<typeof getDefaultDownloadOptions>,
  res: express.Response
) {
  await assertProjectDownloadAssetsReady(project);
  setArchiveDownloadHeaders(res, getProjectDownloadFileName(project));
  await streamProjectDownloadArchive(project, res, options);
}

function handleDownloadError(
  req: express.Request,
  res: express.Response,
  project: ProjectRecord,
  user: NonNullable<ReturnType<typeof requireAuthenticatedUser>>,
  error: unknown
) {
  if (error instanceof DownloadIncompleteError) {
    const downloadError = error as { missingFiles: unknown };
    writeSecurityAuditLog(req, {
      action: 'project.download.incomplete',
      targetUserId: user.id,
      targetProjectId: project.id,
      details: { missingFiles: downloadError.missingFiles }
    });
    res.status(409).json({ error: 'incomplete', missingFiles: downloadError.missingFiles });
    return;
  }

  if (!res.headersSent) {
    res.status(400).json({ error: getPublicErrorMessage(error, '下载生成失败，请稍后再试。') });
  } else {
    res.destroy(error instanceof Error ? error : new Error(String(error)));
  }
}

app.get('/api/projects/:id/download', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-download',
      limit: 30,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  try {
    await sendProjectDownloadArchive(project, parseDownloadQueryOptions(req.query.options), res);
  } catch (error) {
    handleDownloadError(req, res, project, user, error);
  }
});

app.post('/api/projects/:id/download', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-download',
      limit: 30,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const parsed = downloadRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await sendProjectDownloadArchive(project, {
      ...getDefaultDownloadOptions(),
      ...parsed.data
    }, res);
  } catch (error) {
    handleDownloadError(req, res, project, user, error);
  }
});

app.post('/api/projects/:id/download/jobs', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-download',
      limit: 30,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const parsed = downloadRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await assertProjectDownloadAssetsReady(project);
    const { job, reused } = enqueueDownloadJob({
      project,
      userKey: user.userKey,
      options: {
        ...getDefaultDownloadOptions(),
        ...parsed.data
      }
    });
    res.status(reused ? 200 : 202).json({ job, reused });
  } catch (error) {
    handleDownloadError(req, res, project, user, error);
  }
});

app.get('/api/projects/:id/download/jobs/:jobId', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-download-status',
      limit: 180,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const job = getDownloadJob(project.id, String(req.params.jobId ?? ''), user.userKey);
  if (!job) {
    res.status(404).json({ error: '找不到该下载任务。' });
    return;
  }

  res.json({ job });
});

app.delete('/api/projects/:id/download/jobs/:jobId', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'project-download-cancel',
      limit: 30,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const project = store.getProjectForUser(String(req.params.id ?? ''), user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const cancelled = cancelDownloadJob(project.id, String(req.params.jobId ?? ''), user.userKey);
  if (!cancelled) {
    res.status(404).json({ error: '找不到该下载任务。' });
    return;
  }

  res.json({ cancelled: true });
});

app.post('/api/projects/:id/uploads/multipart/init', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'multipart-upload-init',
      limit: 400,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  let directUploadConfig: ReturnType<typeof assertDirectObjectUploadConfigured>;
  try {
    directUploadConfig = assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = multipartUploadInitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    checkDirectUploadTargetLimits([{ size: parsed.data.fileSize }]);
    if (!isSupportedUploadFileName(parsed.data.fileName)) {
      throw new Error('Only RAW and JPG files are supported.');
    }
    if (parsed.data.fileSize > directUploadConfig.maxFileBytes) {
      throw new Error('File is too large for direct upload.');
    }

    const upload = await createDirectObjectMultipartUpload({
      userKey: user.userKey,
      projectId,
      userDisplayName: project.userDisplayName,
      projectName: project.name,
      originalName: normalizeUploadedFileName(parsed.data.fileName),
      mimeType: parsed.data.contentType,
      size: parsed.data.fileSize
    });
    const totalParts = Math.ceil(parsed.data.fileSize / DIRECT_UPLOAD_MULTIPART_PART_SIZE);
    const partUrls = Array.from({ length: totalParts }, (_unused, index: any) =>
      createMultipartUploadPartUrl({
        storageKey: upload.storageKey,
        uploadId: upload.uploadId,
        partNumber: index + 1
      })
    );

    res.json({
      storageKey: upload.storageKey,
      uploadId: upload.uploadId,
      partSize: DIRECT_UPLOAD_MULTIPART_PART_SIZE,
      partUrls
    });
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Could not prepare multipart upload.') });
  }
});

app.post('/api/projects/:id/uploads/multipart/parts/refresh', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'multipart-upload-refresh',
      limit: 800,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  try {
    assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = multipartPartNumbersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (
    !isDirectUploadKeyForProject({
      userKey: user.userKey,
      projectId,
      userDisplayName: project.userDisplayName,
      projectName: project.name,
      storageKey: parsed.data.storageKey
    })
  ) {
    res.status(400).json({ error: '上传密钥与当前项目不匹配。' });
    return;
  }

  const partNumbers = Array.from(new Set(parsed.data.partNumbers)).sort((left: any, right: any) => left - right);
  res.json({
    partUrls: partNumbers.map((partNumber) =>
      createMultipartUploadPartUrl({
        storageKey: parsed.data.storageKey,
        uploadId: parsed.data.uploadId,
        partNumber
      })
    )
  });
});

app.post('/api/projects/:id/uploads/multipart/complete', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'multipart-upload-complete',
      limit: 400,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  let directUploadConfig: ReturnType<typeof assertDirectObjectUploadConfigured>;
  try {
    directUploadConfig = assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = multipartUploadCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    if (!isSupportedUploadFileName(parsed.data.originalName)) {
      throw new Error('Only RAW and JPG files are supported.');
    }
    if (parsed.data.fileSize > directUploadConfig.maxFileBytes) {
      throw new Error('File is too large for direct upload.');
    }
    if (
      !isDirectUploadKeyForProject({
        userKey: user.userKey,
        projectId,
        userDisplayName: project.userDisplayName,
        projectName: project.name,
        storageKey: parsed.data.storageKey
      })
    ) {
      throw new Error('上传密钥与当前项目不匹配。');
    }

    const parts = [...parsed.data.parts].sort((left: any, right: any) => left.partNumber - right.partNumber);
    await completeMultipartObjectUpload({
      storageKey: parsed.data.storageKey,
      uploadId: parsed.data.uploadId,
      parts
    });
    await assertDirectUploadObjectReady({ storageKey: parsed.data.storageKey, expectedSize: parsed.data.fileSize });

    res.json({
      storageKey: parsed.data.storageKey,
      etag: null,
      originalName: normalizeUploadedFileName(parsed.data.originalName),
      size: parsed.data.fileSize,
      mimeType: parsed.data.mimeType
    });
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Could not complete multipart upload.') });
  }
});

app.post('/api/projects/:id/uploads/multipart/abort', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'multipart-upload-abort',
      limit: 400,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  try {
    assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = multipartUploadAbortSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (
    !isDirectUploadKeyForProject({
      userKey: user.userKey,
      projectId,
      userDisplayName: project.userDisplayName,
      projectName: project.name,
      storageKey: parsed.data.storageKey
    })
  ) {
    res.status(400).json({ error: '上传密钥与当前项目不匹配。' });
    return;
  }

  try {
    await abortMultipartObjectUpload({
      storageKey: parsed.data.storageKey,
      uploadId: parsed.data.uploadId
    });
    res.json({ aborted: true });
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Could not abort multipart upload.') });
  }
});

app.post('/api/projects/:id/direct-upload/targets', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'direct-upload-targets',
      limit: 120,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  try {
    assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = directUploadTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    checkDirectUploadTargetLimits(parsed.data.files);
    const targets = parsed.data.files.map((file: any) => {
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
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'direct-upload-complete',
      limit: 120,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const projectId = String(req.params.id ?? '');
  const project = store.getProjectForUser(projectId, user.userKey);
  if (!project) {
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  let directUploadConfig: ReturnType<typeof assertDirectObjectUploadConfigured>;
  try {
    directUploadConfig = assertDirectObjectUploadConfigured();
  } catch {
    res.status(501).json({ error: '上传服务暂未配置，请联系客服。' });
    return;
  }

  const parsed = directUploadCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    checkDirectUploadTargetLimits(parsed.data.files);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Direct upload batch is too large.') });
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
    const downloadInputs = parsed.data.files.map((file: any, index: any) => {
      if (!isSupportedUploadFileName(file.originalName)) {
        throw new Error('Only RAW and JPG files are supported.');
      }
      if (file.size > directUploadConfig.maxFileBytes) {
        throw new Error('File is too large for direct upload.');
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
        throw new Error('上传密钥与当前项目不匹配。');
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

    await runWithConcurrency(downloadInputs, parseDirectUploadCompleteConcurrency(), async (file: any) => {
      await assertDirectUploadObjectReady({ storageKey: file.storageKey, expectedSize: file.size });
    });

    const shouldDownloadToLocalStaging = shouldStageDirectUploadObjectsLocally();
    if (shouldDownloadToLocalStaging) {
      await runWithConcurrency(downloadInputs, parseDirectUploadCompleteConcurrency(), async (file: any) => {
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
      res.status(404).json({ error: '找不到该项目。' });
      return;
    }

    respondWithProject(res, updated);
  } catch (error) {
    res.status(400).json({ error: getPublicErrorMessage(error, 'Direct upload completion failed.') });
  }
});

app.post('/api/projects/:id/files', (req, res, next) => {
  if (!isLocalProxyUploadEnabled()) {
    res.status(409).json({ error: '该操作需要使用云端直传模式。' });
    return;
  }

  upload!.array('files')(req, res, (error: unknown) => {
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
    res.status(404).json({ error: '找不到该项目。' });
    return;
  }

  const uploadedFiles = (req.files ?? []) as Express.Multer.File[];
  if (!uploadedFiles.length) {
    res.status(400).json({ error: '未检测到上传的文件。' });
    return;
  }

  store.updateProject(projectId, (current) => ({
    ...current,
    status: 'uploading',
    currentStep: 3
  }));

  const updated = store.getProjectForUser(projectId, user.userKey);
  if (!updated) {
    res.status(404).json({ error: '找不到该项目。' });
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
    if (parsed.data.inputComplete) {
      const missingSourceNames = collectMissingExposureSourceNames(
        projectHdrItemsAfterLayout(project, hdrItems, parsed.data.mode)
      );
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
