import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ExposureFile, HdrItem, ProjectRecord } from './types.js';
import { analyzeHdrGroups, readGroupingFrames, type GroupingFrame } from './grouping.js';
import { extractPreviewOrConvertToJpeg } from './images.js';
import type { LocalStore } from './store.js';
import { getFileStem, isRawExtension } from './utils.js';

export interface FrontendHdrLayoutItem {
  exposureOriginalNames: string[];
  selectedOriginalName?: string | null;
  exposures?: FrontendHdrLayoutExposure[];
}

export interface FrontendHdrLayoutExposure {
  originalName: string;
  fileName?: string;
  extension?: string;
  mimeType?: string;
  size?: number;
  isRaw?: boolean;
  storageKey?: string | null;
  captureTime?: string | null;
  sequenceNumber?: number | null;
  exposureCompensation?: number | null;
  exposureSeconds?: number | null;
  iso?: number | null;
  fNumber?: number | null;
  focalLength?: number | null;
}

interface DirectUploadManifestEntry {
  originalName?: string;
  localPath?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
}

const DIRECT_UPLOAD_MANIFEST_FILE = '.metrovan-direct-upload-manifest.json';

function pickDefaultExposure(exposures: ExposureFile[]) {
  const byPlusOne = exposures
    .filter((exposure) => exposure.exposureCompensation !== null)
    .sort(
      (left, right) =>
        Math.abs((left.exposureCompensation as number) - 1) -
        Math.abs((right.exposureCompensation as number) - 1)
    );
  if (byPlusOne[0]) {
    return byPlusOne[0];
  }

  const byNormal = exposures
    .filter((exposure) => exposure.exposureCompensation !== null)
    .sort(
      (left, right) =>
        Math.abs(left.exposureCompensation as number) -
        Math.abs(right.exposureCompensation as number)
    );
  if (byNormal[0]) {
    return byNormal[0];
  }

  return exposures[Math.floor(exposures.length / 2)] ?? exposures[0] ?? null;
}

export async function buildHdrItemsFromOriginals(project: ProjectRecord, store: LocalStore) {
  return await buildHdrItemsFromSourceFiles(project, store, store.listProjectOriginals(project));
}

export async function buildHdrItemsFromSourceFiles(
  project: ProjectRecord,
  store: LocalStore,
  sourceFiles: string[]
) {
  const dirs = store.ensureProjectDirectories(project);

  if (fs.existsSync(dirs.previews)) {
    fs.rmSync(dirs.previews, { recursive: true, force: true });
  }
  fs.mkdirSync(dirs.previews, { recursive: true });

  const grouping = await analyzeHdrGroups(sourceFiles);
  const hdrItems: HdrItem[] = [];

  for (const group of grouping.groups) {
    const exposures: ExposureFile[] = [];
    const hdrItemId = nanoid(10);
    const itemPreviewDir = path.join(dirs.previews, hdrItemId);
    fs.mkdirSync(itemPreviewDir, { recursive: true });

    for (const frame of group.frames) {
      const extension = path.extname(frame.path).toLowerCase();
      const previewPath = path.join(itemPreviewDir, `${getFileStem(frame.name)}.jpg`);
      await extractPreviewOrConvertToJpeg(frame.path, previewPath, 88, 1600);
      exposures.push({
        id: nanoid(10),
        fileName: path.basename(frame.path),
        originalName: frame.name,
        extension,
        mimeType: isRawExtension(extension) ? 'image/x-raw' : 'image/jpeg',
        size: fs.statSync(frame.path).size,
        isRaw: isRawExtension(extension),
        storageKey: store.toStorageKey(frame.path),
        storagePath: frame.path,
        storageUrl: store.toStorageUrl(frame.path),
        previewKey: store.toStorageKey(previewPath),
        previewPath,
        previewUrl: store.toStorageUrl(previewPath),
        captureTime: frame.captureTime,
        sequenceNumber: frame.sequenceNumber,
        exposureCompensation: frame.exposureCompensation,
        exposureSeconds: frame.exposureSeconds,
        iso: frame.iso,
        fNumber: frame.fNumber,
        focalLength: frame.focalLength
      });
    }

    const defaultExposure = pickDefaultExposure(exposures);
    hdrItems.push({
      id: hdrItemId,
      index: group.index,
      title: `HDR ${group.index}`,
      groupId: '',
      sceneType: 'pending',
      selectedExposureId: defaultExposure?.id ?? exposures[0]?.id ?? '',
      previewUrl: defaultExposure?.previewUrl ?? exposures[0]?.previewUrl ?? null,
      status: 'review',
      statusText: '待确认',
      errorMessage: null,
      mergedPath: null,
      mergedUrl: null,
      resultPath: null,
      resultUrl: null,
      resultFileName: null,
      exposures
    });
  }

  return hdrItems;
}

