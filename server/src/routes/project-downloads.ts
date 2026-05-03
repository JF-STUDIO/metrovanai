import express from 'express';
import type { ProjectRecord } from '../types.js';
import type { RouteContext } from './context.js';

export function createProjectDownloadsRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    assertProjectDownloadAssetsReady,
    cancelDownloadJob,
    checkUserRateLimit,
    downloadRequestSchema,
    enqueueDownloadJob,
    getDefaultDownloadOptions,
    getDownloadJob,
    getProjectDownloadFileName,
    getPublicErrorMessage,
    requireAuthenticatedUser,
    sanitizeSegment,
    store,
    streamProjectDownloadArchive,
    writeSecurityAuditLog,
    DownloadIncompleteError
  } = ctx;

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

  return app;
}
