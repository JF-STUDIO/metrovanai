import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { nanoid } from 'nanoid';
import { sanitizeSegment, toUnixPath } from './utils.js';

const DEFAULT_UPLOAD_EXPIRES_SECONDS = 15 * 60;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

interface ObjectStorageConfig {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  incomingPrefix: string;
  uploadExpiresSeconds: number;
  maxFileBytes: number;
}

export interface DirectObjectUploadTarget {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

function env(name: string) {
  return process.env[name]?.trim() ?? '';
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const enabled = ['true', '1', 'yes'].includes(env('METROVAN_DIRECT_UPLOAD_ENABLED').toLowerCase());
  const endpoint = env('METROVAN_OBJECT_STORAGE_ENDPOINT');
  const bucket = env('METROVAN_OBJECT_STORAGE_BUCKET');
  const accessKeyId = env('METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = env('METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY');

  if (!enabled || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    enabled,
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region: env('METROVAN_OBJECT_STORAGE_REGION') || 'auto',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: ['true', '1', 'yes'].includes(env('METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE').toLowerCase()),
    incomingPrefix: (env('METROVAN_OBJECT_STORAGE_INCOMING_PREFIX') || 'incoming').replace(/^\/+|\/+$/g, ''),
    uploadExpiresSeconds: parsePositiveInt(env('METROVAN_OBJECT_UPLOAD_EXPIRES_SECONDS'), DEFAULT_UPLOAD_EXPIRES_SECONDS),
    maxFileBytes: parsePositiveInt(env('METROVAN_OBJECT_UPLOAD_MAX_FILE_BYTES'), DEFAULT_MAX_FILE_BYTES)
  };
}

export function getDirectObjectUploadCapabilities() {
  const config = getObjectStorageConfig();
  return {
    enabled: Boolean(config),
    provider: config ? 's3-compatible' : null,
    maxFileBytes: config?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    uploadExpiresSeconds: config?.uploadExpiresSeconds ?? DEFAULT_UPLOAD_EXPIRES_SECONDS,
    requiredEnv: [
      'METROVAN_DIRECT_UPLOAD_ENABLED=true',
      'METROVAN_OBJECT_STORAGE_ENDPOINT',
      'METROVAN_OBJECT_STORAGE_BUCKET',
      'METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID',
      'METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'METROVAN_OBJECT_STORAGE_REGION'
    ]
  };
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeObjectKey(value: string) {
  return value.split('/').map(encodePathSegment).join('/');
}

function getObjectUrl(config: ObjectStorageConfig, key: string) {
  const endpointUrl = new URL(config.endpoint);
  const encodedKey = encodeObjectKey(key);

  if (config.forcePathStyle) {
    endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, '')}/${encodePathSegment(config.bucket)}/${encodedKey}`;
    return endpointUrl;
  }

  endpointUrl.hostname = `${config.bucket}.${endpointUrl.hostname}`;
  endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, '')}/${encodedKey}`;
  return endpointUrl;
}

function getSigningKey(config: ObjectStorageConfig, dateStamp: string) {
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function createPresignedUrl(config: ObjectStorageConfig, method: 'GET' | 'PUT', key: string, expiresSeconds: number) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const url = getObjectUrl(config, key);

  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', String(Math.min(604800, Math.max(1, expiresSeconds))));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');

  const canonicalQuery = Array.from(url.searchParams.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([keyName, value]) => `${encodeURIComponent(keyName)}=${encodeURIComponent(value)}`)
    .join('&');
  const canonicalHeaders = `host:${url.host}\n`;
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', getSigningKey(config, dateStamp)).update(stringToSign, 'utf8').digest('hex');
  url.searchParams.set('X-Amz-Signature', signature);

  return url.toString();
}

function buildIncomingStorageKey(input: { userKey: string; projectId: string; originalName: string }) {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Direct object upload is not configured.');
  }

  const fileName = sanitizeSegment(path.basename(input.originalName.replace(/\\/g, '/'))) || 'source';
  return toUnixPath(
    path.posix.join(
      config.incomingPrefix,
      sanitizeSegment(input.userKey) || 'user',
      sanitizeSegment(input.projectId) || 'project',
      nanoid(12),
      fileName
    )
  );
}

export function assertDirectObjectUploadConfigured() {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Direct object upload is not configured.');
  }
  return config;
}

export function isDirectUploadKeyForProject(input: { userKey: string; projectId: string; storageKey: string }) {
  const config = assertDirectObjectUploadConfigured();
  const prefix = toUnixPath(
    path.posix.join(
      config.incomingPrefix,
      sanitizeSegment(input.userKey) || 'user',
      sanitizeSegment(input.projectId) || 'project',
      ''
    )
  );
  return input.storageKey === prefix.slice(0, -1) || input.storageKey.startsWith(prefix);
}

export function createDirectObjectUploadTarget(input: {
  userKey: string;
  projectId: string;
  originalName: string;
  mimeType: string;
  size: number;
}) {
  const config = assertDirectObjectUploadConfigured();
  if (input.size <= 0 || input.size > config.maxFileBytes) {
    throw new Error('File is too large for direct upload.');
  }

  const storageKey = buildIncomingStorageKey(input);
  const uploadUrl = createPresignedUrl(config, 'PUT', storageKey, config.uploadExpiresSeconds);
  return {
    id: nanoid(12),
    originalName: input.originalName,
    size: input.size,
    mimeType: input.mimeType || 'application/octet-stream',
    storageKey,
    uploadUrl,
    method: 'PUT',
    headers: {
      'Content-Type': input.mimeType || 'application/octet-stream'
    },
    expiresAt: new Date(Date.now() + config.uploadExpiresSeconds * 1000).toISOString()
  } satisfies DirectObjectUploadTarget;
}

export async function downloadDirectObjectToFile(storageKey: string, targetPath: string) {
  const config = assertDirectObjectUploadConfigured();
  const downloadUrl = createPresignedUrl(config, 'GET', storageKey, config.uploadExpiresSeconds);
  const response = await fetch(downloadUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Object download failed: ${response.status}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>),
    fs.createWriteStream(targetPath, { flags: 'wx' })
  );
}
