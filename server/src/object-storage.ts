import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { nanoid } from 'nanoid';
import { delay, ensureDir, sanitizeSegment, toUnixPath } from './utils.js';

const DEFAULT_UPLOAD_EXPIRES_SECONDS = 60 * 60;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

interface ObjectStorageConfig {
  directUploadEnabled: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  incomingPrefix: string;
  persistentPrefix: string;
  uploadExpiresSeconds: number;
  maxFileBytes: number;
}

export type PersistentObjectCategory = 'originals' | 'previews' | 'hdr' | 'results' | 'work';

const PERSISTENT_CATEGORY_FOLDERS: Record<PersistentObjectCategory, string> = {
  originals: '原片',
  previews: '预览图',
  hdr: 'HDR完的',
  results: '处理完的',
  work: '临时文件'
};

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

export interface MultipartUploadPartUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface DirectObjectMultipartUpload {
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  uploadId: string;
}

function env(name: string) {
  return process.env[name]?.trim() ?? '';
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function isEnabledEnv(name: string) {
  return ['true', '1', 'yes'].includes(env(name).toLowerCase());
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientObjectStorageError(error: unknown) {
  const normalized = describeError(error).toLowerCase();
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('timeout') ||
    normalized.includes('temporarily') ||
    normalized.includes('socket')
  );
}

function isTransientObjectStorageStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function getObjectStorageConfig(options: { requireDirectUpload?: boolean } = {}): ObjectStorageConfig | null {
  const directUploadEnabled = isEnabledEnv('METROVAN_DIRECT_UPLOAD_ENABLED');
  const endpoint = env('METROVAN_OBJECT_STORAGE_ENDPOINT');
  const bucket = env('METROVAN_OBJECT_STORAGE_BUCKET');
  const accessKeyId = env('METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = env('METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY');

  if (options.requireDirectUpload && !directUploadEnabled) {
    return null;
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    directUploadEnabled,
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region: env('METROVAN_OBJECT_STORAGE_REGION') || 'auto',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: isEnabledEnv('METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE'),
    incomingPrefix: (env('METROVAN_OBJECT_STORAGE_INCOMING_PREFIX') || 'incoming').replace(/^\/+|\/+$/g, ''),
    persistentPrefix: (env('METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX') || 'projects').replace(/^\/+|\/+$/g, ''),
    uploadExpiresSeconds: parsePositiveInt(env('METROVAN_OBJECT_UPLOAD_EXPIRES_SECONDS'), DEFAULT_UPLOAD_EXPIRES_SECONDS),
    maxFileBytes: parsePositiveInt(env('METROVAN_OBJECT_UPLOAD_MAX_FILE_BYTES'), DEFAULT_MAX_FILE_BYTES)
  };
}

export function getDirectObjectUploadCapabilities() {
  const config = getObjectStorageConfig({ requireDirectUpload: true });
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

export function isObjectStorageConfigured() {
  return Boolean(getObjectStorageConfig());
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

function normalizeStorageKey(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function decodeXmlValue(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function buildUserFolder(input: { userKey: string; userDisplayName?: string | null }) {
  const userKey = sanitizeSegment(input.userKey) || 'user';
  const displayName = sanitizeSegment(input.userDisplayName ?? '');
  if (!displayName || displayName.toLowerCase() === userKey.toLowerCase()) {
    return userKey;
  }
  return `${displayName}-${userKey}`;
}

function buildProjectFolder(input: { projectId: string; projectName?: string | null }) {
  const projectId = sanitizeSegment(input.projectId) || 'project';
  const projectName = sanitizeSegment(input.projectName ?? '');
  if (!projectName || projectName.toLowerCase() === projectId.toLowerCase()) {
    return projectId;
  }
  return `${projectName}-${projectId}`;
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

function getBucketUrl(config: ObjectStorageConfig) {
  const endpointUrl = new URL(config.endpoint);

  if (config.forcePathStyle) {
    endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, '')}/${encodePathSegment(config.bucket)}`;
    return endpointUrl;
  }

  endpointUrl.hostname = `${config.bucket}.${endpointUrl.hostname}`;
  endpointUrl.pathname = endpointUrl.pathname || '/';
  return endpointUrl;
}

function getSigningKey(config: ObjectStorageConfig, dateStamp: string) {
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

type PresignedMethod = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';

function createPresignedUrl(
  config: ObjectStorageConfig,
  method: PresignedMethod,
  key: string,
  expiresSeconds: number,
  queryPairs: Array<[string, string]> = []
) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const url = getObjectUrl(config, key);

  for (const [keyName, value] of queryPairs) {
    url.searchParams.set(keyName, value);
  }
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

function escapeXmlValue(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeMultipartEtag(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed : `"${trimmed.replace(/^"+|"+$/g, '')}"`;
}

function createSignedHeaderRequest(
  config: ObjectStorageConfig,
  method: 'GET' | 'HEAD',
  url: URL,
  canonicalQuery: string
): { headers: Record<string, string> } {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    url.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', getSigningKey(config, dateStamp))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  };
}

function buildCanonicalQuery(pairs: Array<[string, string]>) {
  return pairs
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([keyName, value]) => `${encodeURIComponent(keyName)}=${encodeURIComponent(value)}`)
    .join('&');
}

function readXmlTagValues(xml: string, tagName: string) {
  const values: string[] = [];
  const matcher = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(xml))) {
    values.push(decodeXmlValue(match[1] ?? ''));
  }
  return values;
}

export async function listObjectStorageKeysByPrefix(prefix: string) {
  const config = getObjectStorageConfig();
  if (!config) {
    return [];
  }

  const keys: string[] = [];
  let continuationToken: string | null = null;
  do {
    const url = getBucketUrl(config);
    const queryPairs: Array<[string, string]> = [
      ['list-type', '2'],
      ['max-keys', '1000'],
      ['prefix', normalizeStorageKey(prefix)]
    ];
    if (continuationToken) {
      queryPairs.push(['continuation-token', continuationToken]);
    }
    const canonicalQuery = buildCanonicalQuery(queryPairs);
    url.search = canonicalQuery;
    const signed = createSignedHeaderRequest(config, 'GET', url, canonicalQuery);
    const response = await fetch(url, { method: 'GET', headers: signed.headers });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Object list failed: ${response.status} ${body}`.trim());
    }

    keys.push(...readXmlTagValues(body, 'Key'));
    const truncated = readXmlTagValues(body, 'IsTruncated')[0] === 'true';
    continuationToken = truncated ? (readXmlTagValues(body, 'NextContinuationToken')[0] ?? null) : null;
  } while (continuationToken);

  return keys;
}

export async function getObjectStorageMetadata(storageKey: string) {
  const config = getObjectStorageConfig();
  if (!config || !isConfiguredObjectStorageKey(storageKey)) {
    return null;
  }

  const url = getObjectUrl(config, normalizeStorageKey(storageKey));
  const canonicalQuery = '';
  const signed = createSignedHeaderRequest(config, 'HEAD', url, canonicalQuery);
  const response = await fetch(url, { method: 'HEAD', headers: signed.headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Object metadata lookup failed: ${response.status}`);
  }

  const size = Number(response.headers.get('content-length') ?? '');
  return {
    storageKey: normalizeStorageKey(storageKey),
    size: Number.isFinite(size) && size >= 0 ? size : null,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  };
}

function buildIncomingProjectPrefix(
  config: ObjectStorageConfig,
  input: { userKey: string; projectId: string; userDisplayName?: string | null; projectName?: string | null }
) {
  return toUnixPath(
    path.posix.join(
      config.incomingPrefix,
      buildUserFolder(input),
      buildProjectFolder(input),
      PERSISTENT_CATEGORY_FOLDERS.originals,
      ''
    )
  );
}

function buildLegacyIncomingProjectPrefix(config: ObjectStorageConfig, input: { userKey: string; projectId: string }) {
  return toUnixPath(
    path.posix.join(
      config.incomingPrefix,
      sanitizeSegment(input.userKey) || 'user',
      sanitizeSegment(input.projectId) || 'project',
      ''
    )
  );
}

function hasNormalizedIncomingProjectIdentity(
  config: ObjectStorageConfig,
  input: { userKey: string; projectId: string; storageKey: string }
) {
  return hasNormalizedProjectIdentity(config.incomingPrefix, input);
}

function hasNormalizedPersistentProjectIdentity(
  config: ObjectStorageConfig,
  input: { userKey: string; projectId: string; storageKey: string }
) {
  return hasNormalizedProjectIdentity(config.persistentPrefix, input);
}

function hasNormalizedProjectIdentity(
  rootPrefix: string,
  input: { userKey: string; projectId: string; storageKey: string }
) {
  const parts = normalizeStorageKey(input.storageKey).split('/').filter(Boolean);
  const userKey = sanitizeSegment(input.userKey) || 'user';
  const projectId = sanitizeSegment(input.projectId) || 'project';
  return (
    parts[0] === rootPrefix &&
    (parts[1] === userKey || parts[1]?.endsWith(`-${userKey}`)) &&
    (parts[2] === projectId || parts[2]?.endsWith(`-${projectId}`))
  );
}

function buildIncomingStorageKey(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
  originalName: string;
}) {
  const config = getObjectStorageConfig({ requireDirectUpload: true });
  if (!config) {
    throw new Error('Direct object upload is not configured.');
  }

  const fileName = sanitizeSegment(path.basename(input.originalName.replace(/\\/g, '/'))) || 'source';
  return toUnixPath(
    path.posix.join(
      buildIncomingProjectPrefix(config, input),
      nanoid(12),
      fileName
    )
  );
}

export function assertDirectObjectUploadConfigured() {
  const config = getObjectStorageConfig({ requireDirectUpload: true });
  if (!config) {
    throw new Error('Direct object upload is not configured.');
  }
  return config;
}

export function isDirectUploadKeyForProject(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
  storageKey: string;
}) {
  const config = assertDirectObjectUploadConfigured();
  const storageKey = normalizeStorageKey(input.storageKey);
  const prefixes = [buildIncomingProjectPrefix(config, input), buildLegacyIncomingProjectPrefix(config, input)];
  return (
    prefixes.some((prefix) => storageKey === prefix.slice(0, -1) || storageKey.startsWith(prefix)) ||
    hasNormalizedIncomingProjectIdentity(config, { ...input, storageKey })
  );
}

export function createDirectObjectUploadTarget(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
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

export async function createDirectObjectMultipartUpload(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
  originalName: string;
  mimeType: string;
  size: number;
}): Promise<DirectObjectMultipartUpload> {
  const config = assertDirectObjectUploadConfigured();
  if (input.size <= 0 || input.size > config.maxFileBytes) {
    throw new Error('File is too large for direct upload.');
  }

  const storageKey = buildIncomingStorageKey(input);
  const url = createPresignedUrl(config, 'POST', storageKey, config.uploadExpiresSeconds, [['uploads', '']]);
  const response = await fetch(url, { method: 'POST' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Multipart upload initiation failed: ${response.status} ${body}`.trim());
  }

  const uploadId = readXmlTagValues(body, 'UploadId')[0];
  if (!uploadId) {
    throw new Error('Multipart upload initiation did not return an upload id.');
  }

  return {
    originalName: input.originalName,
    size: input.size,
    mimeType: input.mimeType || 'application/octet-stream',
    storageKey,
    uploadId
  };
}

export function createMultipartUploadPartUrl(input: {
  storageKey: string;
  uploadId: string;
  partNumber: number;
  expiresSeconds?: number;
}): MultipartUploadPartUrl {
  const config = assertDirectObjectUploadConfigured();
  const expiresSeconds = input.expiresSeconds ?? Math.min(config.uploadExpiresSeconds, 15 * 60);
  return {
    partNumber: input.partNumber,
    url: createPresignedUrl(config, 'PUT', normalizeStorageKey(input.storageKey), expiresSeconds, [
      ['partNumber', String(input.partNumber)],
      ['uploadId', input.uploadId]
    ]),
    expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString()
  };
}

export async function completeMultipartObjectUpload(input: {
  storageKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  const config = assertDirectObjectUploadConfigured();
  const partsXml = [...input.parts]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map(
      (part) =>
        `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXmlValue(normalizeMultipartEtag(part.etag))}</ETag></Part>`
    )
    .join('');
  const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
  const url = createPresignedUrl(config, 'POST', normalizeStorageKey(input.storageKey), config.uploadExpiresSeconds, [
    ['uploadId', input.uploadId]
  ]);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml'
    },
    body
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Multipart upload completion failed: ${response.status} ${responseBody}`.trim());
  }

  return {
    etag: readXmlTagValues(responseBody, 'ETag')[0] ?? null
  };
}

export async function abortMultipartObjectUpload(input: { storageKey: string; uploadId: string }) {
  const config = assertDirectObjectUploadConfigured();
  const url = createPresignedUrl(config, 'DELETE', normalizeStorageKey(input.storageKey), config.uploadExpiresSeconds, [
    ['uploadId', input.uploadId]
  ]);
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Multipart upload abort failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
  }
}

export function createObjectDownloadUrl(storageKey: string, expiresSeconds?: number) {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured.');
  }
  return createPresignedUrl(config, 'GET', storageKey, expiresSeconds ?? config.uploadExpiresSeconds);
}

export function createPersistentObjectKey(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
  category: PersistentObjectCategory;
  fileName: string;
}) {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured.');
  }

  const fileName = sanitizeSegment(path.basename(input.fileName.replace(/\\/g, '/'))) || 'asset';
  return toUnixPath(
    path.posix.join(
      config.persistentPrefix,
      buildUserFolder(input),
      buildProjectFolder(input),
      PERSISTENT_CATEGORY_FOLDERS[input.category],
      `${nanoid(10)}-${fileName}`
    )
  );
}

export function isConfiguredObjectStorageKey(storageKey: string | null | undefined) {
  const config = getObjectStorageConfig();
  if (!config || !storageKey) {
    return false;
  }

  const normalizedKey = normalizeStorageKey(storageKey);
  const prefixes = [config.incomingPrefix, config.persistentPrefix].filter(Boolean);
  return prefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`));
}

export async function uploadFileToObjectStorage(input: {
  sourcePath: string;
  storageKey: string;
  contentType?: string;
}) {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured.');
  }

  const uploadUrl = createPresignedUrl(config, 'PUT', input.storageKey, config.uploadExpiresSeconds);
  const contentLength = fs.statSync(input.sourcePath).size;
  const headers: Record<string, string> = {
    'Content-Length': String(contentLength)
  };
  if (input.contentType) {
    headers['Content-Type'] = input.contentType;
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: fs.createReadStream(input.sourcePath) as unknown as BodyInit,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' });

      if (response.ok) {
        return {
          storageKey: input.storageKey,
          downloadUrl: createObjectDownloadUrl(input.storageKey)
        };
      }

      const message = `Object upload failed: ${response.status} ${await response.text().catch(() => '')}`.trim();
      const error = new Error(message);
      lastError = error;
      if (attempt >= 6 || !isTransientObjectStorageStatus(response.status)) {
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= 6 || !isTransientObjectStorageError(error)) {
        throw new Error(`Object upload failed after retries. ${describeError(error)}`);
      }
    }

    await delay(Math.min(15000, 1500 * attempt));
  }

  throw new Error(`Object upload failed after retries. ${describeError(lastError)}`);
}

