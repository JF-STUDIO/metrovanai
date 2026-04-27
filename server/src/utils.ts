import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(target: string) {
  fs.mkdirSync(target, { recursive: true });
}

export function loadJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export function sanitizeSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function normalizeHex(input: string | null | undefined) {
  if (!input) {
    return null;
  }

  const value = input.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(value) ? value : null;
}

export function toUnixPath(value: string) {
  return value.replace(/\\/g, '/');
}

export function getFileStem(fileName: string) {
  return path.basename(fileName, path.extname(fileName));
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isImageExtension(extension: string) {
  return new Set(['.jpg', '.jpeg']).has(extension.toLowerCase());
}

export function isRawExtension(extension: string) {
  return new Set([
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
  ]).has(extension.toLowerCase());
}

export function safeUnlink(targetPath: string | null | undefined) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }

  try {
    fs.rmSync(targetPath, { force: true });
  } catch {
    // ignore
  }
}

export function safeRemoveDir(targetPath: string | null | undefined) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }

  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function createProgressLabel(current: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}
