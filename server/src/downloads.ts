import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJpegVariant } from './images.js';
import { restoreObjectToFileIfAvailable } from './object-storage.js';
import type { ProjectRecord } from './types.js';
import { sanitizeSegment } from './utils.js';

export interface DownloadVariantOption {
  key: 'hd' | 'custom';
  label: string;
  longEdge?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ProjectDownloadOptions {
  folderMode: 'grouped' | 'flat';
  namingMode: 'original' | 'sequence' | 'custom-prefix';
  customPrefix?: string;
  variants: DownloadVariantOption[];
}

export function getDefaultDownloadOptions(): ProjectDownloadOptions {
  return {
    folderMode: 'grouped',
    namingMode: 'sequence',
    customPrefix: '',
    variants: [{ key: 'hd', label: 'HD' }]
  };
}

export async function buildProjectDownloadArchive(project: ProjectRecord, input?: ProjectDownloadOptions) {
  const options = normalizeDownloadOptions(input);
  const orderedAssets = [...project.resultAssets].sort((left, right) => left.sortOrder - right.sortOrder);
  if (!orderedAssets.length) {
    throw new Error('Project does not have downloadable results yet.');
  }

  const baseName = sanitizeSegment(project.name || project.id) || project.id;
  const tempRoot = path.join(os.tmpdir(), 'metrovan-ai-downloads');
  const stagingRoot = path.join(tempRoot, project.id, baseName);
  const zipPath = path.join(tempRoot, `${project.id}-${baseName}.zip`);

  fs.rmSync(path.join(tempRoot, project.id), { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  const addVariantSuffix = options.folderMode === 'flat' && options.variants.length > 1;
  for (const variant of options.variants) {
    const variantFolder = options.folderMode === 'grouped' ? path.join(stagingRoot, getVariantFolderName(variant)) : stagingRoot;
    fs.mkdirSync(variantFolder, { recursive: true });

    for (const [index, asset] of orderedAssets.entries()) {
      if (!fs.existsSync(asset.storagePath)) {
        await restoreObjectToFileIfAvailable(asset.storageKey, asset.storagePath);
      }

      if (!fs.existsSync(asset.storagePath)) {
        continue;
      }

      const targetFileName = buildOutputFileName({
        originalFileName: asset.fileName,
        index,
        projectBaseName: baseName,
        namingMode: options.namingMode,
        customPrefix: options.customPrefix,
        variant,
        addVariantSuffix
      });
      const targetPath = path.join(variantFolder, targetFileName);
      await writeJpegVariant(asset.storagePath, targetPath, 95, resolveVariantResize(variant));
    }
  }

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${stagingRoot.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
    ],
    { stdio: 'pipe' }
  );

  return {
    zipPath,
    downloadName: `${baseName}.zip`
  };
}

function normalizeDownloadOptions(input?: ProjectDownloadOptions): ProjectDownloadOptions {
  const defaults = getDefaultDownloadOptions();
  const variants = (input?.variants?.length ? input.variants : defaults.variants)
    .map((variant) => normalizeVariant(variant))
    .filter((variant, index, items) => items.findIndex((item) => item.label === variant.label) === index);

  if (!variants.length) {
    throw new Error('At least one download variant must be enabled.');
  }

  return {
    folderMode: input?.folderMode === 'flat' ? 'flat' : defaults.folderMode,
    namingMode: input?.namingMode === 'original' || input?.namingMode === 'custom-prefix' ? input.namingMode : defaults.namingMode,
    customPrefix: sanitizeSegment(input?.customPrefix ?? '').slice(0, 40),
    variants
  };
}

function normalizeVariant(variant: DownloadVariantOption): DownloadVariantOption {
  const safeLabel = sanitizeSegment(variant.label || getDefaultVariantLabel(variant)).slice(0, 48) || getDefaultVariantLabel(variant);
  return {
    key: variant.key,
    label: safeLabel,
    longEdge: normalizePositiveNumber(variant.longEdge),
    width: normalizePositiveNumber(variant.width),
    height: normalizePositiveNumber(variant.height)
  };
}

function getDefaultVariantLabel(variant: DownloadVariantOption) {
  if (variant.key === 'hd') return 'HD';
  if (variant.width || variant.height) {
    return `Custom-${variant.width ?? 'auto'}x${variant.height ?? 'auto'}`;
  }
  if (variant.longEdge) {
    return `Custom-${variant.longEdge}`;
  }
  return 'Custom';
}

function normalizePositiveNumber(value: number | null | undefined) {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return null;
  }
  return Math.round(Number(value));
}

function resolveVariantResize(variant: DownloadVariantOption) {
  if (variant.key === 'hd') {
    return undefined;
  }

  return {
    longEdge: variant.longEdge ?? null,
    width: variant.width ?? null,
    height: variant.height ?? null
  };
}

function getVariantFolderName(variant: DownloadVariantOption) {
  if (variant.key === 'hd') return 'HD';
  return variant.label;
}

function buildOutputFileName(input: {
  originalFileName: string;
  index: number;
  projectBaseName: string;
  namingMode: ProjectDownloadOptions['namingMode'];
  customPrefix?: string;
  variant: DownloadVariantOption;
  addVariantSuffix: boolean;
}) {
  const extension = path.extname(input.originalFileName) || '.jpg';
  const originalBase = sanitizeSegment(path.basename(input.originalFileName, extension)) || `image-${input.index + 1}`;
  let baseName = originalBase;

  if (input.namingMode === 'sequence') {
    baseName = `${input.projectBaseName}_${String(input.index + 1).padStart(2, '0')}`;
  } else if (input.namingMode === 'custom-prefix') {
    const prefix = sanitizeSegment(input.customPrefix ?? '') || input.projectBaseName;
    baseName = `${prefix}_${String(input.index + 1).padStart(2, '0')}`;
  }

  if (input.addVariantSuffix) {
    baseName = `${baseName}_${sanitizeSegment(input.variant.label)}`;
  }

  return `${baseName}${extension}`;
}