function normalizeFileIdentity(fileName: string) {
  return path.basename(fileName).trim().toLowerCase();
}

function normalizeExtension(value: string | undefined, fileName: string) {
  const candidate = value?.trim() || path.extname(fileName);
  if (!candidate) {
    return '';
  }
  return candidate.startsWith('.') ? candidate.toLowerCase() : `.${candidate.toLowerCase()}`;
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function createExposurePreviewUrl(projectId: string, hdrItemId: string, exposureId: string) {
  return `/api/projects/${projectId}/hdr-items/${hdrItemId}/exposures/${exposureId}/preview`;
}

function readDirectUploadManifest(manifestPath: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { files?: DirectUploadManifestEntry[] };
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    return [];
  }
}

function collectDirectUploadStorageKeys(stagingRoot: string) {
  const byPath = new Map<string, string>();
  const byName = new Map<string, DirectUploadManifestEntry[]>();

  const visit = (directory: string) => {
    if (!fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || entry.name !== DIRECT_UPLOAD_MANIFEST_FILE) {
        continue;
      }

      for (const file of readDirectUploadManifest(entryPath)) {
        if (!file.storageKey) {
          continue;
        }

        if (file.localPath) {
          byPath.set(path.resolve(file.localPath).toLowerCase(), file.storageKey);
        }

        if (file.originalName) {
          const normalizedName = normalizeFileIdentity(file.originalName);
          byName.set(normalizedName, [...(byName.get(normalizedName) ?? []), file]);
        }
      }
    }
  };

  visit(stagingRoot);
  return { byPath, byName };
}

function resolveDirectUploadStorageKey(
  frame: GroupingFrame,
  directUploadKeys: ReturnType<typeof collectDirectUploadStorageKeys>
) {
  const exact = directUploadKeys.byPath.get(path.resolve(frame.path).toLowerCase());
  if (exact) {
    return exact;
  }

  const byName = directUploadKeys.byName.get(normalizeFileIdentity(frame.name));
  return byName?.length === 1 ? byName[0]?.storageKey ?? null : null;
}

function takeDirectUploadManifestEntry(
  fileName: string,
  directUploadKeys: ReturnType<typeof collectDirectUploadStorageKeys>
) {
  const matches = directUploadKeys.byName.get(normalizeFileIdentity(fileName));
  return matches?.shift() ?? null;
}

async function createExposureFromFrame(
  project: ProjectRecord,
  store: LocalStore,
  frame: GroupingFrame,
  itemPreviewDir: string,
  directUploadKeys: ReturnType<typeof collectDirectUploadStorageKeys>
) {
  const extension = path.extname(frame.path).toLowerCase();
  const previewPath = path.join(itemPreviewDir, `${getFileStem(frame.name)}.jpg`);
  await extractPreviewOrConvertToJpeg(frame.path, previewPath, 88, 1600);
  const storageKey = resolveDirectUploadStorageKey(frame, directUploadKeys) ?? store.toStorageKey(frame.path);

  return {
    id: nanoid(10),
    fileName: path.basename(frame.path),
    originalName: frame.name,
    extension,
    mimeType: isRawExtension(extension) ? 'image/x-raw' : 'image/jpeg',
    size: fs.statSync(frame.path).size,
    isRaw: isRawExtension(extension),
    storageKey,
    storagePath: frame.path,
    storageUrl: store.toStorageUrl(frame.path),
    previewKey: store.toStorageKey(previewPath),
    previewPath,
    previewUrl: store.toStorageUrl(previewPath),
    captureTime: frame.captureTime,
    sequenceNumber: frame.sequenceNumber,
    exposureCompensation: frame.exposureCompensation,
    exposureSeconds: frame.exposureSeconds,
    iso: frame.iso,
    fNumber: frame.fNumber,
    focalLength: frame.focalLength
  } satisfies ExposureFile;
}

