import express from 'express';
import type { ProjectRecord } from '../types.js';
import type { RouteContext } from './context.js';

export function createProjectResultsRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    RESULT_THUMBNAIL_URL_TTL_SECONDS,
    checkUserRateLimit,
    ensureResultAssetPreviewFile,
    ensureResultThumbnailManifestItem,
    getOwnedProjectFromRequest,
    logServerEvent,
    runWithConcurrency,
    sendCachedPreviewFile,
    sendProtectedStorageFile
  } = ctx;

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

app.get('/api/projects/:id/results/:resultAssetId/file', async (req, res) => {
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

  return app;
}
