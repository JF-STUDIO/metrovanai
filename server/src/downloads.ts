import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createJpegVariantStream, writeJpegVariant } from './images.js';
import { createObjectDownloadUrl, getObjectStorageMetadata, restoreObjectToFileIfAvailable } from './object-storage.js';
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

function getProjectDownloadBaseName(project: ProjectRecord) {
  return sanitizeSegment(project.name || project.id) || project.id;
}

export function getProjectDownloadFileName(project: ProjectRecord) {
  return `${getProjectDownloadBaseName(project)}.zip`;
}

export async function buildProjectDownloadArchive(project: ProjectRecord, input?: ProjectDownloadOptions) {
  const options = normalizeDownloadOptions(input);
  const orderedAssets = [...project.resultAssets].sort((left, right) => left.sortOrder - right.sortOrder);
  if (!orderedAssets.length) {
    throw new Error('Project does not have downloadable results yet.');
  }

  const baseName = getProjectDownloadBaseName(project);
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
        try {
          await restoreObjectToFileIfAvailable(asset.storageKey, asset.storagePath);
        } catch (error) {
          console.warn(
            `[download] result restore failed: project=${project.id} asset=${asset.id} key=${asset.storageKey ?? 'none'} ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (!fs.existsSync(asset.storagePath)) {
        console.warn(`[download] result missing: project=${project.id} asset=${asset.id} file=${asset.fileName}`);
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
      const resize = resolveVariantResize(variant);
      if (!resize) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(asset.storagePath, targetPath);
      } else {
        await writeJpegVariant(asset.storagePath, targetPath, 95, resize);
      }
    }
  }

  await writeZipArchive(stagingRoot, zipPath, baseName);

  return {
    zipPath,
    downloadName: getProjectDownloadFileName(project)
  };
}

const crc32Table = new Uint32Array(256);
for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crc32Table[index] = value >>> 0;
}

function crc32Update(value: number, buffer: Buffer) {
  for (const byte of buffer) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function crc32Finalize(value: number) {
  return (value ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function listFiles(root: string) {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files;
}

function assertZip32Limit(value: number, label: string) {
  if (value > 0xffffffff) {
    throw new Error(`Download archive is too large for ZIP32 (${label}).`);
  }
}

class ZipWriteCursor {
  offset = 0;

  constructor(private readonly output: Writable) {}

  async write(chunk: Buffer) {
    if (!this.output.write(chunk)) {
      await once(this.output, 'drain');
    }
    this.offset += chunk.length;
  }

  async copyFromFile(filePath: string) {
    for await (const chunk of fs.createReadStream(filePath)) {
      await this.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }

  async copyFromReadable(source: AsyncIterable<Buffer | Uint8Array | string>) {
    let value = 0xffffffff;
    let size = 0;

    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      value = crc32Update(value, buffer);
      await this.write(buffer);
    }

    return {
      checksum: crc32Finalize(value),
      size
    };
  }

  async close() {
    const finished = once(this.output, 'finish');
    const failed = once(this.output, 'error').then(([error]) => {
      throw error;
    });
    this.output.end();
    await Promise.race([finished, failed]);
  }
}

type DownloadAsset = ProjectRecord['resultAssets'][number];

export class DownloadIncompleteError extends Error {
  constructor(public readonly missingFiles: string[]) {
    super(`Download incomplete: ${missingFiles.length} files missing`);
    this.name = 'DownloadIncompleteError';
  }
}

export async function assertProjectDownloadAssetsReady(project: ProjectRecord) {
  const missing: string[] = [];
  for (const asset of project.resultAssets) {
    if (fs.existsSync(asset.storagePath)) {
      continue;
    }
    if (!asset.storageKey) {
      missing.push(asset.fileName);
      continue;
    }
    const metadata = await getObjectStorageMetadata(asset.storageKey).catch(() => null);
    if (!metadata) {
      missing.push(asset.fileName);
    }
  }
  if (missing.length) {
    throw new DownloadIncompleteError(Array.from(new Set(missing)));
  }
}

type PreparedDownloadSource = {
  stream: AsyncIterable<Buffer | Uint8Array | string>;
  mtime: Date;
  cleanup?: () => void;
};

async function prepareAssetDownloadSource(
  project: ProjectRecord,
  asset: DownloadAsset,
  variant: DownloadVariantOption
): Promise<PreparedDownloadSource | null> {
  const resize = resolveVariantResize(variant);
  if (resize) {
    if (!fs.existsSync(asset.storagePath)) {
      try {
        await restoreObjectToFileIfAvailable(asset.storageKey, asset.storagePath);
      } catch (error) {
        console.warn(
          `[download] result restore failed: project=${project.id} asset=${asset.id} key=${asset.storageKey ?? 'none'} ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (!fs.existsSync(asset.storagePath)) {
      console.warn(`[download] result missing: project=${project.id} asset=${asset.id} file=${asset.fileName}`);
      return null;
    }

    return {
      stream: createJpegVariantStream(asset.storagePath, 95, resize),
      mtime: fs.statSync(asset.storagePath).mtime
    };
  }

  if (fs.existsSync(asset.storagePath)) {
    return {
      stream: fs.createReadStream(asset.storagePath),
      mtime: fs.statSync(asset.storagePath).mtime
    };
  }

  if (!asset.storageKey) {
    console.warn(`[download] result missing: project=${project.id} asset=${asset.id} file=${asset.fileName}`);
    return null;
  }

  const response = await fetch(createObjectDownloadUrl(asset.storageKey, 60 * 60));
  if (!response.ok || !response.body) {
    console.warn(`[download] object fetch failed: project=${project.id} asset=${asset.id} status=${response.status}`);
    return null;
  }

  return {
    stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    mtime: new Date(project.updatedAt ?? Date.now())
  };
}

async function writeZipStreamEntry(input: {
  writer: ZipWriteCursor;
  centralChunks: Buffer[];
  relativeName: string;
  mtime: Date;
  source: AsyncIterable<Buffer | Uint8Array | string>;
}) {
  const name = Buffer.from(input.relativeName, 'utf8');
  const { dosTime, dosDate } = toDosDateTime(input.mtime);
  const offset = input.writer.offset;
  assertZip32Limit(offset, `${input.relativeName} offset`);

  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0808, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(0, 18);
  localHeader.writeUInt32LE(0, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  name.copy(localHeader, 30);

  await input.writer.write(localHeader);
  const { checksum, size } = await input.writer.copyFromReadable(input.source);
  assertZip32Limit(size, input.relativeName);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  await input.writer.write(descriptor);

  const centralHeader = Buffer.alloc(46 + name.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0808, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(dosTime, 12);
  centralHeader.writeUInt16LE(dosDate, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(size, 20);
  centralHeader.writeUInt32LE(size, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(offset, 42);
  name.copy(centralHeader, 46);
  input.centralChunks.push(centralHeader);
}

export async function streamProjectDownloadArchive(
  project: ProjectRecord,
  output: Writable,
  input?: ProjectDownloadOptions
) {
  const options = normalizeDownloadOptions(input);
  const orderedAssets = [...project.resultAssets].sort((left, right) => left.sortOrder - right.sortOrder);
  if (!orderedAssets.length) {
    throw new Error('Project does not have downloadable results yet.');
  }

  const baseName = getProjectDownloadBaseName(project);
  const addVariantSuffix = options.folderMode === 'flat' && options.variants.length > 1;
  const writer = new ZipWriteCursor(output);
  const centralChunks: Buffer[] = [];
  let writtenEntries = 0;

  try {
    for (const variant of options.variants) {
      const variantFolder = options.folderMode === 'grouped' ? getVariantFolderName(variant) : '';
      for (const [index, asset] of orderedAssets.entries()) {
        const source = await prepareAssetDownloadSource(project, asset, variant);
        if (!source) {
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
        const relativeName = path
          .join(baseName, variantFolder, targetFileName)
          .split(path.sep)
          .join('/');

        try {
          await writeZipStreamEntry({
            writer,
            centralChunks,
            relativeName,
            mtime: source.mtime,
            source: source.stream
          });
        } finally {
          source.cleanup?.();
        }
        writtenEntries += 1;
      }
    }

    if (!writtenEntries) {
      throw new Error('No files were prepared for download.');
    }
    if (writtenEntries > 0xffff) {
      throw new Error('Too many files for a single download archive.');
    }

    const centralOffset = writer.offset;
    const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
    assertZip32Limit(centralOffset, 'central directory offset');
    assertZip32Limit(centralSize, 'central directory size');

    for (const centralHeader of centralChunks) {
      await writer.write(centralHeader);
    }

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(writtenEntries, 8);
    endRecord.writeUInt16LE(writtenEntries, 10);
    endRecord.writeUInt32LE(centralSize, 12);
    endRecord.writeUInt32LE(centralOffset, 16);
    endRecord.writeUInt16LE(0, 20);

    await writer.write(endRecord);
    await writer.close();
  } catch (error) {
    output.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function calculateFileChecksum(filePath: string) {
  let value = 0xffffffff;
  let size = 0;

  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    value = crc32Update(value, buffer);
  }

  return {
    checksum: crc32Finalize(value),
    size
  };
}

async function writeZipArchive(sourceRoot: string, zipPath: string, rootFolderName: string) {
  const files = listFiles(sourceRoot);
  if (!files.length) {
    throw new Error('No files were prepared for download.');
  }
  if (files.length > 0xffff) {
    throw new Error('Too many files for a single download archive.');
  }

  const output = fs.createWriteStream(zipPath, { flags: 'wx' });
  const writer = new ZipWriteCursor(output);
  const centralChunks: Buffer[] = [];

  try {
    for (const filePath of files) {
      const relativeName = path
        .join(rootFolderName, path.relative(sourceRoot, filePath))
        .split(path.sep)
        .join('/');
      const name = Buffer.from(relativeName, 'utf8');
      const stats = fs.statSync(filePath);
      const { dosTime, dosDate } = toDosDateTime(stats.mtime);
      const { checksum, size } = await calculateFileChecksum(filePath);
      const offset = writer.offset;

      assertZip32Limit(size, relativeName);
      assertZip32Limit(offset, `${relativeName} offset`);

      const localHeader = Buffer.alloc(30 + name.length);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(checksum, 14);
      localHeader.writeUInt32LE(size, 18);
      localHeader.writeUInt32LE(size, 22);
      localHeader.writeUInt16LE(name.length, 26);
      localHeader.writeUInt16LE(0, 28);
      name.copy(localHeader, 30);

      const centralHeader = Buffer.alloc(46 + name.length);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(dosTime, 12);
      centralHeader.writeUInt16LE(dosDate, 14);
      centralHeader.writeUInt32LE(checksum, 16);
      centralHeader.writeUInt32LE(size, 20);
      centralHeader.writeUInt32LE(size, 24);
      centralHeader.writeUInt16LE(name.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      name.copy(centralHeader, 46);

      await writer.write(localHeader);
      await writer.copyFromFile(filePath);
      centralChunks.push(centralHeader);
    }

    const centralOffset = writer.offset;
    const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
    assertZip32Limit(centralOffset, 'central directory offset');
    assertZip32Limit(centralSize, 'central directory size');

    for (const centralHeader of centralChunks) {
      await writer.write(centralHeader);
    }

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(files.length, 8);
    endRecord.writeUInt16LE(files.length, 10);
    endRecord.writeUInt32LE(centralSize, 12);
    endRecord.writeUInt32LE(centralOffset, 16);
    endRecord.writeUInt16LE(0, 20);

    await writer.write(endRecord);
    await writer.close();
  } catch (error) {
    output.destroy();
    fs.rmSync(zipPath, { force: true });
    throw error;
  }
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
