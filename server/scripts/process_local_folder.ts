import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { analyzeHdrGroups } from '../src/grouping.js';
import { estimateReferenceWhiteBalanceGains, extractPreviewOrConvertToJpeg, fuseToJpeg } from '../src/images.js';
import { classifyHdrScenes } from '../src/scene-classifier.js';
import type { ExposureFile, HdrItem } from '../src/types.js';
import { ensureDir, getFileStem, isImageExtension, isRawExtension, saveJson } from '../src/utils.js';
import type { RgbGains } from '../src/images.js';

function formatTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function pickDefaultExposure(exposures: ExposureFile[]) {
  const finiteExposures = exposures.filter((exposure) => exposure.exposureCompensation !== null);
  const uniqueExposureValues = new Set(
    finiteExposures.map((exposure) => Number(exposure.exposureCompensation ?? 0).toFixed(6))
  );

  if (finiteExposures.length >= 3 && uniqueExposureValues.size <= 1) {
    return exposures[Math.floor(exposures.length / 2)] ?? exposures[0] ?? null;
  }

  const byPlusOne = exposures
    .filter((exposure) => exposure.exposureCompensation !== null)
    .sort(
      (left, right) =>
        Math.abs((left.exposureCompensation as number) - 1) - Math.abs((right.exposureCompensation as number) - 1)
    );
  if (byPlusOne[0]) {
    return byPlusOne[0];
  }

  const byNormal = exposures
    .filter((exposure) => exposure.exposureCompensation !== null)
    .sort((left, right) => Math.abs(left.exposureCompensation as number) - Math.abs(right.exposureCompensation as number));
  if (byNormal[0]) {
    return byNormal[0];
  }

  return exposures[Math.floor(exposures.length / 2)] ?? exposures[0] ?? null;
}

