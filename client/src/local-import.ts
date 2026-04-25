import type {
  ColorMode,
  ExposureFile,
  HdrItem,
  LocalImportMetadataState,
  LocalImportPreviewState,
  LocalImportReviewState,
  ProjectGroup,
  SceneType
} from './types';

const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.nef', '.dng', '.raf', '.rw2', '.orf', '.srw']);
const JPEG_EXTENSIONS = new Set(['.jpg', '.jpeg']);
export const IMPORT_FILE_ACCEPT = [...RAW_EXTENSIONS, ...JPEG_EXTENSIONS].join(',');

let exifrModulePromise: Promise<typeof import('exifr')> | null = null;

function loadExifr() {
  exifrModulePromise ??= import('exifr');
  return exifrModulePromise;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isSupportedImportFile(file: File) {
  const extension = getFileExtension(file.name);
  return RAW_EXTENSIONS.has(extension) || JPEG_EXTENSIONS.has(extension);
}

export function filterSupportedImportFiles(files: File[]) {
  const supported: File[] = [];
  const unsupported: File[] = [];
  for (const file of files) {
    if (isSupportedImportFile(file)) {
      supported.push(file);
    } else {
      unsupported.push(file);
    }
  }
  return { supported, unsupported };
}

interface GroupingFrame {
  file: File;
  name: string;
  extension: string;
  sequenceNumber: number | null;
  captureTime: string | null;
  exposureSeconds: number;
  exposureCompensation: number | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  cameraModel: string;
  serialNumber: string;
  width: number | null;
  height: number | null;
  orientation: string;
  bracketSequence: string;
  burstId: string;
  previewUrl: string | null;
  metadataState: LocalImportMetadataState;
  previewState: LocalImportPreviewState;
  canAutoGroup: boolean;
}

export interface LocalExposureDraft extends ExposureFile {
  file: File;
  objectUrl: string | null;
}

export interface LocalHdrItemDraft extends Omit<HdrItem, 'exposures'> {
  exposures: LocalExposureDraft[];
}

export interface LocalImportDraft {
  projectId: string;
  hdrItems: LocalHdrItemDraft[];
  groups: ProjectGroup[];
  objectUrls: string[];
  diagnostics: {
    totalFiles: number;
    previewReadyCount: number;
    previewMissingCount: number;
    metadataReadyCount: number;
    metadataMissingCount: number;
    manualReviewCount: number;
  };
}

const defaultGroupingConfig = {
  gapSeconds: 3,
  spanSeconds: 12,
  aspectRatioTolerance: 1.25,
  fNumberTolerance: 0.6,
  isoRatioTolerance: 2.2,
  focalLengthTolerance: 6,
  scoreThreshold: 6,
  minExposureStepEv: 0.7,
  maxSequenceGapInGroup: 2
} as const;

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isRawFile(fileName: string) {
  return RAW_EXTENSIONS.has(getFileExtension(fileName));
}

function isJpegFile(fileName: string) {
  return JPEG_EXTENSIONS.has(getFileExtension(fileName));
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function parseDateValue(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T').replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseSequenceFromName(fileName: string) {
  const match = fileName.match(/(?:^|[_-])(\d{3,})(?:[_-]|$)/);
  return match ? Number(match[1]) : null;
}

function hasUsableExifMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return false;
  }

  const candidateFields = [
    metadata.SubSecDateTimeOriginal,
    metadata.DateTimeOriginal,
    metadata.CreateDate,
    metadata.ExposureBiasValue,
    metadata.ExposureCompensation,
    metadata.ExposureTime,
    metadata.ShutterSpeedValue,
    metadata.ISO,
    metadata.FNumber,
    metadata.ApertureValue,
    metadata.FocalLength,
    metadata.Model,
    metadata.SerialNumber,
    metadata.ExifImageWidth,
    metadata.ImageWidth,
    metadata.ExifImageHeight,
    metadata.ImageHeight,
    metadata.Orientation,
    metadata.SequenceNumber,
    metadata.BurstUUID,
    metadata.BracketSequence,
    metadata.BracketShotNumber
  ];

  return candidateFields.some((value) => value !== null && value !== undefined && value !== '');
}

