import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { RouteContext } from './context.js';

export function createProjectUploadsRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    DIRECT_UPLOAD_MANIFEST_FILE,
    DIRECT_UPLOAD_MULTIPART_PART_SIZE,
    abortMultipartObjectUpload,
    assertDirectObjectUploadConfigured,
    assertDirectUploadObjectReady,
    checkDirectUploadTargetLimits,
    checkUserRateLimit,
    completeMultipartObjectUpload,
    createDirectObjectMultipartUpload,
    createDirectObjectUploadTarget,
    createMultipartUploadPartUrl,
    createUploadBatchId,
    directUploadCompleteSchema,
    directUploadTargetSchema,
    downloadDirectObjectToFile,
    getPublicErrorMessage,
    isDirectUploadKeyForProject,
    isLocalProxyUploadEnabled,
    isSupportedUploadFileName,
    multipartPartNumbersSchema,
    multipartUploadAbortSchema,
    multipartUploadCompleteSchema,
    multipartUploadInitSchema,
    normalizeUploadedFileName,
    parseDirectUploadCompleteConcurrency,
    requireAuthenticatedUser,
    respondWithProject,
    runWithConcurrency,
    shouldStageDirectUploadObjectsLocally,
    store,
    upload
  } = ctx;

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

  return app;
}
