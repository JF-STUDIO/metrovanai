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

const RAW_EXTENSIONS = new Set([
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
const JPEG_EXTENSIONS = new Set(['.jpg', '.jpeg']);
export const IMPORT_FILE_ACCEPT = [...RAW_EXTENSIONS, ...JPEG_EXTENSIONS].join(',');
const MIN_EMBEDDED_JPEG_PREVIEW_BYTES = 8 * 1024;
const TIFF_TAG_NAMES = new Map<number, string>([
  [0x0100, 'ImageWidth'],
  [0x0101, 'ImageHeight'],
  [0x010f, 'Make'],
  [0x0110, 'Model'],
  [0x0112, 'Orientation'],
  [0x829a, 'ExposureTime'],
  [0x829d, 'FNumber'],
  [0x8827, 'ISO'],
  [0x9003, 'DateTimeOriginal'],
  [0x9004, 'CreateDate'],
  [0x9201, 'ShutterSpeedValue'],
  [0x9204, 'ExposureBiasValue'],
  [0x920a, 'FocalLength'],
  [0xa002, 'ExifImageWidth'],
  [0xa003, 'ExifImageHeight']
]);

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

function isPrintableText(value: string) {
  return value.length > 1 && !/[\u0000-\u0008\u000B-\u001F]/.test(value);
}

function isUsableMetadataValue(fieldName: string, value: unknown) {
  if (typeof value === 'string') {
    if (!value.trim() || !isPrintableText(value)) return false;
    if ((fieldName === 'DateTimeOriginal' || fieldName === 'CreateDate') && !/\d{4}[:/-]\d{2}[:/-]\d{2}/.test(value)) {
      return false;
    }
    return true;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }

  if (fieldName === 'FNumber') return value > 0 && value <= 64;
  if (fieldName === 'ExposureTime') return value > 0 && value <= 3600;
  if (fieldName === 'ISO') return value > 0 && value <= 409600;
  if (fieldName === 'FocalLength') return value > 0 && value <= 2000;
  if (fieldName === 'ExposureBiasValue') return value >= -20 && value <= 20;
  if (fieldName === 'ShutterSpeedValue') return value >= -20 && value <= 30;
  if (fieldName.includes('Width') || fieldName.includes('Height')) return value > 0 && value <= 250000;
  if (fieldName === 'Orientation') return value >= 1 && value <= 8;
  return true;
}

function mergeMetadataCandidates(candidates: Array<Record<string, unknown>>) {
  const scored = candidates
    .map((metadata) => ({
      metadata,
      score: [
        'DateTimeOriginal',
        'CreateDate',
        'ExposureTime',
        'ISO',
        'FNumber',
        'FocalLength',
        'ExposureBiasValue',
        'Make',
        'Model',
        'ExifImageWidth',
        'ImageWidth'
      ].filter((fieldName) => isUsableMetadataValue(fieldName, metadata[fieldName])).length
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => left.score - right.score);
  const merged: Record<string, unknown> = {};
  for (const { metadata } of scored) {
    for (const [fieldName, value] of Object.entries(metadata)) {
      if (isUsableMetadataValue(fieldName, value)) {
        merged[fieldName] = value;
      }
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function findEmbeddedTiffOffsets(bytes: Uint8Array) {
  const offsets: number[] = [];
  for (let index = 0; index < bytes.length - 4; index += 1) {
    const littleEndianTiff =
      bytes[index] === 0x49 && bytes[index + 1] === 0x49 && bytes[index + 2] === 0x2a && bytes[index + 3] === 0x00;
    const bigEndianTiff =
      bytes[index] === 0x4d && bytes[index + 1] === 0x4d && bytes[index + 2] === 0x00 && bytes[index + 3] === 0x2a;
    if (littleEndianTiff || bigEndianTiff) {
      offsets.push(index);
    }
  }
  return offsets.slice(0, 32);
}

function readTiffAscii(bytes: Uint8Array, offset: number, byteLength: number) {
  const slice = bytes.slice(offset, offset + byteLength);
  const zeroIndex = slice.indexOf(0);
  const usable = zeroIndex >= 0 ? slice.slice(0, zeroIndex) : slice;
  return new TextDecoder('utf-8', { fatal: false }).decode(usable).trim();
}

function readTiffNumericValue(view: DataView, offset: number, type: number, littleEndian: boolean) {
  if (type === 1 || type === 7) return view.getUint8(offset);
  if (type === 3) return view.getUint16(offset, littleEndian);
  if (type === 4) return view.getUint32(offset, littleEndian);
  if (type === 9) return view.getInt32(offset, littleEndian);
  if (type === 5 || type === 10) {
    const numerator = type === 5 ? view.getUint32(offset, littleEndian) : view.getInt32(offset, littleEndian);
    const denominator = type === 5 ? view.getUint32(offset + 4, littleEndian) : view.getInt32(offset + 4, littleEndian);
    return denominator === 0 ? null : numerator / denominator;
  }
  return null;
}

function getTiffTypeByteSize(type: number) {
  if (type === 1 || type === 2 || type === 7) return 1;
  if (type === 3) return 2;
  if (type === 4 || type === 9) return 4;
  if (type === 5 || type === 10) return 8;
  return 0;
}

function parseTiffValue(
  bytes: Uint8Array,
  view: DataView,
  tiffOffset: number,
  entryOffset: number,
  type: number,
  count: number,
  littleEndian: boolean
) {
  const unitSize = getTiffTypeByteSize(type);
  if (!unitSize || count <= 0 || count > 100000) return null;
  const byteLength = unitSize * count;
  const valueOffset =
    byteLength <= 4 ? entryOffset + 8 : tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
  if (valueOffset < 0 || valueOffset + byteLength > bytes.length) return null;

  if (type === 2) {
    return readTiffAscii(bytes, valueOffset, byteLength);
  }

  const values: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = readTiffNumericValue(view, valueOffset + index * unitSize, type, littleEndian);
    if (value !== null) values.push(value);
  }
  return count === 1 ? values[0] ?? null : values;
}

function parseEmbeddedTiffAt(bytes: Uint8Array, tiffOffset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49;
  const magic = view.getUint16(tiffOffset + 2, littleEndian);
  if (magic !== 42) return null;

  const metadata: Record<string, unknown> = {};
  const visited = new Set<number>();
  const parseIfd = (ifdRelativeOffset: number, depth = 0) => {
    if (depth > 4 || visited.has(ifdRelativeOffset)) return;
    visited.add(ifdRelativeOffset);
    const ifdOffset = tiffOffset + ifdRelativeOffset;
    if (ifdOffset < 0 || ifdOffset + 2 > bytes.length) return;
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    if (entryCount > 512 || ifdOffset + 2 + entryCount * 12 > bytes.length) return;

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);

      if (tag === 0x8769) {
        parseIfd(view.getUint32(entryOffset + 8, littleEndian), depth + 1);
        continue;
      }

      const fieldName = TIFF_TAG_NAMES.get(tag);
      if (!fieldName) continue;
      const value = parseTiffValue(bytes, view, tiffOffset, entryOffset, type, count, littleEndian);
      if (isUsableMetadataValue(fieldName, value)) {
        metadata[fieldName] = value;
      }
    }

    const nextOffsetPosition = ifdOffset + 2 + entryCount * 12;
    if (nextOffsetPosition + 4 <= bytes.length) {
      const nextIfdOffset = view.getUint32(nextOffsetPosition, littleEndian);
      if (nextIfdOffset > 0) parseIfd(nextIfdOffset, depth + 1);
    }
  };

  parseIfd(view.getUint32(tiffOffset + 4, littleEndian));
  return Object.keys(metadata).length ? metadata : null;
}

async function parseEmbeddedRawMetadata(file: File) {
  if (!isRawFile(file.name)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const candidates = findEmbeddedTiffOffsets(bytes)
    .map((offset) => parseEmbeddedTiffAt(bytes, offset))
    .filter((metadata): metadata is Record<string, unknown> => Boolean(metadata));
  return mergeMetadataCandidates(candidates);
}

async function extractEmbeddedJpegPreviewUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bestStart = -1;
  let bestEnd = -1;
  let bestLength = 0;
  let cursor = 0;

  while (cursor < bytes.length - 4) {
    let start = -1;
    for (let index = cursor; index < bytes.length - 2; index += 1) {
      if (bytes[index] === 0xff && bytes[index + 1] === 0xd8 && bytes[index + 2] === 0xff) {
        start = index;
        break;
      }
    }
    if (start === -1) {
      break;
    }

    let end = -1;
    for (let index = start + 3; index < bytes.length - 1; index += 1) {
      if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
        end = index + 2;
        break;
      }
    }
    if (end === -1) {
      break;
    }

    const length = end - start;
    if (length > bestLength) {
      bestStart = start;
      bestEnd = end;
      bestLength = length;
    }
    cursor = end;
  }

  if (bestStart < 0 || bestEnd <= bestStart || bestLength < MIN_EMBEDDED_JPEG_PREVIEW_BYTES) {
    return null;
  }

  return URL.createObjectURL(file.slice(bestStart, bestEnd, 'image/jpeg'));
}

async function createLocalPreviewUrl(file: File) {
  const exifr = (await loadExifr()).default;
  let previewUrl = await exifr.thumbnailUrl(file).catch(() => undefined);
  if (!previewUrl && isRawFile(file.name)) {
    previewUrl = (await extractEmbeddedJpegPreviewUrl(file).catch(() => null)) ?? undefined;
  }
  if (!previewUrl && isJpegFile(file.name)) {
    previewUrl = URL.createObjectURL(file);
  }
  return previewUrl ?? null;
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
  const exifrMetadata = (await exifr.parse(file, {
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
  const metadata = hasUsableExifMetadata(exifrMetadata)
    ? exifrMetadata
    : ((await parseEmbeddedRawMetadata(file).catch(() => null)) as Record<string, unknown> | null);
  const metadataState: LocalImportMetadataState = hasUsableExifMetadata(metadata) ? 'exif' : 'fallback';

  const previewUrl = await createLocalPreviewUrl(file);
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
  return await createLocalPreviewUrl(file);
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