function compareFrames(left: GroupingFrame, right: GroupingFrame) {
  const timeCompare = (left.captureTime ?? '').localeCompare(right.captureTime ?? '');
  if (timeCompare !== 0) {
    return timeCompare;
  }

  const sequenceCompare = (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0);
  if (sequenceCompare !== 0) {
    return sequenceCompare;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function closeEnough(left: number | null, right: number | null, tolerance: number) {
  return left === null || right === null || Math.abs(left - right) <= tolerance;
}

function ratioClose(left: number | null, right: number | null, tolerance: number) {
  if (left === null || right === null) {
    return true;
  }

  const min = Math.min(left, right);
  const max = Math.max(left, right);
  return min <= 0 ? true : max / min <= tolerance;
}

function aspectRatio(frame: GroupingFrame) {
  if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) {
    return null;
  }

  return frame.width / frame.height;
}

function exposureStepEv(left: GroupingFrame, right: GroupingFrame) {
  if (left.exposureCompensation !== null && right.exposureCompensation !== null) {
    return Math.abs(right.exposureCompensation - left.exposureCompensation);
  }

  if (left.exposureSeconds > 0 && right.exposureSeconds > 0) {
    return Math.abs(Math.log2(right.exposureSeconds / left.exposureSeconds));
  }

  return null;
}

function sequenceGap(left: GroupingFrame, right: GroupingFrame) {
  if (left.sequenceNumber === null || right.sequenceNumber === null) {
    return null;
  }

  return right.sequenceNumber - left.sequenceNumber;
}

function matchScore(left: GroupingFrame, right: GroupingFrame) {
  let score = 0;

  if (left.cameraModel && left.cameraModel.toLowerCase() === right.cameraModel.toLowerCase()) score += 1;
  if (left.serialNumber && left.serialNumber.toLowerCase() === right.serialNumber.toLowerCase()) score += 1;
  if (left.orientation && left.orientation.toLowerCase() === right.orientation.toLowerCase()) score += 1;
  if (ratioClose(aspectRatio(left), aspectRatio(right), defaultGroupingConfig.aspectRatioTolerance)) score += 1;
  if (closeEnough(left.focalLength, right.focalLength, defaultGroupingConfig.focalLengthTolerance)) score += 1;
  if (closeEnough(left.fNumber, right.fNumber, defaultGroupingConfig.fNumberTolerance)) score += 1;
  if (ratioClose(left.iso, right.iso, defaultGroupingConfig.isoRatioTolerance)) score += 1;
  if (left.burstId && left.burstId.toLowerCase() === right.burstId.toLowerCase()) score += 1;
  if (left.bracketSequence && left.bracketSequence.toLowerCase() === right.bracketSequence.toLowerCase()) score += 1;

  const gap = sequenceGap(left, right);
  const step = exposureStepEv(left, right);
  if (
    score === defaultGroupingConfig.scoreThreshold - 1 &&
    gap !== null &&
    gap > 0 &&
    gap <= defaultGroupingConfig.maxSequenceGapInGroup &&
    step !== null &&
    step >= defaultGroupingConfig.minExposureStepEv
  ) {
    score += 1;
  }

  return score;
}

async function parseGroupingFrame(file: File) {
  const extension = getFileExtension(file.name);
  const exifr = (await loadExifr()).default;
  const metadata = (await exifr.parse(file, {
    tiff: true,
    ifd0: {},
    ifd1: true,
    exif: true,
    gps: false,
    interop: false,
    makerNote: false,
    userComment: false,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false
  }).catch(() => null)) as Record<string, unknown> | null;
  const metadataState: LocalImportMetadataState = hasUsableExifMetadata(metadata) ? 'exif' : 'fallback';

  let previewUrl = await exifr.thumbnailUrl(file).catch(() => undefined);
  if (!previewUrl && isJpegFile(file.name)) {
    previewUrl = URL.createObjectURL(file);
  }
  const previewState: LocalImportPreviewState = previewUrl ? 'ready' : 'missing';

  return {
    file,
    name: file.name,
    extension,
    sequenceNumber: parseNullableNumber(metadata?.SequenceNumber) ?? parseSequenceFromName(file.name),
    captureTime:
      parseDateValue(metadata?.SubSecDateTimeOriginal) ??
      parseDateValue(metadata?.DateTimeOriginal) ??
      parseDateValue(metadata?.CreateDate) ??
      new Date(file.lastModified).toISOString(),
    exposureSeconds:
      parseNullableNumber(metadata?.ExposureTime) ??
      parseNullableNumber(metadata?.ShutterSpeedValue) ??
      0,
    exposureCompensation:
      parseNullableNumber(metadata?.ExposureBiasValue) ??
      parseNullableNumber(metadata?.ExposureCompensation),
    iso: parseNullableNumber(metadata?.ISO),
    fNumber: parseNullableNumber(metadata?.FNumber) ?? parseNullableNumber(metadata?.ApertureValue),
    focalLength: parseNullableNumber(metadata?.FocalLength),
    cameraModel: String(metadata?.Model ?? '').trim(),
    serialNumber: String(metadata?.SerialNumber ?? '').trim(),
    width: parseNullableNumber(metadata?.ExifImageWidth) ?? parseNullableNumber(metadata?.ImageWidth),
    height: parseNullableNumber(metadata?.ExifImageHeight) ?? parseNullableNumber(metadata?.ImageHeight),
    orientation: String(metadata?.Orientation ?? '').trim(),
    bracketSequence: String(metadata?.BracketSequence ?? metadata?.BracketShotNumber ?? '').trim(),
    burstId: String(metadata?.BurstUUID ?? '').trim(),
    previewUrl: previewUrl ?? null,
    metadataState,
    previewState,
    canAutoGroup: metadataState === 'exif'
  } satisfies GroupingFrame;
}

function analyzeHdrGroups(frames: GroupingFrame[]) {
  const sorted = [...frames].sort(compareFrames);
  const groups: Array<{ index: number; frames: GroupingFrame[] }> = [];
  let current: GroupingFrame[] = [];
  let startTime: Date | null = null;
  let previous: GroupingFrame | null = null;

  for (const next of sorted) {
    if (!next.canAutoGroup) {
      if (current.length > 0) {
        groups.push({ index: groups.length + 1, frames: current });
        current = [];
        startTime = null;
        previous = null;
      }
      groups.push({ index: groups.length + 1, frames: [next] });
      continue;
    }

    if (!current.length) {
      current = [next];
      startTime = new Date(next.captureTime as string);
      previous = next;
      continue;
    }

    const dtPrev =
      (new Date(next.captureTime as string).getTime() - new Date((previous as GroupingFrame).captureTime as string).getTime()) / 1000;
    const dtSpan =
      (new Date(next.captureTime as string).getTime() - (startTime as Date).getTime()) / 1000;
    const score = matchScore(previous as GroupingFrame, next);
    const split =
      dtPrev > defaultGroupingConfig.gapSeconds ||
      dtSpan > defaultGroupingConfig.spanSeconds ||
      score < defaultGroupingConfig.scoreThreshold;

    if (split) {
      groups.push({ index: groups.length + 1, frames: current });
      current = [next];
      startTime = new Date(next.captureTime as string);
    } else {
      current.push(next);
    }

    previous = next;
  }

  if (current.length > 0) {
    groups.push({ index: groups.length + 1, frames: current });
  }

  return groups;
}

function getExposureReviewState(frame: GroupingFrame): LocalImportReviewState {
  if (frame.metadataState === 'fallback') {
    return 'manual-review';
  }

  if (frame.previewState === 'missing') {
    return 'preview-missing';
  }

  return 'normal';
}

function getHdrItemReviewState(exposures: LocalExposureDraft[]): LocalImportReviewState {
  if (exposures.some((exposure) => exposure.localReviewState === 'manual-review')) {
    return 'manual-review';
  }

  if (exposures.some((exposure) => exposure.localReviewState === 'preview-missing')) {
    return 'preview-missing';
  }

  return 'normal';
}

function pickDefaultExposure(exposures: LocalExposureDraft[]) {
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

export async function buildLocalImportDraft(
  projectId: string,
  files: File[],
  onProgress?: (progressPercent: number) => void
) {
  const frames: GroupingFrame[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    frames.push(await parseGroupingFrame(file));
    onProgress?.(Math.round(((index + 1) / files.length) * 100));
  }

  const objectUrls = frames
    .map((frame) => frame.previewUrl)
    .filter((value): value is string => Boolean(value));

  const pendingGroupId = createId();
  const hdrGroups = analyzeHdrGroups(frames);
  const hdrItems: LocalHdrItemDraft[] = hdrGroups.map((group) => {
    const exposures: LocalExposureDraft[] = group.frames.map((frame) => ({
      id: createId(),
      fileName: frame.file.name,
      originalName: frame.name,
      extension: frame.extension,
      mimeType: frame.file.type || (isJpegFile(frame.file.name) ? 'image/jpeg' : 'image/x-raw'),
      size: frame.file.size,
      isRaw: isRawFile(frame.file.name),
      previewUrl: frame.previewUrl,
      captureTime: frame.captureTime,
      sequenceNumber: frame.sequenceNumber,
      exposureCompensation: frame.exposureCompensation,
      exposureSeconds: frame.exposureSeconds,
      iso: frame.iso,
      fNumber: frame.fNumber,
      focalLength: frame.focalLength,
      localPreviewState: frame.previewState,
      localMetadataState: frame.metadataState,
      localReviewState: getExposureReviewState(frame),
      file: frame.file,
      objectUrl: frame.previewUrl
    }));
    const defaultExposure = pickDefaultExposure(exposures);
    const localReviewState = getHdrItemReviewState(exposures);
    return {
      id: createId(),
      index: group.index,
      title: `HDR ${group.index}`,
      groupId: pendingGroupId,
      sceneType: 'pending' satisfies SceneType,
      selectedExposureId: defaultExposure?.id ?? exposures[0]?.id ?? '',
      previewUrl: defaultExposure?.previewUrl ?? exposures[0]?.previewUrl ?? null,
      status: 'review',
      statusText: '待确认',
      errorMessage: null,
      resultUrl: null,
      resultFileName: null,
      localReviewState,
      exposures
    };
  });

  const groups: ProjectGroup[] = [
    {
      id: pendingGroupId,
      index: 1,
      name: '第1组',
      sceneType: 'pending',
      colorMode: 'default' satisfies ColorMode,
      replacementColor: null,
      hdrItemIds: hdrItems.map((item) => item.id)
    }
  ];

  return {
    projectId,
    hdrItems,
    groups,
    objectUrls,
    diagnostics: {
      totalFiles: frames.length,
      previewReadyCount: frames.filter((frame) => frame.previewState === 'ready').length,
      previewMissingCount: frames.filter((frame) => frame.previewState === 'missing').length,
      metadataReadyCount: frames.filter((frame) => frame.metadataState === 'exif').length,
      metadataMissingCount: frames.filter((frame) => frame.metadataState === 'fallback').length,
      manualReviewCount: frames.filter((frame) => frame.metadataState === 'fallback').length
    }
  } satisfies LocalImportDraft;
}

export function revokeLocalImportDraftUrls(draft: LocalImportDraft | null | undefined) {
  for (const url of draft?.objectUrls ?? []) {
    URL.revokeObjectURL(url);
  }
}

const LOCAL_IMPORT_DB_NAME = 'metrovanai-local-imports';
const LOCAL_IMPORT_DB_VERSION = 1;
const LOCAL_IMPORT_STORE_NAME = 'drafts';

interface StoredLocalImportRecord {
  projectId: string;
  updatedAt: string;
  draft: LocalImportDraft;
}

function hasIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openLocalImportDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = window.indexedDB.open(LOCAL_IMPORT_DB_NAME, LOCAL_IMPORT_DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_IMPORT_STORE_NAME)) {
        db.createObjectStore(LOCAL_IMPORT_STORE_NAME, { keyPath: 'projectId' });
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('Failed to open local import storage.')));
  });
}

