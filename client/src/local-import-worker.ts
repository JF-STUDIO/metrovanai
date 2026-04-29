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

type LocalImportMetadataState = 'exif' | 'fallback';
type LocalImportPreviewState = 'ready' | 'missing';

interface ParseRequest {
  type: 'parse';
  id: string;
  files: File[];
}

interface ParsedFramePayload {
  index: number;
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
  previewBlob: Blob | null;
  metadataState: LocalImportMetadataState;
  previewState: LocalImportPreviewState;
  canAutoGroup: boolean;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

function isRawFile(fileName: string) {
  return RAW_EXTENSIONS.has(getFileExtension(fileName));
}

function isJpegFile(fileName: string) {
  return JPEG_EXTENSIONS.has(getFileExtension(fileName));
}

function createFileByteReader(file: File) {
  let bytesPromise: Promise<Uint8Array> | null = null;
  return () => {
    bytesPromise ??= file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    return bytesPromise;
  };
}

function isPrintableText(value: string) {
  if (value.length <= 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 31)) return false;
  }
  return true;
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
  const seen = new Set<number>();
  const addOffset = (offset: number) => {
    if (offset >= 0 && !seen.has(offset)) {
      seen.add(offset);
      offsets.push(offset);
    }
  };

  for (let index = 0; index < bytes.length - 10; index += 1) {
    if (
      bytes[index] === 0x45 &&
      bytes[index + 1] === 0x78 &&
      bytes[index + 2] === 0x69 &&
      bytes[index + 3] === 0x66 &&
      bytes[index + 4] === 0x00 &&
      bytes[index + 5] === 0x00
    ) {
      addOffset(index + 6);
    }
  }

  for (let index = 0; index < bytes.length - 4; index += 1) {
    const littleEndianTiff =
      bytes[index] === 0x49 && bytes[index + 1] === 0x49 && bytes[index + 2] === 0x2a && bytes[index + 3] === 0x00;
    const bigEndianTiff =
      bytes[index] === 0x4d && bytes[index + 1] === 0x4d && bytes[index + 2] === 0x00 && bytes[index + 3] === 0x2a;
    if (littleEndianTiff || bigEndianTiff) {
      addOffset(index);
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

async function parseEmbeddedRawMetadata(file: File, readBytes = createFileByteReader(file)) {
  if (!isRawFile(file.name)) return null;
  const bytes = await readBytes();
  const candidates = findEmbeddedTiffOffsets(bytes)
    .map((offset) => parseEmbeddedTiffAt(bytes, offset))
    .filter((metadata): metadata is Record<string, unknown> => Boolean(metadata));
  return mergeMetadataCandidates(candidates);
}

async function extractEmbeddedJpegPreviewBlob(file: File, readBytes = createFileByteReader(file)) {
  const bytes = await readBytes();
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
    if (start === -1) break;

    let end = -1;
    for (let index = start + 3; index < bytes.length - 1; index += 1) {
      if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
        end = index + 2;
        break;
      }
    }
    if (end === -1) break;

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

  return file.slice(bestStart, bestEnd, 'image/jpeg');
}

async function createLocalPreviewBlob(file: File, readBytes = createFileByteReader(file)) {
  if (isJpegFile(file.name)) {
    return null;
  }
  return (await extractEmbeddedJpegPreviewBlob(file, readBytes).catch(() => null)) ?? null;
}

function thumbnailToBlob(thumbnail: unknown) {
  if (!thumbnail) return null;
  if (thumbnail instanceof Blob) return thumbnail;
  if (thumbnail instanceof Uint8Array) {
    const copy = new Uint8Array(thumbnail);
    return new Blob([copy.buffer], { type: 'image/jpeg' });
  }
  if (thumbnail instanceof ArrayBuffer) return new Blob([thumbnail.slice(0)], { type: 'image/jpeg' });
  if (ArrayBuffer.isView(thumbnail)) {
    const copy = new Uint8Array(thumbnail.byteLength);
    copy.set(new Uint8Array(thumbnail.buffer, thumbnail.byteOffset, thumbnail.byteLength));
    return new Blob([copy.buffer], { type: 'image/jpeg' });
  }
  return null;
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
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T').replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseSequenceFromName(fileName: string) {
  const match = fileName.match(/(?:^|[_-])(\d{3,})(?:[_-]|$)/);
  return match ? Number(match[1]) : null;
}

function hasUsableExifMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return false;

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

async function parseFrame(file: File, index: number): Promise<ParsedFramePayload> {
  const extension = getFileExtension(file.name);
  const exifr = (await import('exifr')).default;
  const readBytes = createFileByteReader(file);
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
    : ((await parseEmbeddedRawMetadata(file, readBytes).catch(() => null)) as Record<string, unknown> | null);
  const metadataState: LocalImportMetadataState = hasUsableExifMetadata(metadata) ? 'exif' : 'fallback';
  const exifrPreviewBlob = isJpegFile(file.name)
    ? null
    : thumbnailToBlob(await exifr.thumbnail(file).catch(() => undefined));
  const previewBlob = exifrPreviewBlob ?? (await createLocalPreviewBlob(file, readBytes));
  const previewState: LocalImportPreviewState = previewBlob || isJpegFile(file.name) ? 'ready' : 'missing';

  return {
    index,
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
    previewBlob,
    metadataState,
    previewState,
    canAutoGroup: metadataState === 'exif'
  };
}

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'parse') return;

  void (async () => {
    try {
      const PARSE_CONCURRENCY = 4;
      const frames: ParsedFramePayload[] = [];
      let completed = 0;
      for (let start = 0; start < request.files.length; start += PARSE_CONCURRENCY) {
        const end = Math.min(start + PARSE_CONCURRENCY, request.files.length);
        const chunkFrames = await Promise.all(
          Array.from({ length: end - start }, (_unused, i) => {
            const fileIndex = start + i;
            return parseFrame(request.files[fileIndex]!, fileIndex).then((frame) => {
              completed += 1;
              self.postMessage({ type: 'progress', id: request.id, completed, total: request.files.length });
              return frame;
            });
          })
        );
        frames.push(...chunkFrames);
      }
      self.postMessage({ type: 'result', id: request.id, frames });
    } catch (error) {
      self.postMessage({
        type: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : 'Local import worker failed.'
      });
    }
  })();
});
