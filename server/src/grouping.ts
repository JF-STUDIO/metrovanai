import fs from 'node:fs';
import path from 'node:path';
import { toolPaths, runProcess } from './native-tools.js';
import { getFileStem, isImageExtension, isRawExtension } from './utils.js';

export interface GroupingFrame {
  path: string;
  name: string;
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
  rawMetadata: Record<string, unknown>;
}

export interface GroupingGroup {
  index: number;
  frames: GroupingFrame[];
}

export interface GroupingResult {
  frames: GroupingFrame[];
  groups: GroupingGroup[];
}

export interface GroupingConfig {
  gapSeconds: number;
  spanSeconds: number;
  aspectRatioTolerance: number;
  fNumberTolerance: number;
  isoRatioTolerance: number;
  focalLengthTolerance: number;
  scoreThreshold: number;
  minExposureStepEv: number;
  maxSequenceGapInGroup: number;
}

export const defaultGroupingConfig: GroupingConfig = {
  gapSeconds: 3,
  spanSeconds: 12,
  aspectRatioTolerance: 1.25,
  fNumberTolerance: 0.6,
  isoRatioTolerance: 2.2,
  focalLengthTolerance: 6,
  scoreThreshold: 6,
  minExposureStepEv: 0.7,
  maxSequenceGapInGroup: 2
};

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseExifDate(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T').replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseSequenceFromName(fileName: string) {
  const match = /(\d+)(?=\.[^.]+$)/.exec(fileName);
  return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

function normalizeInputFiles(filePaths: string[]) {
  const unique = Array.from(
    new Map(
      filePaths
        .filter((filePath) => filePath && fs.existsSync(filePath))
        .filter((filePath) => isRawExtension(path.extname(filePath)) || isImageExtension(path.extname(filePath)))
        .map((filePath) => [path.resolve(filePath).toLowerCase(), path.resolve(filePath)])
    ).values()
  );

  const stemsWithRaw = new Set(
    unique.filter((filePath) => isRawExtension(path.extname(filePath))).map((filePath) => getFileStem(filePath).toLowerCase())
  );

  return unique.filter((filePath) => {
    const extension = path.extname(filePath);
    if (!isImageExtension(extension)) {
      return true;
    }

    return !stemsWithRaw.has(getFileStem(filePath).toLowerCase());
  });
}

async function readFramesWithExiftool(filePaths: string[]) {
  if (!toolPaths.exiftool) {
    return [] as GroupingFrame[];
  }

  const args = [
    '-j',
    '-n',
    '-DateTimeOriginal',
    '-CreateDate',
    '-SubSecDateTimeOriginal',
    '-ExposureBiasValue',
    '-ExposureCompensation',
    '-ExposureTime',
    '-ShutterSpeed',
    '-ISO',
    '-FNumber',
    '-Aperture',
    '-FocalLength',
    '-Model',
    '-SerialNumber',
    '-ImageWidth',
    '-ImageHeight',
    '-Orientation',
    '-SequenceNumber',
    '-BurstUUID',
    '-BracketSequence',
    '-BracketShotNumber',
    '-FileName',
    '-Directory',
    '-SourceFile',
    ...filePaths
  ];

  const result = await runProcess(toolPaths.exiftool, args, {
    cwd: path.dirname(filePaths[0] ?? process.cwd()),
    timeoutSeconds: 180
  });

  if (result.exitCode !== 0) {
    throw new Error(`exiftool grouping read failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  const rows = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  return rows
    .map((row, index) => {
      const expectedPath = filePaths[index] ?? '';
      const sourceFile = String(row.SourceFile ?? '').trim();
      const directory = String(row.Directory ?? '').trim();
      const fileName = String(row.FileName ?? path.basename(expectedPath)).trim();
      const resolvedPath =
        (expectedPath && fs.existsSync(expectedPath) && expectedPath) ||
        (sourceFile && fs.existsSync(sourceFile) && sourceFile) ||
        (directory && fileName ? path.join(directory, fileName) : '');

      if (!resolvedPath) {
        return null;
      }

      const captureTime =
        parseExifDate(row.SubSecDateTimeOriginal) ??
        parseExifDate(row.DateTimeOriginal) ??
        parseExifDate(row.CreateDate);

      const rawMetadata = { ...row } as Record<string, unknown>;
      if (captureTime) {
        rawMetadata.CaptureTime = captureTime;
      }

      return {
        path: resolvedPath,
        name: fileName || path.basename(resolvedPath),
        sequenceNumber: parseNullableNumber(row.SequenceNumber) ?? parseSequenceFromName(fileName),
        captureTime,
        exposureSeconds:
          parseNullableNumber(row.ExposureTime) ?? parseNullableNumber(row.ShutterSpeed) ?? 0,
        exposureCompensation:
          parseNullableNumber(row.ExposureBiasValue) ?? parseNullableNumber(row.ExposureCompensation),
        iso: parseNullableNumber(row.ISO),
        fNumber: parseNullableNumber(row.FNumber) ?? parseNullableNumber(row.Aperture),
        focalLength: parseNullableNumber(row.FocalLength),
        cameraModel: String(row.Model ?? '').trim(),
        serialNumber: String(row.SerialNumber ?? '').trim(),
        width: parseNullableNumber(row.ImageWidth),
        height: parseNullableNumber(row.ImageHeight),
        orientation: String(row.Orientation ?? '').trim(),
        bracketSequence: String(row.BracketSequence ?? '').trim(),
        burstId: String(row.BurstUUID ?? '').trim(),
        rawMetadata
      } satisfies GroupingFrame;
    })
    .filter((frame): frame is GroupingFrame => Boolean(frame))
    .sort(compareFrames);
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

function buildFallbackFrames(filePaths: string[]) {
  return filePaths
    .map((filePath) => {
      const stats = fs.statSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        sequenceNumber: parseSequenceFromName(path.basename(filePath)),
        captureTime: stats.mtime.toISOString(),
        exposureSeconds: 0,
        exposureCompensation: null,
        iso: null,
        fNumber: null,
        focalLength: null,
        cameraModel: '',
        serialNumber: '',
        width: null,
        height: null,
        orientation: '',
        bracketSequence: '',
        burstId: '',
        rawMetadata: { CaptureTime: stats.mtime.toISOString() }
      } satisfies GroupingFrame;
    })
    .sort(compareFrames);
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

function matchScore(left: GroupingFrame, right: GroupingFrame, config: GroupingConfig) {
  let score = 0;

  if (left.cameraModel && left.cameraModel.toLowerCase() === right.cameraModel.toLowerCase()) score += 1;
  if (left.serialNumber && left.serialNumber.toLowerCase() === right.serialNumber.toLowerCase()) score += 1;
  if (left.orientation && left.orientation.toLowerCase() === right.orientation.toLowerCase()) score += 1;
  if (ratioClose(aspectRatio(left), aspectRatio(right), config.aspectRatioTolerance)) score += 1;
  if (closeEnough(left.focalLength, right.focalLength, config.focalLengthTolerance)) score += 1;
  if (closeEnough(left.fNumber, right.fNumber, config.fNumberTolerance)) score += 1;
  if (ratioClose(left.iso, right.iso, config.isoRatioTolerance)) score += 1;
  if (left.burstId && left.burstId.toLowerCase() === right.burstId.toLowerCase()) score += 1;
  if (left.bracketSequence && left.bracketSequence.toLowerCase() === right.bracketSequence.toLowerCase()) score += 1;

  const gap = sequenceGap(left, right);
  const step = exposureStepEv(left, right);
  if (
    score === config.scoreThreshold - 1 &&
    gap !== null &&
    gap > 0 &&
    gap <= config.maxSequenceGapInGroup &&
    step !== null &&
    step >= config.minExposureStepEv
  ) {
    score += 1;
  }

  return score;
}

export async function analyzeHdrGroups(
  filePaths: string[],
  config: GroupingConfig = defaultGroupingConfig
): Promise<GroupingResult> {
  const normalizedFiles = normalizeInputFiles(filePaths);
  if (normalizedFiles.length === 0) {
    return { frames: [], groups: [] };
  }

  let frames = await readFramesWithExiftool(normalizedFiles);
  if (frames.length === 0) {
    frames = buildFallbackFrames(normalizedFiles);
  }

  const validFrames = frames.filter((frame) => Boolean(frame.captureTime));
  if (validFrames.length === 0) {
    return {
      frames,
      groups: frames.map((frame, index) => ({ index: index + 1, frames: [frame] }))
    };
  }

  const groups: GroupingGroup[] = [];
  let current = [validFrames[0] as GroupingFrame];
  let startTime = new Date(validFrames[0]!.captureTime as string);
  let previous = validFrames[0] as GroupingFrame;

  for (let index = 1; index < validFrames.length; index += 1) {
    const next = validFrames[index] as GroupingFrame;
    const dtPrev =
      (new Date(next.captureTime as string).getTime() - new Date(previous.captureTime as string).getTime()) / 1000;
    const dtSpan =
      (new Date(next.captureTime as string).getTime() - startTime.getTime()) / 1000;
    const score = matchScore(previous, next, config);
    const split = dtPrev > config.gapSeconds || dtSpan > config.spanSeconds || score < config.scoreThreshold;

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

  return { frames, groups };
}

export async function readGroupingFrames(filePaths: string[]) {
  const normalizedFiles = normalizeInputFiles(filePaths);
  if (normalizedFiles.length === 0) {
    return [] as GroupingFrame[];
  }

  let frames = await readFramesWithExiftool(normalizedFiles);
  if (frames.length === 0) {
    frames = buildFallbackFrames(normalizedFiles);
  }
  return frames;
}