function runLocalImportStore<T>(
  mode: IDBTransactionMode,
  runner: (store: IDBObjectStore) => IDBRequest<T> | void
) {
  return new Promise<T | undefined>((resolve, reject) => {
    void openLocalImportDb()
      .then((db) => {
        const transaction = db.transaction(LOCAL_IMPORT_STORE_NAME, mode);
        const store = transaction.objectStore(LOCAL_IMPORT_STORE_NAME);
        const request = runner(store);
        let result: T | undefined;

        if (request) {
          request.addEventListener('success', () => {
            result = request.result;
          });
          request.addEventListener('error', () => reject(request.error ?? new Error('Local import storage request failed.')));
        }

        transaction.addEventListener('complete', () => {
          db.close();
          resolve(result);
        });
        transaction.addEventListener('error', () => {
          db.close();
          reject(transaction.error ?? new Error('Local import storage transaction failed.'));
        });
        transaction.addEventListener('abort', () => {
          db.close();
          reject(transaction.error ?? new Error('Local import storage transaction aborted.'));
        });
      })
      .catch(reject);
  });
}

function serializeLocalImportDraft(draft: LocalImportDraft): LocalImportDraft {
  return {
    ...draft,
    objectUrls: [],
    hdrItems: draft.hdrItems.map((item) => ({
      ...item,
      previewUrl: null,
      exposures: item.exposures.map((exposure) => ({
        ...exposure,
        previewUrl: null,
        objectUrl: null
      }))
    }))
  };
}