function createExposureFromFrontendMetadata(input: {
  project: ProjectRecord;
  store: LocalStore;
  hdrItemId: string;
  exposure: FrontendHdrLayoutExposure;
  fallbackOriginalName: string;
  itemPreviewDir: string;
  directUploadKeys: ReturnType<typeof collectDirectUploadStorageKeys>;
}) {
  const originalName = path.basename(input.exposure.originalName || input.fallbackOriginalName || 'source');
  const fileName = path.basename(input.exposure.fileName || originalName);
  const manifestEntry = takeDirectUploadManifestEntry(originalName, input.directUploadKeys);
  const storageKey = manifestEntry?.storageKey ?? undefined;
  const dirs = input.store.ensureProjectDirectories(input.project);
  const localPath =
    manifestEntry?.localPath ??
    path.join(dirs.staging, 'frontend-layout', `${nanoid(8)}-${fileName || originalName}`);
  const extension = normalizeExtension(input.exposure.extension, fileName || originalName);
  const exposureId = nanoid(10);
  const previewPath = path.join(input.itemPreviewDir, `${getFileStem(fileName || originalName)}-${exposureId}.jpg`);
  const previewUrl = createExposurePreviewUrl(input.project.id, input.hdrItemId, exposureId);

  return {
    id: exposureId,
    fileName,
    originalName,
    extension,
    mimeType:
      manifestEntry?.mimeType ||
      input.exposure.mimeType ||
      (isRawExtension(extension) ? 'image/x-raw' : 'image/jpeg'),
    size: manifestEntry?.size ?? input.exposure.size ?? 1,
    isRaw: input.exposure.isRaw ?? isRawExtension(extension),
    storageKey,
    storagePath: localPath,
    storageUrl: storageKey ? input.store.toStorageUrlFromKey(storageKey) : input.store.toStorageUrl(localPath),
    previewKey: null,
    previewPath,
    previewUrl,
    captureTime: input.exposure.captureTime ?? null,
    sequenceNumber: input.exposure.sequenceNumber ?? null,
    exposureCompensation: normalizeNullableNumber(input.exposure.exposureCompensation),
    exposureSeconds: normalizeNullableNumber(input.exposure.exposureSeconds),
    iso: normalizeNullableNumber(input.exposure.iso),
    fNumber: normalizeNullableNumber(input.exposure.fNumber),
    focalLength: normalizeNullableNumber(input.exposure.focalLength)
  } satisfies ExposureFile;
}

async function buildHdrItemsFromFrontendMetadata(
  project: ProjectRecord,
  store: LocalStore,
  layout: FrontendHdrLayoutItem[],
  directUploadKeys: ReturnType<typeof collectDirectUploadStorageKeys>
) {
  const dirs = store.ensureProjectDirectories(project);
  if (fs.existsSync(dirs.previews)) {
    fs.rmSync(dirs.previews, { recursive: true, force: true });
  }
  fs.mkdirSync(dirs.previews, { recursive: true });

  const hdrItems: HdrItem[] = [];
  for (const item of layout) {
    const metadataExposures =
      item.exposures?.length
        ? item.exposures
        : item.exposureOriginalNames.map((originalName) => ({ originalName }));
    if (!metadataExposures.length) {
      continue;
    }

    const hdrItemId = nanoid(10);
    const itemPreviewDir = path.join(dirs.previews, hdrItemId);
    fs.mkdirSync(itemPreviewDir, { recursive: true });

    const exposures = metadataExposures.map((exposure, index) =>
      createExposureFromFrontendMetadata({
        project,
        store,
        hdrItemId,
        exposure,
        fallbackOriginalName: item.exposureOriginalNames[index] ?? exposure.originalName,
        itemPreviewDir,
        directUploadKeys
      })
    );
    const selectedName = normalizeFileIdentity(item.selectedOriginalName ?? '');
    const selectedExposure =
      exposures.find((exposure) => normalizeFileIdentity(exposure.originalName) === selectedName) ??
      pickDefaultExposure(exposures) ??
      exposures[0] ??
      null;
    const index = hdrItems.length + 1;
    hdrItems.push({
      id: hdrItemId,
      index,
      title: `HDR ${index}`,
      groupId: '',
      sceneType: 'pending',
      selectedExposureId: selectedExposure?.id ?? exposures[0]?.id ?? '',
      previewUrl: selectedExposure?.previewUrl ?? exposures[0]?.previewUrl ?? null,
      status: 'review',
      statusText: '待确认',
      errorMessage: null,
      mergedPath: null,
      mergedUrl: null,
      resultPath: null,
      resultUrl: null,
      resultFileName: null,
      exposures
    });
  }

  return hdrItems;
}