function listInputFiles(inputDir: string) {
  return fs
    .readdirSync(inputDir)
    .map((name) => path.join(inputDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .filter((filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      return isRawExtension(extension) || isImageExtension(extension);
    })
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

async function buildProjectWhiteBalancePlan(hdrItems: HdrItem[]) {
  const perItem = new Map<string, RgbGains | null>();

  for (const item of hdrItems) {
    const gains = await estimateReferenceWhiteBalanceGains(
      item.exposures.map((exposure) => ({
        path: exposure.storagePath,
        exposureCompensation: exposure.exposureCompensation,
        isRaw: exposure.isRaw
      }))
    );
    perItem.set(item.id, gains);
  }

  const finalGains = new Map<string, RgbGains | null>();
  for (const item of hdrItems) {
    finalGains.set(item.id, perItem.get(item.id) ?? null);
  }

  return { perItem, finalGains };
}

async function buildHdrItems(inputDir: string, previewRoot: string) {
  const files = listInputFiles(inputDir);
  if (!files.length) {
    throw new Error('No supported image files found in input folder.');
  }

  const grouping = await analyzeHdrGroups(files);
  const hdrItems: HdrItem[] = [];

  for (const group of grouping.groups) {
    const hdrItemId = nanoid(10);
    const itemPreviewDir = path.join(previewRoot, hdrItemId);
    ensureDir(itemPreviewDir);
    const exposures: ExposureFile[] = [];

    for (const frame of group.frames) {
      const previewPath = path.join(itemPreviewDir, `${getFileStem(frame.name)}.jpg`);
      await extractPreviewOrConvertToJpeg(frame.path, previewPath, 88, 1600);
      exposures.push({
        id: nanoid(10),
        fileName: path.basename(frame.path),
        originalName: frame.name,
        extension: path.extname(frame.path).toLowerCase(),
        mimeType: isRawExtension(path.extname(frame.path)) ? 'image/x-raw' : 'image/jpeg',
        size: fs.statSync(frame.path).size,
        isRaw: isRawExtension(path.extname(frame.path)),
        storagePath: frame.path,
        storageUrl: frame.path,
        previewPath,
        previewUrl: previewPath,
        captureTime: frame.captureTime,
        sequenceNumber: frame.sequenceNumber,
        exposureCompensation: frame.exposureCompensation,
        exposureSeconds: frame.exposureSeconds,
        iso: frame.iso,
        fNumber: frame.fNumber,
        focalLength: frame.focalLength
      });
    }

    const selectedExposure = pickDefaultExposure(exposures);
    hdrItems.push({
      id: hdrItemId,
      index: group.index,
      title: `HDR ${group.index}`,
      groupId: `group-${String(group.index).padStart(3, '0')}`,
      sceneType: 'pending',
      selectedExposureId: selectedExposure?.id ?? exposures[0]?.id ?? '',
      previewUrl: selectedExposure?.previewPath ?? exposures[0]?.previewPath ?? null,
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

  return await classifyHdrScenes(hdrItems);
}

async function main() {
  const inputDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const disableToneAdjustments = process.argv.includes('--no-tone');
  if (!inputDir || !fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error('Usage: pnpm exec tsx server/scripts/process_local_folder.ts <input-folder> [--no-tone]');
  }

  const startedAt = Date.now();
  const outputRoot = path.join(inputDir, `MetrovanAI_HDR_Local_${formatTimestamp()}`);
  const hdDir = path.join(outputRoot, 'HD');
  const previewDir = path.join(outputRoot, 'Previews');
  ensureDir(outputRoot);
  ensureDir(hdDir);
  ensureDir(previewDir);

  console.log(`[local-process] input: ${inputDir}`);
  console.log(`[local-process] output: ${outputRoot}`);
  console.log(`[local-process] tone adjustments: ${disableToneAdjustments ? 'disabled' : 'enabled'}`);

  const hdrItems = await buildHdrItems(inputDir, previewDir);
  console.log(`[local-process] grouped ${hdrItems.length} HDR items`);

  const whiteBalancePlan = await buildProjectWhiteBalancePlan(hdrItems);

  const manifest: Array<Record<string, unknown>> = [];
  for (let index = 0; index < hdrItems.length; index += 1) {
    const item = hdrItems[index]!;
    const selectedExposure =
      item.exposures.find((exposure) => exposure.id === item.selectedExposureId) ?? item.exposures[0] ?? null;
    const outputFileName = `${path.basename(selectedExposure?.originalName ?? item.title, path.extname(selectedExposure?.originalName ?? ''))}.jpg`;
    const outputPath = path.join(hdDir, outputFileName);

    console.log(
      `[local-process] ${index + 1}/${hdrItems.length} ${item.title} | ${item.sceneType} | ${item.exposures.length} frames -> ${outputFileName}`
    );

    const rawGains = whiteBalancePlan.perItem.get(item.id) ?? null;
    const finalGains = whiteBalancePlan.finalGains.get(item.id) ?? null;
    if (rawGains) {
      console.log(
        `[local-process] wb raw gains -> r=${rawGains.r.toFixed(6)} g=${rawGains.g.toFixed(6)} b=${rawGains.b.toFixed(6)}`
      );
    }
    if (finalGains) {
      console.log(
        `[local-process] wb final gains -> r=${finalGains.r.toFixed(6)} g=${finalGains.g.toFixed(6)} b=${finalGains.b.toFixed(6)}`
      );
    }

    await fuseToJpeg(
      item.exposures.map((exposure) => ({
        path: exposure.storagePath,
        exposureCompensation: exposure.exposureCompensation,
        isRaw: exposure.isRaw
      })),
      outputPath,
      95,
      {
        whiteBalanceGains: finalGains,
        disableToneAdjustments
      }
    );

    manifest.push({
      index: item.index,
      title: item.title,
      sceneType: item.sceneType,
      outputFileName,
      outputPath,
      selectedExposure: selectedExposure?.originalName ?? null,
      rawGains,
      finalGains,
      exposures: item.exposures.map((exposure) => ({
        originalName: exposure.originalName,
        previewPath: exposure.previewPath,
        exposureCompensation: exposure.exposureCompensation,
        captureTime: exposure.captureTime,
        iso: exposure.iso,
        fNumber: exposure.fNumber,
        focalLength: exposure.focalLength
      }))
    });
  }

  const completedAt = Date.now();
  const summary = {
    inputDir,
    outputRoot,
    hdDir,
    previewDir,
    totalHdrItems: hdrItems.length,
    totalFiles: listInputFiles(inputDir).length,
    durationSeconds: Number(((completedAt - startedAt) / 1000).toFixed(2)),
    toneAdjustmentsDisabled: disableToneAdjustments,
    generatedAt: new Date().toISOString(),
    items: manifest
  };

  saveJson(path.join(outputRoot, 'summary.json'), summary);
  console.log(`[local-process] completed in ${summary.durationSeconds}s`);
  console.log(`[local-process] summary: ${path.join(outputRoot, 'summary.json')}`);
}

main().catch((error) => {
  console.error('[local-process] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