async function createPreviewUrl(file: File) {
  const exifr = (await loadExifr()).default;
  let previewUrl = await exifr.thumbnailUrl(file).catch(() => undefined);
  if (!previewUrl && isJpegFile(file.name)) {
    previewUrl = URL.createObjectURL(file);
  }
  return previewUrl ?? null;
}

export async function persistLocalImportDraft(draft: LocalImportDraft) {
  if (!hasIndexedDb()) {
    return;
  }

  const record: StoredLocalImportRecord = {
    projectId: draft.projectId,
    updatedAt: new Date().toISOString(),
    draft: serializeLocalImportDraft(draft)
  };
  await runLocalImportStore('readwrite', (store) => store.put(record));
}

export async function deleteStoredLocalImportDraft(projectId: string) {
  if (!hasIndexedDb()) {
    return;
  }

  await runLocalImportStore('readwrite', (store) => store.delete(projectId));
}

export async function restoreStoredLocalImportDraft(projectId: string) {
  if (!hasIndexedDb()) {
    return null;
  }

  const record = await runLocalImportStore<StoredLocalImportRecord>('readonly', (store) => store.get(projectId));
  if (!record?.draft) {
    return null;
  }

  const objectUrls: string[] = [];
  const hdrItems: LocalHdrItemDraft[] = [];
  for (const item of record.draft.hdrItems) {
    const exposures: LocalExposureDraft[] = [];
    for (const exposure of item.exposures) {
      const previewUrl = await createPreviewUrl(exposure.file);
      if (previewUrl) {
        objectUrls.push(previewUrl);
      }
      exposures.push({
        ...exposure,
        previewUrl,
        objectUrl: previewUrl,
        localPreviewState: previewUrl ? 'ready' : exposure.localPreviewState ?? 'missing'
      });
    }

    const selectedExposure = exposures.find((exposure) => exposure.id === item.selectedExposureId) ?? exposures[0] ?? null;
    hdrItems.push({
      ...item,
      previewUrl: selectedExposure?.previewUrl ?? null,
      exposures
    });
  }

  return {
    ...record.draft,
    hdrItems,
    objectUrls
  } satisfies LocalImportDraft;
}