export async function mirrorLocalFileToObjectStorage(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
  category: PersistentObjectCategory;
  sourcePath: string;
  fileName?: string;
  contentType?: string;
}) {
  if (!isObjectStorageConfigured() || !fs.existsSync(input.sourcePath)) {
    return null;
  }

  const storageKey = createPersistentObjectKey({
    userKey: input.userKey,
    projectId: input.projectId,
    userDisplayName: input.userDisplayName,
    projectName: input.projectName,
    category: input.category,
    fileName: input.fileName ?? path.basename(input.sourcePath)
  });
  return await uploadFileToObjectStorage({
    sourcePath: input.sourcePath,
    storageKey,
    contentType: input.contentType
  });
}

export async function deleteObjectFromStorage(storageKey: string) {
  const config = getObjectStorageConfig();
  if (!config || !isConfiguredObjectStorageKey(storageKey)) {
    return false;
  }

  const deleteUrl = createPresignedUrl(config, 'DELETE', normalizeStorageKey(storageKey), config.uploadExpiresSeconds);
  const response = await fetch(deleteUrl, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object delete failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
  }
  return true;
}

export async function deleteObjectsFromStorage(storageKeys: Iterable<string | null | undefined>) {
  const uniqueKeys = Array.from(
    new Set(
      Array.from(storageKeys)
        .map((key) => normalizeStorageKey(key))
        .filter((key) => key && isConfiguredObjectStorageKey(key))
    )
  );
  const failed: Array<{ storageKey: string; error: string }> = [];
  let deleted = 0;

  for (const storageKey of uniqueKeys) {
    try {
      if (await deleteObjectFromStorage(storageKey)) {
        deleted += 1;
      }
    } catch (error) {
      failed.push({
        storageKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { deleted, failed };
}

export async function deleteProjectIncomingObjects(input: {
  userKey: string;
  projectId: string;
  userDisplayName?: string | null;
  projectName?: string | null;
}) {
  const config = getObjectStorageConfig();
  if (!config) {
    return { deleted: 0, failed: [] as Array<{ storageKey: string; error: string }> };
  }

  const prefixes = Array.from(
    new Set([
      buildIncomingProjectPrefix(config, input),
      buildLegacyIncomingProjectPrefix(config, { userKey: input.userKey, projectId: input.projectId })
    ])
  );
  const storageKeys = new Set<string>();
  const failed: Array<{ storageKey: string; error: string }> = [];

  for (const prefix of prefixes) {
    try {
      for (const key of await listObjectStorageKeysByPrefix(prefix)) {
        storageKeys.add(key);
      }
    } catch (error) {
      failed.push({
        storageKey: prefix,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    for (const key of await listObjectStorageKeysByPrefix(`${config.incomingPrefix}/`)) {
      if (hasNormalizedIncomingProjectIdentity(config, { ...input, storageKey: key })) {
        storageKeys.add(key);
      }
    }
  } catch (error) {
    failed.push({
      storageKey: `${config.incomingPrefix}/`,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const cleanup = await deleteObjectsFromStorage(storageKeys);
  return {
    deleted: cleanup.deleted,
    failed: [...failed, ...cleanup.failed]
  };
}

export async function deleteProjectPersistentObjects(input: {
  userKey: string;
  projectId: string;
}) {
  const config = getObjectStorageConfig();
  if (!config) {
    return { deleted: 0, failed: [] as Array<{ storageKey: string; error: string }> };
  }

  const storageKeys = new Set<string>();
  const failed: Array<{ storageKey: string; error: string }> = [];

  try {
    for (const key of await listObjectStorageKeysByPrefix(`${config.persistentPrefix}/`)) {
      if (hasNormalizedPersistentProjectIdentity(config, { ...input, storageKey: key })) {
        storageKeys.add(key);
      }
    }
  } catch (error) {
    failed.push({
      storageKey: `${config.persistentPrefix}/`,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const cleanup = await deleteObjectsFromStorage(storageKeys);
  return {
    deleted: cleanup.deleted,
    failed: [...failed, ...cleanup.failed]
  };
}

export async function downloadObjectToFile(storageKey: string, targetPath: string, options?: { overwrite?: boolean }) {
  const downloadUrl = createObjectDownloadUrl(storageKey);
  const response = await fetch(downloadUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Object download failed: ${response.status}`);
  }

  ensureDir(path.dirname(targetPath));
  await pipeline(
    Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>),
    fs.createWriteStream(targetPath, { flags: options?.overwrite ? 'w' : 'wx' })
  );
}

export async function downloadDirectObjectToFile(storageKey: string, targetPath: string) {
  assertDirectObjectUploadConfigured();
  await downloadObjectToFile(storageKey, targetPath);
}

export async function restoreObjectToFileIfAvailable(storageKey: string | null | undefined, targetPath: string | null | undefined) {
  if (!storageKey || !targetPath || fs.existsSync(targetPath) || !isObjectStorageConfigured()) {
    return false;
  }

  await downloadObjectToFile(storageKey, targetPath);
  return true;
}