export async function buildHdrItemsFromFrontendLayout(
  project: ProjectRecord,
  store: LocalStore,
  sourceFiles: string[],
  layout: FrontendHdrLayoutItem[]
) {
  const dirs = store.ensureProjectDirectories(project);
  const directUploadKeys = collectDirectUploadStorageKeys(dirs.staging);
  const canUseFrontendMetadata = layout.some((item) => item.exposures?.length) && sourceFiles.length === 0;
  if (canUseFrontendMetadata) {
    return await buildHdrItemsFromFrontendMetadata(project, store, layout, directUploadKeys);
  }

  if (fs.existsSync(dirs.previews)) {
    fs.rmSync(dirs.previews, { recursive: true, force: true });
  }
  fs.mkdirSync(dirs.previews, { recursive: true });

  const frames = await readGroupingFrames(sourceFiles);
  const framesByName = new Map(frames.map((frame) => [normalizeFileIdentity(frame.name), frame]));
  const usedNames = new Set<string>();
  const hdrItems: HdrItem[] = [];

  const appendItem = async (framesForItem: GroupingFrame[], selectedOriginalName: string | null | undefined) => {
    if (!framesForItem.length) {
      return;
    }

    const hdrItemId = nanoid(10);
    const itemPreviewDir = path.join(dirs.previews, hdrItemId);
    fs.mkdirSync(itemPreviewDir, { recursive: true });

    const exposures: ExposureFile[] = [];
    for (const frame of framesForItem) {
      usedNames.add(normalizeFileIdentity(frame.name));
      exposures.push(await createExposureFromFrame(project, store, frame, itemPreviewDir, directUploadKeys));
    }

    const selectedName = normalizeFileIdentity(selectedOriginalName ?? '');
    const selectedExposure =
      exposures.find((exposure) => normalizeFileIdentity(exposure.originalName) === selectedName) ??
      pickDefaultExposure(exposures) ??
      exposures[0] ??
      null;
    const index = hdrItems.length + 1;
    hdrItems.push({
      id: hdrItemId,
      index,
      title: `HDR ${index}`,
      groupId: '',
      sceneType: 'pending',
      selectedExposureId: selectedExposure?.id ?? exposures[0]?.id ?? '',
      previewUrl: selectedExposure?.previewUrl ?? exposures[0]?.previewUrl ?? null,
      status: 'review',
      statusText: '待确认',
      errorMessage: null,
      mergedPath: null,
      mergedUrl: null,
      resultPath: null,
      resultUrl: null,
      resultFileName: null,
      exposures
    });
  };

  for (const item of layout) {
    const framesForItem = item.exposureOriginalNames
      .map((name) => framesByName.get(normalizeFileIdentity(name)) ?? null)
      .filter((frame): frame is GroupingFrame => Boolean(frame));
    await appendItem(framesForItem, item.selectedOriginalName);
  }

  const unusedFrames = frames.filter((frame) => !usedNames.has(normalizeFileIdentity(frame.name)));
  for (const frame of unusedFrames) {
    await appendItem([frame], frame.name);
  }

  return hdrItems;
}
