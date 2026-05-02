import type {
  BillingEntry,
  BillingPackage,
  BillingSummary,
  AdminFailedPhotoRow,
  PaymentOrderRecord,
  PaymentOrderRefundPreview,
  ProjectRecord
} from './types';
import { sendClientEvent } from './observability';
import {
  appendPersistedCompleted,
  clearPersistedProject,
  dropPersistedMultipart,
  readPersistedCompleted,
  readPersistedMultipart,
  upsertPersistedMultipart
} from './upload-resume';

const LOCAL_API_ROOT = 'http://127.0.0.1:8787';
const PRODUCTION_API_ROOT = 'https://api.metrovanai.com';

function resolveApiRoot() {
  const configured = import.meta.env.VITE_METROVAN_API_URL?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return LOCAL_API_ROOT;
    }

    return PRODUCTION_API_ROOT;
  }

  return LOCAL_API_ROOT;
}

const API_ROOT = resolveApiRoot();
let csrfToken = '';

function isLocalDevelopmentOrigin() {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export interface AuthSessionPayload {
  csrfToken?: string;
  user: {
    id: string;
    userKey: string;
    email: string;
    emailVerifiedAt: string | null;
    displayName: string;
    locale: 'zh' | 'en';
    role: 'user' | 'admin';
    accountStatus: 'active' | 'disabled';
  };
}

function captureCsrfToken(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const record = payload as Record<string, unknown>;
  const maybeSession = record.session;
  if (maybeSession && typeof maybeSession === 'object') {
    const token = (maybeSession as Record<string, unknown>).csrfToken;
    if (typeof token === 'string' && token) {
      csrfToken = token;
    }
  }
}

function buildRequestHeaders(init?: RequestInit): HeadersInit {
  const headers = new Headers(init?.headers);

  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (csrfToken && init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  return headers;
}

function isCsrfVerificationError(error: ApiRequestError) {
  return (
    error.status === 403 &&
    (
      error.message.includes('CSRF token is required') ||
      error.message.includes('请求验证失败') ||
      error.message.includes('Refresh and try again')
    )
  );
}

export interface RegisterEmailPayload {
  session?: AuthSessionPayload;
  verificationRequired?: boolean;
  email?: string;
}

export interface DownloadVariantInput {
  key: 'hd' | 'custom';
  label: string;
  longEdge?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface DownloadRequestPayload {
  folderMode: 'grouped' | 'flat';
  namingMode: 'original' | 'sequence' | 'custom-prefix';
  customPrefix?: string;
  variants: DownloadVariantInput[];
}

export interface DownloadJobPayload {
  jobId: string;
  status: 'queued' | 'preflight' | 'packaging' | 'uploading' | 'ready' | 'failed' | 'cancelled';
  progress: number;
  downloadUrl: string | null;
  expiresAt: string | null;
  error: string | null;
}

export interface ResultThumbnailManifestItem {
  assetId: string;
  sortOrder?: number;
  fileName?: string;
  url: string;
  width: number;
  height: number;
}

export interface BillingPayload {
  summary: BillingSummary;
  entries: BillingEntry[];
  orders: PaymentOrderRecord[];
  packages: BillingPackage[];
}

export interface CheckoutPayload {
  order: PaymentOrderRecord;
  sessionId: string;
  checkoutUrl: string;
}

export interface CheckoutConfirmPayload {
  order: PaymentOrderRecord;
  billing: BillingPayload;
}

export interface UploadCapabilitiesPayload {
  localProxy: {
    enabled: boolean;
    maxBatchBytes: number;
    maxBatchFiles: number;
    recommendedConcurrency: number;
  };
  directObject: {
    enabled: boolean;
    provider: 's3-compatible' | null;
    maxFileBytes: number;
    uploadExpiresSeconds: number;
    requiredEnv: string[];
  };
  directUploadTargets?: {
    maxFiles: number;
    maxBatchBytes: number;
  };
}

export type UploadProgressStage =
  | 'preparing'
  | 'verifying'
  | 'uploading'
  | 'retrying'
  | 'paused'
  | 'finalizing'
  | 'completed';

export interface UploadProgressSnapshot {
  stage: UploadProgressStage;
  percent: number;
  uploadedFiles: number;
  totalFiles: number;
  uploadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number;
  currentFileName?: string;
  attempt?: number;
  maxAttempts?: number;
  offline?: boolean;
}

export type UploadProgressHandler = (percent: number, snapshot?: UploadProgressSnapshot) => void;

export type UploadFailureReason = 'network' | 'cors' | 'r2-5xx' | 'too-large' | 'cancelled' | 'unknown';

export interface FailedUploadFile {
  fileIdentity: string;
  fileName: string;
  reason: UploadFailureReason;
  lastError: string;
}

export interface UploadPauseController {
  isPaused: () => boolean;
  waitUntilResumed: (signal?: AbortSignal) => Promise<void>;
}

export interface UploadFilesOptions {
  signal?: AbortSignal;
  completedObjects?: UploadedObjectReference[];
  onFileUploaded?: (uploaded: UploadedObjectReference) => void;
  onFileFailed?: (failed: FailedUploadFile) => void;
  pauseController?: UploadPauseController;
  continueOnFileError?: boolean;
}

interface DirectUploadTarget {
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

interface DirectUploadTargetLimits {
  maxFiles: number;
  maxBatchBytes: number;
}

interface PendingDirectUploadFile {
  file: File;
  index: number;
}

type PreparedDirectUploadTargets = Map<number, DirectUploadTarget>;

interface MultipartUploadPartUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

interface MultipartUploadInitPayload {
  storageKey: string;
  uploadId: string;
  partSize: number;
  partUrls: MultipartUploadPartUrl[];
}

export interface UploadedObjectReference {
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
}

export interface AdminUserSummary {
  id: string;
  userKey: string;
  email: string;
  emailVerifiedAt: string | null;
  displayName: string;
  locale: 'zh' | 'en';
  role: 'user' | 'admin';
  accountStatus: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  auth: {
    password: boolean;
    google: boolean;
  };
  projectCount: number;
  completedProjectCount: number;
  processingProjectCount: number;
  photoCount: number;
  resultCount: number;
  activeSessionCount: number;
  billingSummary: BillingSummary;
}

export interface AdminUsersPayload {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: AdminUserSummary[];
}

export interface AdminProjectsPayload {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: ProjectRecord[];
}

export interface AdminFailedPhotosPayload {
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  pageCount: number;
  causeCounts: Record<string, { title: string; count: number }>;
  items: AdminFailedPhotoRow[];
}

export interface AdminProjectRecoverySummary {
  projectId: string;
  status: 'done' | 'active' | 'missing' | 'idle';
  attempted: number;
  recovered: number;
  failed: number;
}

export type AdminProjectRepairAction =
  | 'retry-failed-processing'
  | 'regenerate-download'
  | 'mark-stalled-failed'
  | 'acknowledge-maintenance';

export interface AdminProjectRepairPayload {
  action: AdminProjectRepairAction;
  summary: {
    status: string;
    message: string;
    failedItems?: number;
    jobId?: string;
    jobStatus?: string;
    reused?: boolean;
  };
  project: ProjectRecord;
  job?: {
    jobId: string;
    status: string;
    progress: number;
    error?: string | null;
  };
}

export interface AdminMaintenanceReportSummary {
  id: string;
  fileName: string;
  startedAt: string | null;
  completedAt: string | null;
  ok: boolean;
  failedCount: number;
  totals: { projects?: number; hdrItems?: number; downloadJobs?: number } | null;
  alerts: Array<{ code: string; value: number }>;
  reviewedProjects: Array<{
    projectId: string;
    projectName: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
    note: string | null;
  }>;
  priorityQueue: Array<{
    projectId: string;
    projectName: string;
    priority: 'high' | 'medium' | 'low' | string;
    score: number;
    errorCount: number;
    warningCount: number;
    rootCauseSummary: string;
    recommendedActionLabels?: string[];
  }>;
  checks: Array<{
    id: string;
    ok: boolean;
    status: number | string | null;
    latestStatus: string | null;
    alertCount: number;
    error: string | null;
  }>;
  alert: { sent?: boolean; recipients?: number; reason?: string; error?: string } | null;
}

export interface AdminMaintenanceReportsPayload {
  total: number;
  items: AdminMaintenanceReportSummary[];
}

export interface AdminOrdersPayload {
  total: number;
  items: PaymentOrderRecord[];
}

export interface AdminOrderRefundPreviewPayload {
  order: PaymentOrderRecord;
  preview: PaymentOrderRefundPreview;
}

export interface AdminOrderRefundPayload {
  order: PaymentOrderRecord;
  preview: PaymentOrderRefundPreview;
  refundStatus: string;
  message?: string;
  billing?: BillingPayload;
}

export interface AdminOpsHealthPayload {
  generatedAt: string;
  totals: {
    projects: number;
    photos: number;
    completedPhotos: number;
    failedPhotos: number;
    runningHubTasks: number;
    resultRecoveryProjects: number;
    creditMismatchProjects: number;
    stalledProcessingProjects: number;
  };
  rates: {
    failedItemRate: number;
    runningHubSuccessRate: number;
    resultReturnFailureRate: number;
  };
  samples: {
    resultRecoveryProjectIds: string[];
    creditMismatchProjectIds: string[];
    stalledProcessingProjectIds: string[];
  };
  alerts: Array<{ level: 'warning' | 'error'; code: string; value: number; threshold: number }>;
}

export interface AdminUserListQuery {
  search?: string;
  role?: 'all' | 'user' | 'admin';
  accountStatus?: 'all' | 'active' | 'disabled';
  emailVerified?: 'all' | 'verified' | 'unverified';
  page?: number;
  pageSize?: number;
}

export interface AdminUserProjectsPayload {
  user: Omit<AdminUserSummary, 'projectCount' | 'completedProjectCount' | 'processingProjectCount' | 'photoCount' | 'resultCount' | 'activeSessionCount' | 'lastSeenAt'>;
  items: ProjectRecord[];
}

export interface AdminAuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: 'admin-user' | 'admin-key' | 'system';
  action: string;
  targetUserId: string | null;
  targetProjectId: string | null;
  ipAddress: string;
  userAgent: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AdminUserDetailPayload {
  user: AdminUserSummary;
  projects: ProjectRecord[];
  billingEntries: BillingEntry[];
  auditLogs: AdminAuditLogEntry[];
}

export interface AdminBillingLedgerRow extends BillingEntry {
  userId: string;
  userEmail: string;
  userDisplayName: string;
}

export interface AdminBillingLedgerPayload {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totals: {
    chargePoints: number;
    creditPoints: number;
    amountUsd: number;
  };
  items: AdminBillingLedgerRow[];
}

export interface AdminProjectCostRow {
  projectId: string;
  projectName: string;
  userKey: string;
  userDisplayName: string;
  status: ProjectRecord['status'];
  photoCount: number;
  resultCount: number;
  chargedPoints: number;
  refundedPoints: number;
  netPoints: number;
  revenueUsd: number;
  runningHubRuns: number;
  workflowRuns: number;
  regenerationRuns: number;
  runningHubCostUsd: number;
  profitUsd: number;
  updatedAt: string;
}

export interface AdminProjectCostsPayload {
  unitCostUsd: number;
  totals: {
    projects: number;
    revenueUsd: number;
    runningHubRuns: number;
    runningHubCostUsd: number;
    profitUsd: number;
    netPoints: number;
  };
  items: AdminProjectCostRow[];
}

export interface AdminActivationCode {
  id: string;
  code: string;
  label: string;
  active: boolean;
  packageId: string | null;
  packageName: string | null;
  discountPercentOverride: number | null;
  bonusPoints: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminActivationCodesPayload {
  items: AdminActivationCode[];
  packages: BillingPackage[];
}

export interface AdminSystemSettings {
  runpodHdrBatchSize: number;
  runningHubMaxInFlight: number;
  billingPackages: BillingPackage[];
  studioFeatures: StudioFeatureConfig[];
}

export interface StudioFeatureConfig {
  id: string;
  enabled: boolean;
  category: 'all' | 'interior' | 'exterior' | 'special' | 'new';
  status: 'available' | 'beta';
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  detailZh: string;
  detailEn: string;
  tagZh: string;
  tagEn: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  workflowId: string;
  inputNodeId: string;
  outputNodeId: string;
  pointsPerPhoto: number;
  tone: 'warm' | 'white' | 'dusk' | 'blue' | 'season';
}

export interface AdminWorkflowSummary {
  executor: {
    provider: string;
    workflowEngine?: string;
    location?: string;
    root?: string;
  };
  apiKeyConfigured: boolean;
  active: string;
  settings: {
    inputMode: string;
    groupMode: string;
    saveHDR: boolean;
    saveGroups: boolean;
    workflowMaxInFlight: number;
  };
  items: Array<{
    name: string;
    type: string;
    purpose: string | null;
    colorCardNo: string | number | null;
    workflowId: string | null;
    instanceType: string | null;
    inputCount: number;
    outputCount: number;
    inputNodeIds: string[];
    outputNodeIds: string[];
    promptNodeId: string | null;
  }>;
}

export interface AdminActivationCodeInput {
  code: string;
  label: string;
  active?: boolean;
  packageId?: string | null;
  discountPercentOverride?: number | null;
  bonusPoints?: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}

export interface TopUpRequestInput {
  packageId?: string;
  customAmountUsd?: number;
  activationCode?: string;
}

export interface AuthProvidersPayload {
  google: {
    enabled: boolean;
  };
}

const MAX_UPLOAD_BATCH_BYTES = 40 * 1024 * 1024;
const MAX_UPLOAD_BATCH_FILES = 16;
const MAX_UPLOAD_CONCURRENT_BATCHES = 4;
const DIRECT_OBJECT_UPLOAD_SMALL_FILE_CONCURRENCY = 6;
const DIRECT_OBJECT_UPLOAD_LARGE_FILE_CONCURRENCY = 4;
const DIRECT_OBJECT_UPLOAD_HUGE_FILE_CONCURRENCY = 2;
const MAX_UPLOAD_BATCH_RETRIES = 5;
const UPLOAD_RETRY_BASE_DELAY_MS = 850;
const UPLOAD_RETRY_JITTER_MS = 650;
const UPLOAD_API_RETRY_MAX_ATTEMPTS = 6;
const UPLOAD_API_RETRY_MAX_DELAY_MS = 60_000;
const DIRECT_OBJECT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const LARGE_DIRECT_OBJECT_FILE_BYTES = 120 * 1024 * 1024;
const HUGE_DIRECT_OBJECT_FILE_BYTES = 350 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 512 * 1024 * 1024;
const MULTIPART_PART_CONCURRENCY = 3;
const MULTIPART_PART_RETRIES = 5;
const DIRECT_OBJECT_GLOBAL_CONNECTION_LIMIT = 12;
const ADAPTIVE_UPLOAD_MIN_CONCURRENCY = 2;
const ADAPTIVE_UPLOAD_MAX_CONCURRENCY = 12;
const ADAPTIVE_UPLOAD_LOW_BPS = 768 * 1024;
const ADAPTIVE_UPLOAD_HIGH_BPS = 3 * 1024 * 1024;
const ADAPTIVE_UPLOAD_SAMPLE_MS = 2000;
const UPLOAD_TELEMETRY_SAMPLE_MS = 12000;
const UPLOAD_TELEMETRY_MIN_SPAN_MS = 3000;
const DEFAULT_DIRECT_UPLOAD_TARGET_MAX_FILES = 300;
const DEFAULT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES = 30 * 1024 * 1024 * 1024;
const CLIENT_DIRECT_UPLOAD_TARGET_MAX_FILES = 48;
const CLIENT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES = 6 * 1024 * 1024 * 1024;
let deprecatedUploadFileBatchWarningShown = false;

class ThroughputSampler {
  private samples: Array<{ ts: number; bytes: number }> = [];
  private readonly windowMs: number;
  private readonly minSpanMs: number;

  constructor(windowMs = ADAPTIVE_UPLOAD_SAMPLE_MS, minSpanMs = 750) {
    this.windowMs = windowMs;
    this.minSpanMs = minSpanMs;
  }

  recordBytes(bytes: number) {
    const now = Date.now();
    this.samples.push({ ts: now, bytes });
    this.samples = this.samples.filter((sample) => now - sample.ts < this.windowMs);
  }

  bytesPerSecond() {
    if (this.samples.length < 2) {
      return 0;
    }
    const total = this.samples.reduce((sum, sample) => sum + sample.bytes, 0);
    const spanMs = this.samples[this.samples.length - 1]!.ts - this.samples[0]!.ts;
    const spanSeconds = Math.max(this.minSpanMs, spanMs) / 1000;
    return spanSeconds > 0 ? total / spanSeconds : 0;
  }
}

class UploadConnectionLimiter {
  private active = 0;
  private readonly limit: number;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort: () => void;
  }> = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal) {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Upload cancelled.', 'AbortError'));
    }
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', waiter.abort);
          resolve();
        },
        reject,
        signal,
        abort: () => {
          this.removeWaiter(waiter);
          reject(new DOMException('Upload cancelled.', 'AbortError'));
        }
      };
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  private removeWaiter(waiter: (typeof this.waiters)[number]) {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}

const directUploadConnectionLimiter = new UploadConnectionLimiter(DIRECT_OBJECT_GLOBAL_CONNECTION_LIMIT);

function buildUploadTelemetry(uploadedBytes: number, totalBytes: number, bytesPerSecond?: number) {
  const safeUploadedBytes = Math.min(Math.max(0, uploadedBytes), Math.max(1, totalBytes));
  const safeTotalBytes = Math.max(1, totalBytes);
  const safeBytesPerSecond = Number.isFinite(bytesPerSecond ?? Number.NaN) && (bytesPerSecond ?? 0) > 0 ? bytesPerSecond : undefined;
  const estimatedSecondsRemaining = safeBytesPerSecond
    ? Math.max(0, Math.ceil((safeTotalBytes - safeUploadedBytes) / safeBytesPerSecond))
    : undefined;
  return {
    uploadedBytes: safeUploadedBytes,
    totalBytes: safeTotalBytes,
    bytesPerSecond: safeBytesPerSecond,
    estimatedSecondsRemaining
  };
}

function extractErrorMessage(input: unknown): string | null {
  if (typeof input === 'string') {
    const normalized = input.trim();
    return normalized || null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const message = extractErrorMessage(item);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const directKeys = ['message', 'error', 'detail', 'details'] as const;
  for (const key of directKeys) {
    const message = extractErrorMessage(record[key]);
    if (message) {
      return message;
    }
  }

  const formErrors = extractErrorMessage(record.formErrors);
  if (formErrors) {
    return formErrors;
  }

  const fieldErrors = record.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    for (const value of Object.values(fieldErrors as Record<string, unknown>)) {
      const message = extractErrorMessage(value);
      if (message) {
        return message;
      }
    }
  }

  for (const value of Object.values(record)) {
    const message = extractErrorMessage(value);
    if (message) {
      return message;
    }
  }

  return null;
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `Request failed: ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return extractErrorMessage(parsed) ?? text;
  } catch {
    return text;
  }
}

export class ApiRequestError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(UPLOAD_API_RETRY_MAX_DELAY_MS, Math.round(seconds * 1000));
  }
  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.min(UPLOAD_API_RETRY_MAX_DELAY_MS, Math.max(0, retryAt - Date.now()));
  }
  return null;
}

async function refreshCsrfToken() {
  const response = await fetch(`${API_ROOT}/api/auth/session`, {
    credentials: 'include',
    headers: buildRequestHeaders({ method: 'GET' })
  });
  if (!response.ok) {
    throw new ApiRequestError(await readErrorMessage(response), response.status, parseRetryAfterMs(response.headers.get('Retry-After')));
  }
  const payload = (await response.json()) as { session: AuthSessionPayload | null };
  captureCsrfToken(payload);
  return payload;
}

async function jsonRequest<T>(requestPath: string, init?: RequestInit, options: { retryCsrf?: boolean } = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${requestPath}`, {
    credentials: 'include',
    ...init,
    headers: buildRequestHeaders(init)
  });

  if (!response.ok) {
    const error = new ApiRequestError(await readErrorMessage(response), response.status, parseRetryAfterMs(response.headers.get('Retry-After')));
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (
      options.retryCsrf !== false &&
      isCsrfVerificationError(error) &&
      method !== 'GET' &&
      !requestPath.startsWith('/api/auth/')
    ) {
      await refreshCsrfToken();
      return await jsonRequest<T>(requestPath, init, { retryCsrf: false });
    }
    throw error;
  }

  const payload = (await response.json()) as T;
  captureCsrfToken(payload);
  return payload;
}

export function getApiRoot() {
  return API_ROOT;
}

export async function fetchSession() {
  return await jsonRequest<{ session: AuthSessionPayload | null }>('/api/auth/session');
}

export async function fetchAuthProviders() {
  return await jsonRequest<AuthProvidersPayload>('/api/auth/providers');
}

let _cachedCapabilities: UploadCapabilitiesPayload | null = null;
let _capabilitiesCacheExpiry = 0;

export async function fetchUploadCapabilities() {
  if (_cachedCapabilities && Date.now() < _capabilitiesCacheExpiry) {
    return _cachedCapabilities;
  }
  const result = await jsonRequest<UploadCapabilitiesPayload>('/api/upload/capabilities');
  _cachedCapabilities = result;
  _capabilitiesCacheExpiry = Date.now() + 60_000;
  return result;
}

export async function registerWithEmail(input: { email: string; displayName?: string; password: string }) {
  return await jsonRequest<RegisterEmailPayload>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function loginWithEmail(input: { email: string; password: string }) {
  return await jsonRequest<{ session: AuthSessionPayload }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function requestPasswordReset(input: { email: string }) {
  return await jsonRequest<{ ok: true }>('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function confirmPasswordReset(input: { token: string; password: string }) {
  return await jsonRequest<{ ok: true }>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function confirmEmailVerification(input: { token: string }) {
  return await jsonRequest<{ session: AuthSessionPayload }>('/api/auth/email-verification/confirm', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function resendEmailVerification(input: { email: string }) {
  return await jsonRequest<{ ok: true }>('/api/auth/email-verification/resend', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function logoutSession() {
  return await jsonRequest<{ ok: true }>('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function updateAccountSettings(input: { displayName: string; locale: 'zh' | 'en' }) {
  return await jsonRequest<{ session: AuthSessionPayload }>('/api/account/settings', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function fetchBilling() {
  return await jsonRequest<BillingPayload>('/api/billing');
}

function buildTopUpRequestBody(input: TopUpRequestInput) {
  return JSON.stringify({
    packageId: input.packageId,
    customAmountUsd: input.customAmountUsd,
    activationCode: input.activationCode?.trim() || undefined
  });
}

export async function topUpBalance(input: TopUpRequestInput) {
  return await jsonRequest<BillingPayload>('/api/billing/top-up', {
    method: 'POST',
    body: buildTopUpRequestBody(input)
  });
}

export async function createCheckoutSession(input: TopUpRequestInput) {
  return await jsonRequest<CheckoutPayload>('/api/billing/checkout', {
    method: 'POST',
    body: buildTopUpRequestBody(input)
  });
}

export async function redeemActivationCode(input: { activationCode: string }) {
  return await jsonRequest<{ entry: BillingEntry; billing: BillingPayload }>('/api/billing/activation-code/redeem', {
    method: 'POST',
    body: JSON.stringify({ activationCode: input.activationCode.trim() })
  });
}

export async function confirmCheckoutSession(sessionId: string) {
  return await jsonRequest<CheckoutConfirmPayload>('/api/billing/checkout/confirm', {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  });
}

export async function fetchAdminUsers(query: AdminUserListQuery = {}) {
  const params = new URLSearchParams();
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.role && query.role !== 'all') params.set('role', query.role);
  if (query.accountStatus && query.accountStatus !== 'all') params.set('accountStatus', query.accountStatus);
  if (query.emailVerified && query.emailVerified !== 'all') params.set('emailVerified', query.emailVerified);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const queryString = params.toString();
  return await jsonRequest<AdminUsersPayload>(`/api/admin/users${queryString ? `?${queryString}` : ''}`);
}

export async function fetchAdminProjects(query: { page?: number; pageSize?: number; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.limit) params.set('limit', String(query.limit));
  return await jsonRequest<AdminProjectsPayload>(`/api/admin/projects?${params.toString()}`);
}

export async function fetchAdminProjectDetail(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/admin/projects/${encodeURIComponent(projectId)}`);
}

export async function fetchAdminFailedPhotos(query: { page?: number; pageSize?: number; search?: string; cause?: string } = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.cause && query.cause !== 'all') params.set('cause', query.cause);
  return await jsonRequest<AdminFailedPhotosPayload>(`/api/admin/failed-photos?${params.toString()}`);
}

export async function runAdminProjectDeepHealth(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord; deepHealth: NonNullable<ProjectRecord['adminDeepHealth']> }>(
    `/api/admin/projects/${encodeURIComponent(projectId)}/deep-health`,
    { method: 'POST' }
  );
}

export async function recoverAdminProjectRunningHubResults(projectId: string) {
  return await jsonRequest<{ summary: AdminProjectRecoverySummary; project: ProjectRecord | null }>(
    `/api/admin/projects/${encodeURIComponent(projectId)}/recover-runninghub-results`,
    { method: 'POST' }
  );
}

export async function repairAdminProject(projectId: string, action: AdminProjectRepairAction, options: { note?: string } = {}) {
  return await jsonRequest<AdminProjectRepairPayload>(`/api/admin/projects/${encodeURIComponent(projectId)}/repair`, {
    method: 'POST',
    body: JSON.stringify({ action, note: options.note })
  });
}

export async function fetchAdminMaintenanceReports(limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return await jsonRequest<AdminMaintenanceReportsPayload>(`/api/admin/maintenance/reports?${params.toString()}`);
}

export async function fetchAdminOrders(limit = 120) {
  const params = new URLSearchParams({ limit: String(limit) });
  return await jsonRequest<AdminOrdersPayload>(`/api/admin/orders?${params.toString()}`);
}

export async function fetchAdminBillingLedger(query: {
  search?: string;
  type?: 'all' | 'charge' | 'credit';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const params = new URLSearchParams();
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.type && query.type !== 'all') params.set('type', query.type);
  if (query.startDate?.trim()) params.set('startDate', query.startDate.trim());
  if (query.endDate?.trim()) params.set('endDate', query.endDate.trim());
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const queryString = params.toString();
  return await jsonRequest<AdminBillingLedgerPayload>(`/api/admin/billing-ledger${queryString ? `?${queryString}` : ''}`);
}

export async function fetchAdminProjectCosts() {
  return await jsonRequest<AdminProjectCostsPayload>('/api/admin/project-costs');
}

export async function fetchAdminOrderRefundPreview(orderId: string) {
  return await jsonRequest<AdminOrderRefundPreviewPayload>(
    `/api/admin/orders/${encodeURIComponent(orderId)}/refund-preview`
  );
}

export async function refundAdminOrder(orderId: string, confirmation: { email: string }) {
  return await jsonRequest<AdminOrderRefundPayload>(`/api/admin/orders/${encodeURIComponent(orderId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      confirm: true,
      confirmOrderId: orderId,
      confirmEmail: confirmation.email
    })
  });
}

export async function fetchAdminOpsHealth() {
  return await jsonRequest<AdminOpsHealthPayload>('/api/admin/ops/health');
}

export async function fetchAdminUserProjects(userId: string) {
  return await jsonRequest<AdminUserProjectsPayload>(`/api/admin/users/${encodeURIComponent(userId)}/projects`);
}

export async function fetchAdminUserDetail(userId: string) {
  return await jsonRequest<AdminUserDetailPayload>(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export async function updateAdminUser(
  userId: string,
  input: { role?: 'user' | 'admin'; accountStatus?: 'active' | 'disabled' }
) {
  return await jsonRequest<{ user: AdminUserSummary }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...input, confirm: true })
  });
}

export async function allowAdminUserAccess(userId: string) {
  return await jsonRequest<{ user: AdminUserSummary; auditLogs: AdminAuditLogEntry[] }>(
    `/api/admin/users/${encodeURIComponent(userId)}/allow-access`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true, confirmUserId: userId })
    }
  );
}

export async function adjustAdminUserBilling(
  userId: string,
  input: { type: 'credit' | 'charge'; points: number; note: string }
) {
  return await jsonRequest<{
    user: AdminUserSummary;
    entry: BillingEntry;
    billingSummary: BillingSummary;
    billingEntries: BillingEntry[];
    auditLogs: AdminAuditLogEntry[];
  }>(`/api/admin/users/${encodeURIComponent(userId)}/billing-adjustments`, {
    method: 'POST',
    body: JSON.stringify({ ...input, confirm: true, confirmUserId: userId })
  });
}

export async function logoutAdminUserSessions(userId: string) {
  return await jsonRequest<{ ok: true; removedSessions: number; user: AdminUserSummary; auditLogs: AdminAuditLogEntry[] }>(
    `/api/admin/users/${encodeURIComponent(userId)}/logout`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    }
  );
}

export async function deleteAdminUser(userId: string, confirmation: { email: string }) {
  return await jsonRequest<{
    ok: true;
    deletedUserId: string;
    deletedUserEmail: string;
    removed: {
      projects: number;
      sessions: number;
      passwordResetTokens: number;
      emailVerificationTokens: number;
      billingEntries: number;
      paymentOrders: number;
      auditLogs: number;
    };
    archiveErrors: Array<{ projectId: string; error: string }>;
  }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      confirm: true,
      confirmUserId: userId,
      confirmEmail: confirmation.email
    })
  });
}

export async function fetchAdminAuditLogs() {
  return await jsonRequest<{ items: AdminAuditLogEntry[] }>('/api/admin/audit-logs');
}

export async function fetchAdminSettings() {
  return await jsonRequest<{ settings: AdminSystemSettings }>('/api/admin/settings');
}

export async function fetchAdminWorkflows() {
  return await jsonRequest<{ workflows: AdminWorkflowSummary; settings: AdminSystemSettings }>('/api/admin/workflows');
}

export async function fetchStudioFeatures() {
  return await jsonRequest<{ features: StudioFeatureConfig[] }>('/api/studio/features');
}

export async function updateAdminSettings(input: AdminSystemSettings) {
  return await jsonRequest<{ settings: AdminSystemSettings }>('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ ...input, confirm: true })
  });
}

export async function uploadAdminStudioFeatureImage(file: File) {
  const formData = new FormData();
  formData.set('file', file);
  return await jsonRequest<{ url: string; fileName: string }>('/api/admin/studio-feature-image', {
    method: 'POST',
    body: formData
  });
}

export async function fetchAdminActivationCodes() {
  return await jsonRequest<AdminActivationCodesPayload>('/api/admin/activation-codes');
}

export async function createAdminActivationCode(input: AdminActivationCodeInput) {
  return await jsonRequest<{ item: AdminActivationCode }>('/api/admin/activation-codes', {
    method: 'POST',
    body: JSON.stringify({ ...input, confirm: true })
  });
}

export async function updateAdminActivationCode(id: string, input: Partial<AdminActivationCodeInput>) {
  return await jsonRequest<{ item: AdminActivationCode }>(`/api/admin/activation-codes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...input, confirm: true })
  });
}

export async function deleteAdminActivationCode(id: string) {
  return await jsonRequest<{ ok: boolean }>(`/api/admin/activation-codes/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export async function fetchProjects() {
  return await jsonRequest<{ items: ProjectRecord[] }>('/api/projects');
}

export async function fetchProject(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}`);
}

export async function createProject(input: {
  name: string;
  address?: string;
  studioFeatureId?: string;
}) {
  return await jsonRequest<{ project: ProjectRecord }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function patchProject(
  id: string,
  input: Partial<Pick<ProjectRecord, 'name' | 'address' | 'currentStep' | 'status'>>
) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function deleteProject(id: string) {
  return await jsonRequest<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function createGroup(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/groups`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function updateGroup(
  projectId: string,
  groupId: string,
  input: { sceneType?: 'interior' | 'exterior' | 'pending'; colorMode?: 'default' | 'replace'; replacementColor?: string | null }
) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function selectExposure(projectId: string, hdrItemId: string, exposureId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/hdr-items/${hdrItemId}/select`, {
    method: 'PATCH',
    body: JSON.stringify({ exposureId })
  });
}

export async function moveHdrItem(projectId: string, hdrItemId: string, targetGroupId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/hdr-items/${hdrItemId}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetGroupId })
  });
}

export interface HdrLayoutItemPayload {
  exposureOriginalNames: string[];
  selectedOriginalName?: string | null;
  exposures?: Array<{
    originalName: string;
    fileName?: string;
    extension?: string;
    mimeType?: string;
    size?: number;
    isRaw?: boolean;
    storageKey?: string | null;
    captureTime?: string | null;
    sequenceNumber?: number | null;
    exposureCompensation?: number | null;
    exposureSeconds?: number | null;
    iso?: number | null;
    fNumber?: number | null;
    focalLength?: number | null;
  }>;
}

export interface HdrLayoutOptions {
  mode?: 'replace' | 'merge';
  inputComplete?: boolean;
}

export async function applyHdrLayout(projectId: string, hdrItems: HdrLayoutItemPayload[], options: HdrLayoutOptions = {}) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/hdr-layout`, {
    method: 'POST',
    body: JSON.stringify({ hdrItems, ...options })
  });
}

export async function deleteHdrItem(projectId: string, hdrItemId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/hdr-items/${hdrItemId}`, {
    method: 'DELETE'
  });
}

export async function reorderResults(projectId: string, orderedHdrItemIds: string[]) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/results/reorder`, {
    method: 'POST',
    body: JSON.stringify({ orderedHdrItemIds })
  });
}

export async function regenerateResult(projectId: string, hdrItemId: string, input: { colorCardNo: string }) {
  return await jsonRequest<{ project: ProjectRecord }>(
    `/api/projects/${projectId}/hdr-items/${encodeURIComponent(hdrItemId)}/regenerate`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
}

export async function startProcessing(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/start`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function retryFailedProcessing(projectId: string) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/retry-failed`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function fetchResultThumbnails(projectId: string) {
  const payload = await jsonRequest<{
    items?: ResultThumbnailManifestItem[];
    thumbnails?: ResultThumbnailManifestItem[];
  }>(`/api/projects/${encodeURIComponent(projectId)}/results/thumbnails`);
  return {
    thumbnails: payload.thumbnails ?? payload.items ?? []
  };
}

function encodeDownloadOptions(input: DownloadRequestPayload) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildProjectDownloadUrl(projectId: string, input: DownloadRequestPayload) {
  return `${API_ROOT}/api/projects/${encodeURIComponent(projectId)}/download?options=${encodeURIComponent(
    encodeDownloadOptions(input)
  )}`;
}

async function throwDownloadResponseError(response: Response): Promise<never> {
  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as { missingFiles?: unknown } | null;
    const missingFiles = Array.isArray(payload?.missingFiles) ? payload.missingFiles.filter((item) => typeof item === 'string') : [];
    const suffix = missingFiles.length ? ` Missing: ${missingFiles.slice(0, 5).join(', ')}` : '';
    throw new ApiRequestError(`Project results are incomplete.${suffix}`, response.status);
  }
  throw new ApiRequestError(await readErrorMessage(response), response.status);
}

async function startDownloadJob(projectId: string, input: DownloadRequestPayload) {
  const response = await fetch(`${API_ROOT}/api/projects/${encodeURIComponent(projectId)}/download/jobs`, {
    method: 'POST',
    credentials: 'include',
    headers: buildRequestHeaders({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    await throwDownloadResponseError(response);
  }

  const payload = (await response.json()) as { job: DownloadJobPayload };
  captureCsrfToken(payload);
  return payload.job;
}

async function fetchDownloadJob(projectId: string, jobId: string) {
  return await jsonRequest<{ job: DownloadJobPayload }>(
    `/api/projects/${encodeURIComponent(projectId)}/download/jobs/${encodeURIComponent(jobId)}`
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForDownloadJob(
  projectId: string,
  initialJob: DownloadJobPayload,
  onProgress?: (job: DownloadJobPayload) => void
) {
  let job = initialJob;
  onProgress?.(job);
  let delayMs = 1000;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    if (job.status === 'ready') {
      return job;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new ApiRequestError(job.error ?? 'Download job failed.', 400);
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs + 500, 5000);
    job = (await fetchDownloadJob(projectId, job.jobId)).job;
    onProgress?.(job);
  }
  throw new ApiRequestError('Download job timed out.', 408);
}

export async function downloadProjectArchive(
  projectId: string,
  input: DownloadRequestPayload,
  onProgress?: (job: DownloadJobPayload) => void
) {
  const job = await waitForDownloadJob(projectId, await startDownloadJob(projectId, input), onProgress);
  if (!job.downloadUrl) {
    throw new ApiRequestError('Download job finished without a download URL.', 400);
  }

  return {
    downloadUrl: job.downloadUrl,
    fileName: `${projectId}.zip`,
    revoke: () => undefined
  };
}

function uploadFileBatch(projectId: string, files: File[], onProgress: (loadedBytes: number) => void) {
  if (!deprecatedUploadFileBatchWarningShown) {
    deprecatedUploadFileBatchWarningShown = true;
    console.warn('[deprecated] uploadFileBatch called, expected to be unreachable outside local development');
  }

  return new Promise<{ project: ProjectRecord }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_ROOT}/api/projects/${projectId}/files`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    if (csrfToken) {
      xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(event.loaded);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as { project: ProjectRecord });
      } else {
        reject(new Error((xhr.response as { error?: string })?.error ?? `Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed.')));

    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    xhr.send(formData);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getUploadApiRetryDelay(error: unknown, attempt: number) {
  if (attempt >= UPLOAD_API_RETRY_MAX_ATTEMPTS) {
    return null;
  }

  if (error instanceof ApiRequestError) {
    const isRetryableStatus = error.status === 408 || error.status === 429 || error.status >= 500;
    if (!isRetryableStatus) {
      return null;
    }
    return error.retryAfterMs ?? Math.min(UPLOAD_API_RETRY_MAX_DELAY_MS, uploadRetryDelay(attempt) * 2);
  }

  if (error instanceof TypeError) {
    return Math.min(UPLOAD_API_RETRY_MAX_DELAY_MS, uploadRetryDelay(attempt) * 2);
  }

  return null;
}

function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function waitForOnline(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (!isBrowserOffline()) {
      resolve();
      return;
    }

    const cleanup = () => {
      window.removeEventListener('online', handleOnline);
      signal?.removeEventListener('abort', handleAbort);
    };
    const handleOnline = () => {
      cleanup();
      resolve();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    window.addEventListener('online', handleOnline, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function waitIfOffline(signal: AbortSignal | undefined, onPause?: () => void) {
  if (!isBrowserOffline()) {
    return false;
  }
  onPause?.();
  await waitForOnline(signal);
  return true;
}

async function runWithOfflineRetry<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; onPause?: () => void } = {}
) {
  let apiAttempt = 1;
  while (true) {
    throwIfUploadAborted(options.signal);
    await waitIfOffline(options.signal, options.onPause);
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      if (!isBrowserOffline()) {
        const retryDelayMs = getUploadApiRetryDelay(error, apiAttempt);
        if (retryDelayMs == null) {
          throw error;
        }
        apiAttempt += 1;
        await delay(retryDelayMs);
        continue;
      }
      await waitIfOffline(options.signal, options.onPause);
    }
  }
}

export function isDirectUploadIntegrityError(error: unknown) {
  if (!(error instanceof ApiRequestError) || error.status !== 400) {
    return false;
  }
  return /Uploaded object (was not found|size does not match)/i.test(error.message);
}

async function completeDirectObjectUploadReferencesReliably(
  projectId: string,
  files: UploadedObjectReference[],
  options: { signal?: AbortSignal; onOfflinePause?: () => void } = {}
) {
  try {
    return await runWithOfflineRetry(() => completeDirectObjectUploadReferencesInBatches(projectId, files), {
      signal: options.signal,
      onPause: options.onOfflinePause
    });
  } catch (error) {
    if (isDirectUploadIntegrityError(error)) {
      await clearPersistedProject(projectId);
    }
    throw error;
  }
}

function uploadRetryDelay(attempt: number) {
  return UPLOAD_RETRY_BASE_DELAY_MS * attempt + Math.round(Math.random() * UPLOAD_RETRY_JITTER_MS);
}

class DirectUploadError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'DirectUploadError';
    this.status = status;
  }
}

function getUploadFailureReason(error: unknown): UploadFailureReason {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'cancelled';
  }
  if (error instanceof ApiRequestError && error.status === 413) {
    return 'too-large';
  }
  if (error instanceof DirectUploadError) {
    if (error.status === 413) {
      return 'too-large';
    }
    if (error.status >= 500) {
      return 'r2-5xx';
    }
    return error.status === 0 ? 'network' : 'unknown';
  }
  return isBrowserOffline() ? 'network' : 'unknown';
}

function getUploadFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getUploadErrorClass(error: unknown) {
  if (error instanceof DirectUploadError) {
    return `${error.name}:${error.status}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

function getFileExt(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function getNetworkContext() {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  return {
    navigatorOnline: navigator.onLine,
    effectiveType: connection?.effectiveType ?? null,
    downlinkMbps: connection?.downlink ?? null
  };
}

function emitUploadAttemptFailed(input: {
  projectId?: string;
  file: File;
  partNumber?: number;
  attempt: number;
  maxAttempts: number;
  error: unknown;
}) {
  sendClientEvent({
    type: 'upload.attempt-failed',
    level: 'warning',
    message: `Upload attempt failed: ${input.file.name}`,
    projectId: input.projectId ?? null,
    context: {
      fileName: input.file.name,
      fileSize: input.file.size,
      fileExt: getFileExt(input.file.name),
      partNumber: input.partNumber ?? null,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      errorMessage: getUploadFailureMessage(input.error),
      errorClass: getUploadErrorClass(input.error),
      ...getNetworkContext()
    }
  });
}

function emitUploadBatchEvent(
  type: 'upload.batch-completed' | 'upload.batch-failed-files',
  input: { projectId: string; files: File[]; uploadedFiles: number; failedFiles: FailedUploadFile[] }
) {
  sendClientEvent({
    type,
    level: input.failedFiles.length ? 'warning' : 'info',
    message: type === 'upload.batch-completed' ? 'Upload batch completed' : 'Upload batch has failed files',
    projectId: input.projectId,
    context: {
      totalFiles: input.files.length,
      uploadedFiles: input.uploadedFiles,
      failedFiles: input.failedFiles.map((file) => ({
        fileName: file.fileName,
        reason: file.reason,
        lastError: file.lastError
      }))
    }
  });
}

interface UploadPerformanceDiagnostics {
  startedAt: number;
  preparingMs: number;
  targetRequestMs: number;
  uploadMs: number;
  finalizingMs: number;
  directFiles: number;
  multipartFiles: number;
  targetBatches: number;
  maxWorkerCount: number;
  maxAdaptiveConcurrency: number;
}

function createUploadPerformanceDiagnostics(): UploadPerformanceDiagnostics {
  return {
    startedAt: Date.now(),
    preparingMs: 0,
    targetRequestMs: 0,
    uploadMs: 0,
    finalizingMs: 0,
    directFiles: 0,
    multipartFiles: 0,
    targetBatches: 0,
    maxWorkerCount: 0,
    maxAdaptiveConcurrency: 0
  };
}

function emitUploadPerformanceEvent(input: {
  projectId: string;
  status: 'completed' | 'failed';
  files: File[];
  uploadedFiles: number;
  failedFiles: FailedUploadFile[];
  diagnostics: UploadPerformanceDiagnostics;
  error?: unknown;
}) {
  const totalBytes = input.files.reduce((sum, file) => sum + Math.max(1, file.size), 0);
  const elapsedMs = Math.max(1, Date.now() - input.diagnostics.startedAt);
  const uploadedBytes = input.status === 'completed'
    ? totalBytes
    : input.files.slice(0, Math.max(0, input.uploadedFiles)).reduce((sum, file) => sum + Math.max(1, file.size), 0);
  sendClientEvent({
    type: 'upload.performance',
    level: input.status === 'completed' ? 'info' : 'warning',
    message: `Upload ${input.status}`,
    projectId: input.projectId,
    context: {
      status: input.status,
      totalFiles: input.files.length,
      uploadedFiles: input.uploadedFiles,
      failedFiles: input.failedFiles.length,
      totalBytes,
      uploadedBytes,
      totalMs: elapsedMs,
      preparingMs: Math.round(input.diagnostics.preparingMs),
      targetRequestMs: Math.round(input.diagnostics.targetRequestMs),
      uploadMs: Math.round(input.diagnostics.uploadMs),
      finalizingMs: Math.round(input.diagnostics.finalizingMs),
      averageBytesPerSecond: Math.round((uploadedBytes / elapsedMs) * 1000),
      directFiles: input.diagnostics.directFiles,
      multipartFiles: input.diagnostics.multipartFiles,
      targetBatches: input.diagnostics.targetBatches,
      maxWorkerCount: input.diagnostics.maxWorkerCount,
      maxAdaptiveConcurrency: input.diagnostics.maxAdaptiveConcurrency,
      errorMessage: input.error ? getUploadFailureMessage(input.error) : null,
      ...getNetworkContext()
    }
  });
}

function shouldRefreshDirectUploadTarget(error: unknown) {
  if (!(error instanceof DirectUploadError)) {
    return true;
  }

  return error.status === 0 || error.status === 400 || error.status === 401 || error.status === 403 || error.status === 408 || error.status === 429 || error.status >= 500;
}

async function uploadFileBatchWithRetry(
  projectId: string,
  batch: File[],
  onProgress: (loadedBytes: number) => void
) {
  let lastError: unknown = null;

  let attempt = 1;
  while (attempt <= MAX_UPLOAD_BATCH_RETRIES) {
    try {
      await waitIfOffline(undefined);
      onProgress(0);
      return await uploadFileBatch(projectId, batch, onProgress);
    } catch (error) {
      lastError = error;
      onProgress(0);
      if (isBrowserOffline()) {
        await waitForOnline();
        continue;
      }
      if (attempt >= MAX_UPLOAD_BATCH_RETRIES) {
        break;
      }
      await delay(uploadRetryDelay(attempt));
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Upload failed.');
}

async function createDirectUploadTargets(projectId: string, files: File[]) {
  return await jsonRequest<{ targets: DirectUploadTarget[] }>(`/api/projects/${projectId}/direct-upload/targets`, {
    method: 'POST',
    body: JSON.stringify({
      files: files.map((file) => ({
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size
      }))
    })
  });
}

async function completeDirectObjectUploadReferences(projectId: string, files: UploadedObjectReference[]) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/direct-upload/complete`, {
    method: 'POST',
    body: JSON.stringify({
      files
    })
  });
}

async function completeDirectObjectUploadReferencesInBatches(projectId: string, files: UploadedObjectReference[]) {
  let response: { project: ProjectRecord } | null = null;
  for (let index = 0; index < files.length; index += CLIENT_DIRECT_UPLOAD_TARGET_MAX_FILES) {
    const batch = files.slice(index, index + CLIENT_DIRECT_UPLOAD_TARGET_MAX_FILES);
    if (!batch.length) {
      continue;
    }
    response = await completeDirectObjectUploadReferences(projectId, batch);
  }
  if (!response) {
    throw new Error('No uploaded files to complete.');
  }
  return response;
}

async function initMultipartUpload(projectId: string, file: File, fileIdentity: string) {
  return await jsonRequest<MultipartUploadInitPayload>(`/api/projects/${projectId}/uploads/multipart/init`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      fileIdentity
    })
  });
}

async function refreshMultipartPartUrls(
  projectId: string,
  storageKey: string,
  uploadId: string,
  partNumbers: number[]
) {
  return await jsonRequest<{ partUrls: MultipartUploadPartUrl[] }>(`/api/projects/${projectId}/uploads/multipart/parts/refresh`, {
    method: 'POST',
    body: JSON.stringify({
      storageKey,
      uploadId,
      partNumbers
    })
  });
}

async function completeMultipartUpload(
  projectId: string,
  input: {
    storageKey: string;
    uploadId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    parts: Array<{ partNumber: number; etag: string }>;
  }
) {
  return await jsonRequest<UploadedObjectReference & { etag?: string | null }>(
    `/api/projects/${projectId}/uploads/multipart/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
}

async function abortMultipartUpload(projectId: string, storageKey: string, uploadId: string) {
  return await jsonRequest<{ aborted: boolean }>(`/api/projects/${projectId}/uploads/multipart/abort`, {
    method: 'POST',
    body: JSON.stringify({
      storageKey,
      uploadId
    })
  });
}

function throwIfUploadAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Upload cancelled.', 'AbortError');
  }
}

async function waitIfUploadPaused(options: Pick<UploadFilesOptions, 'pauseController' | 'signal'>, onPause?: () => void) {
  if (!options.pauseController?.isPaused()) {
    return false;
  }
  onPause?.();
  await options.pauseController.waitUntilResumed(options.signal);
  return true;
}

function uploadDirectObjectFile(target: DirectUploadTarget, file: File, onProgress: (loadedBytes: number) => void, signal?: AbortSignal) {
  return directUploadConnectionLimiter.run(() => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abortUpload = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abortUpload, { once: true });
    xhr.open(target.method, target.uploadUrl);
    xhr.timeout = DIRECT_OBJECT_UPLOAD_TIMEOUT_MS;
    for (const [header, value] of Object.entries(target.headers ?? {})) {
      xhr.setRequestHeader(header, value);
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(event.loaded);
    });
    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', abortUpload);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new DirectUploadError(`Direct upload failed: ${xhr.status}`, xhr.status));
      }
    });
    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(new DirectUploadError('Direct upload failed.'));
    });
    xhr.addEventListener('timeout', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(new DirectUploadError('Direct upload timed out.'));
    });
    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(signal?.aborted ? new DOMException('Upload cancelled.', 'AbortError') : new DirectUploadError('Direct upload was interrupted.'));
    });
    xhr.send(file);
  }), signal);
}

async function uploadDirectObjectFileWithRetry(
  target: DirectUploadTarget,
  file: File,
  onProgress: (loadedBytes: number) => void,
  options: {
    onRetry?: (retry: { attempt: number; maxAttempts: number; error: unknown }) => void;
    onOfflinePause?: () => void;
    refreshTarget?: () => Promise<DirectUploadTarget>;
    projectId?: string;
    signal?: AbortSignal;
  } = {}
) {
  let lastError: unknown = null;
  let activeTarget = target;

  let attempt = 1;
  while (attempt <= MAX_UPLOAD_BATCH_RETRIES) {
    try {
      throwIfUploadAborted(options.signal);
      await waitIfOffline(options.signal, options.onOfflinePause);
      onProgress(0);
      await uploadDirectObjectFile(activeTarget, file, onProgress, options.signal);
      return activeTarget;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      lastError = error;
      emitUploadAttemptFailed({
        projectId: options.projectId,
        file,
        attempt,
        maxAttempts: MAX_UPLOAD_BATCH_RETRIES,
        error
      });
      onProgress(0);
      if (isBrowserOffline()) {
        await waitIfOffline(options.signal, options.onOfflinePause);
        continue;
      }
      if (attempt >= MAX_UPLOAD_BATCH_RETRIES) {
        break;
      }
      options.onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_UPLOAD_BATCH_RETRIES, error });

      if (options.refreshTarget && shouldRefreshDirectUploadTarget(error)) {
        try {
          activeTarget = await options.refreshTarget();
        } catch {
          // If refreshing the signed URL fails briefly, retry the current URL once more.
        }
      }

      await delay(uploadRetryDelay(attempt));
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Direct upload failed.');
}

function uploadMultipartPart(
  url: string,
  blob: Blob,
  onProgress: (loadedBytes: number) => void,
  signal?: AbortSignal
) {
  return directUploadConnectionLimiter.run(() => new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const abortUpload = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abortUpload, { once: true });
    xhr.open('PUT', url);
    xhr.timeout = DIRECT_OBJECT_UPLOAD_TIMEOUT_MS;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    });
    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', abortUpload);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = (xhr.getResponseHeader('etag') ?? '').replace(/"/g, '');
        if (!etag) {
          reject(new DirectUploadError('Multipart part upload did not return an ETag.', xhr.status));
          return;
        }
        resolve(etag);
      } else {
        reject(new DirectUploadError(`Multipart part upload failed: ${xhr.status}`, xhr.status));
      }
    });
    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(new DirectUploadError('Multipart part upload failed.'));
    });
    xhr.addEventListener('timeout', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(new DirectUploadError('Multipart part upload timed out.'));
    });
    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', abortUpload);
      reject(signal?.aborted ? new DOMException('Upload cancelled.', 'AbortError') : new DirectUploadError('Multipart part upload was interrupted.'));
    });
    xhr.send(blob);
  }), signal);
}

function mergeMultipartPartUrls(current: MultipartUploadPartUrl[], additions: MultipartUploadPartUrl[]) {
  const byPart = new Map(current.map((part) => [part.partNumber, part]));
  for (const part of additions) {
    byPart.set(part.partNumber, part);
  }
  return Array.from(byPart.values());
}

async function uploadDirectObjectFileMultipart(
  projectId: string,
  file: File,
  onProgress: (loadedBytes: number) => void,
  options: { fileIdentity: string; onOfflinePause?: () => void; onUserPause?: () => void; pauseController?: UploadPauseController; signal?: AbortSignal }
): Promise<UploadedObjectReference> {
  throwIfUploadAborted(options.signal);
  await waitIfOffline(options.signal, options.onOfflinePause);
  const persisted = await readPersistedMultipart(projectId, options.fileIdentity);
  let storageKey = persisted?.storageKey ?? '';
  let uploadId = persisted?.uploadId ?? '';
  let partSize = persisted?.partSize ?? 0;
  let partUrls: MultipartUploadPartUrl[] = [];
  let completedParts = persisted?.partETags ? [...persisted.partETags] : [];
  let totalParts = persisted?.totalParts ?? 0;

  if (!storageKey || !uploadId || !partSize || !totalParts) {
    const init = await runWithOfflineRetry(() => initMultipartUpload(projectId, file, options.fileIdentity), {
      signal: options.signal,
      onPause: options.onOfflinePause
    });
    storageKey = init.storageKey;
    uploadId = init.uploadId;
    partSize = init.partSize;
    partUrls = init.partUrls;
    totalParts = Math.ceil(file.size / partSize);
    completedParts = [];
  } else {
    totalParts = Math.ceil(file.size / partSize);
  }

  const completedByPart = new Map(completedParts.map((part) => [part.partNumber, part]));
  const pendingPartNumbers: number[] = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (!completedByPart.has(partNumber)) {
      pendingPartNumbers.push(partNumber);
    }
  }

  const partUrlsByNumber = new Set(partUrls.map((part) => part.partNumber));
  const missingPartUrlNumbers = pendingPartNumbers.filter((partNumber) => !partUrlsByNumber.has(partNumber));
  if (missingPartUrlNumbers.length) {
    const refreshed = await runWithOfflineRetry(() => refreshMultipartPartUrls(projectId, storageKey, uploadId, missingPartUrlNumbers), {
      signal: options.signal,
      onPause: options.onOfflinePause
    });
    partUrls = mergeMultipartPartUrls(partUrls, refreshed.partUrls);
  }

  let loadedTotal = completedParts.reduce((sum, part) => sum + part.size, 0);
  const partProgress = new Map<number, number>();
  const reportProgress = () => {
    const inFlightBytes = Array.from(partProgress.values()).reduce((sum, value) => sum + value, 0);
    onProgress(Math.min(file.size, loadedTotal + inFlightBytes));
  };
  reportProgress();

  let nextPartIndex = 0;
  const worker = async () => {
    while (nextPartIndex < pendingPartNumbers.length) {
      throwIfUploadAborted(options.signal);
      const wasUserPaused = await waitIfUploadPaused(options, options.onUserPause);
      if (wasUserPaused) {
        reportProgress();
      }
      await waitIfOffline(options.signal, options.onOfflinePause);
      const partNumber = pendingPartNumbers[nextPartIndex];
      nextPartIndex += 1;
      if (!partNumber) {
        continue;
      }

      const offset = (partNumber - 1) * partSize;
      const end = partNumber === totalParts ? file.size : Math.min(file.size, offset + partSize);
      const blob = file.slice(offset, end);
      let lastError: unknown = null;

      let attempt = 1;
      while (attempt <= MULTIPART_PART_RETRIES) {
        try {
          const partUrl = partUrls.find((part) => part.partNumber === partNumber)?.url;
          if (!partUrl) {
            throw new Error(`Missing multipart URL for part ${partNumber}.`);
          }
          const etag = await uploadMultipartPart(
            partUrl,
            blob,
            (loadedBytes) => {
              partProgress.set(partNumber, Math.min(blob.size, Math.max(0, loadedBytes)));
              reportProgress();
            },
            options.signal
          );
          completedByPart.set(partNumber, { partNumber, etag, size: blob.size });
          completedParts = Array.from(completedByPart.values()).sort((left, right) => left.partNumber - right.partNumber);
          loadedTotal += blob.size;
          partProgress.delete(partNumber);
          reportProgress();
          await upsertPersistedMultipart(projectId, {
            fileIdentity: options.fileIdentity,
            storageKey,
            uploadId,
            partSize,
            partETags: completedParts,
            totalParts
          });
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            await abortMultipartUpload(projectId, storageKey, uploadId).catch(() => null);
            await dropPersistedMultipart(projectId, options.fileIdentity);
            throw error;
          }
          lastError = error;
          emitUploadAttemptFailed({
            projectId,
            file,
            partNumber,
            attempt,
            maxAttempts: MULTIPART_PART_RETRIES,
            error
          });
          partProgress.delete(partNumber);
          reportProgress();
          if (isBrowserOffline()) {
            await waitIfOffline(options.signal, options.onOfflinePause);
            continue;
          }
          if (attempt >= MULTIPART_PART_RETRIES) {
            throw lastError instanceof Error ? lastError : new Error('Multipart part upload failed.');
          }
          if (shouldRefreshDirectUploadTarget(error)) {
            const refreshed = await runWithOfflineRetry(() => refreshMultipartPartUrls(projectId, storageKey, uploadId, [partNumber]), {
              signal: options.signal,
              onPause: options.onOfflinePause
            });
            partUrls = mergeMultipartPartUrls(partUrls, refreshed.partUrls);
          }
          await delay(uploadRetryDelay(attempt));
          attempt += 1;
        }
      }
    }
  };

  const workerCount = Math.min(MULTIPART_PART_CONCURRENCY, pendingPartNumbers.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const final = await runWithOfflineRetry(
    () =>
      completeMultipartUpload(projectId, {
        storageKey,
        uploadId,
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        parts: completedParts.map((part) => ({ partNumber: part.partNumber, etag: part.etag }))
      }),
    {
      signal: options.signal,
      onPause: options.onOfflinePause
    }
  );
  await dropPersistedMultipart(projectId, options.fileIdentity);
  return {
    originalName: final.originalName || file.name,
    mimeType: final.mimeType || file.type || 'application/octet-stream',
    size: final.size || file.size,
    storageKey: final.storageKey
  };
}

function splitUploadBatches(files: File[]) {
  const batches: File[][] = [];
  let currentBatch: File[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const nextBytes = currentBytes + file.size;
    const shouldFlush =
      currentBatch.length > 0 &&
      (currentBatch.length >= MAX_UPLOAD_BATCH_FILES || nextBytes > MAX_UPLOAD_BATCH_BYTES);

    if (shouldFlush) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(file);
    currentBytes += file.size;
  }

  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  return batches;
}

async function uploadFilesViaLocalProxy(projectId: string, files: File[], onProgress: UploadProgressHandler) {
  const batches = splitUploadBatches(files);
  const totalBytes = Math.max(
    1,
    files.reduce((sum, file) => sum + Math.max(1, file.size), 0)
  );
  let uploadedBytes = 0;
  let uploadedFiles = 0;
  let latestProject: ProjectRecord | null = null;
  const batchLoadedBytes = new Array<number>(batches.length).fill(0);
  let nextBatchIndex = 0;
  const sampler = new ThroughputSampler(UPLOAD_TELEMETRY_SAMPLE_MS, UPLOAD_TELEMETRY_MIN_SPAN_MS);

  const reportProgress = () => {
    const activeLoadedBytes = batchLoadedBytes.reduce((sum, value) => sum + Math.max(0, value), 0);
    const overallBytes = Math.min(totalBytes, uploadedBytes + activeLoadedBytes);
    const percent = Math.round((overallBytes / totalBytes) * 100);
    onProgress(percent, {
      stage: percent >= 100 ? 'completed' : 'uploading',
      percent,
      uploadedFiles,
      totalFiles: files.length,
      ...buildUploadTelemetry(overallBytes, totalBytes, sampler.bytesPerSecond())
    });
  };

  async function worker() {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex] ?? [];
      const batchBytes = batch.reduce((sum, file) => sum + Math.max(1, file.size), 0);
      const response = await uploadFileBatchWithRetry(projectId, batch, (loadedBytes) => {
        const previousLoaded = Math.max(0, batchLoadedBytes[batchIndex] ?? 0);
        const nextLoaded = Math.min(batchBytes, Math.max(0, loadedBytes));
        const deltaBytes = nextLoaded - previousLoaded;
        batchLoadedBytes[batchIndex] = nextLoaded;
        if (deltaBytes > 0) {
          sampler.recordBytes(deltaBytes);
        }
        reportProgress();
      });
      latestProject = response.project;
      uploadedBytes += batchBytes;
      uploadedFiles += batch.length;
      batchLoadedBytes[batchIndex] = 0;
      reportProgress();
    }
  }

  const workerCount = Math.min(MAX_UPLOAD_CONCURRENT_BATCHES, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (!latestProject) {
    throw new Error('No files uploaded.');
  }

  return { project: latestProject };
}

function getDirectObjectUploadConcurrency(files: File[]) {
  const maxFileBytes = files.reduce((max, file) => Math.max(max, file.size), 0);
  if (maxFileBytes >= HUGE_DIRECT_OBJECT_FILE_BYTES) {
    return DIRECT_OBJECT_UPLOAD_HUGE_FILE_CONCURRENCY;
  }
  if (maxFileBytes >= LARGE_DIRECT_OBJECT_FILE_BYTES) {
    return DIRECT_OBJECT_UPLOAD_LARGE_FILE_CONCURRENCY;
  }
  return DIRECT_OBJECT_UPLOAD_SMALL_FILE_CONCURRENCY;
}

function shouldUseMultipartUpload(file: File) {
  return file.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES;
}

function clampUploadConcurrency(value: number, maxWorkers: number) {
  return Math.max(1, Math.min(maxWorkers, Math.round(value)));
}

function getUploadedObjectIdentity(file: Pick<UploadedObjectReference, 'originalName' | 'size'>) {
  return `${file.originalName.trim().toLowerCase()}:${file.size}`;
}

function getFileRelativePath(file: File) {
  const maybePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return typeof maybePath === 'string' ? maybePath.trim().toLowerCase() : '';
}

function getFileUploadIdentity(file: File) {
  return `${file.name.trim().toLowerCase()}:${file.size}:${file.lastModified}:${getFileRelativePath(file)}`;
}

function getLegacyFileUploadIdentity(file: Pick<File, 'name' | 'size'>) {
  return `${file.name.trim().toLowerCase()}:${file.size}`;
}

function getFileUploadIdentityCandidates(file: File) {
  return [getFileUploadIdentity(file), getLegacyFileUploadIdentity(file)];
}

function findCompletedObjectForFile(completedByIdentity: Map<string, UploadedObjectReference>, file: File) {
  for (const identity of getFileUploadIdentityCandidates(file)) {
    const uploaded = completedByIdentity.get(identity);
    if (uploaded) {
      return uploaded;
    }
  }
  return null;
}

function collectCompletedObjects(files: File[], completedByIdentity: Map<string, UploadedObjectReference>) {
  return files
    .map((file) => findCompletedObjectForFile(completedByIdentity, file))
    .filter((uploaded): uploaded is UploadedObjectReference => Boolean(uploaded));
}

function normalizeDirectUploadTargetLimits(limits?: UploadCapabilitiesPayload['directUploadTargets']): DirectUploadTargetLimits {
  const maxFiles = Number(limits?.maxFiles ?? DEFAULT_DIRECT_UPLOAD_TARGET_MAX_FILES);
  const maxBatchBytes = Number(limits?.maxBatchBytes ?? DEFAULT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES);
  const serverMaxFiles = Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : DEFAULT_DIRECT_UPLOAD_TARGET_MAX_FILES;
  const serverMaxBatchBytes =
    Number.isFinite(maxBatchBytes) && maxBatchBytes > 0
      ? Math.floor(maxBatchBytes)
      : DEFAULT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES;
  return {
    maxFiles: Math.min(serverMaxFiles, CLIENT_DIRECT_UPLOAD_TARGET_MAX_FILES),
    maxBatchBytes: Math.min(serverMaxBatchBytes, CLIENT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES)
  };
}

function splitDirectUploadTargetBatches(files: PendingDirectUploadFile[], limits: DirectUploadTargetLimits) {
  const batches: PendingDirectUploadFile[][] = [];
  let currentBatch: PendingDirectUploadFile[] = [];
  let currentBytes = 0;

  for (const item of files) {
    const itemBytes = Math.max(1, item.file.size);
    const shouldFlush =
      currentBatch.length > 0 &&
      (currentBatch.length >= limits.maxFiles || currentBytes + itemBytes > limits.maxBatchBytes);

    if (shouldFlush) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(item);
    currentBytes += itemBytes;
  }

  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  return batches;
}

async function uploadFilesViaDirectObject(
  projectId: string,
  files: File[],
  onProgress: UploadProgressHandler,
  options: UploadFilesOptions = {},
  targetLimits?: UploadCapabilitiesPayload['directUploadTargets']
) {
  const diagnostics = createUploadPerformanceDiagnostics();
  throwIfUploadAborted(options.signal);
  const completedByIdentity = new Map<string, UploadedObjectReference>();
  for (const uploaded of options.completedObjects ?? []) {
    completedByIdentity.set(getUploadedObjectIdentity(uploaded), uploaded);
  }
  for (const persisted of await readPersistedCompleted(projectId)) {
    completedByIdentity.set(persisted.fileIdentity, persisted.object);
    completedByIdentity.set(getUploadedObjectIdentity(persisted.object), persisted.object);
  }

  const pendingFiles = files.filter((file) => !findCompletedObjectForFile(completedByIdentity, file));
  const resumedFiles = files.length - pendingFiles.length;
  onProgress(1, {
    stage: 'verifying',
    percent: 1,
    uploadedFiles: resumedFiles,
    totalFiles: files.length
  });
  if (!pendingFiles.length) {
    const completedObjects = collectCompletedObjects(files, completedByIdentity);
    onProgress(96, {
      stage: 'finalizing',
      percent: 96,
      uploadedFiles: files.length,
      totalFiles: files.length
    });
    const finalizingStartedAt = Date.now();
    const response = await completeDirectObjectUploadReferencesReliably(projectId, completedObjects, {
      signal: options.signal,
      onOfflinePause: () =>
        onProgress(96, {
          stage: 'paused',
          percent: 96,
          uploadedFiles: files.length,
          totalFiles: files.length,
          offline: true
        })
    });
    diagnostics.finalizingMs += Date.now() - finalizingStartedAt;
    await clearPersistedProject(projectId);
    emitUploadBatchEvent('upload.batch-completed', { projectId, files, uploadedFiles: files.length, failedFiles: [] });
    emitUploadPerformanceEvent({ projectId, status: 'completed', files, uploadedFiles: files.length, failedFiles: [], diagnostics });
    onProgress(100, {
      stage: 'completed',
      percent: 100,
      uploadedFiles: files.length,
      totalFiles: files.length
    });
    return { ...response, directUploadFiles: completedObjects };
  }

  onProgress(1, {
    stage: 'preparing',
    percent: 1,
    uploadedFiles: files.length - pendingFiles.length,
    totalFiles: files.length
  });

  const totalBytes = Math.max(
    1,
    files.reduce((sum, file) => sum + Math.max(1, file.size), 0)
  );
  const loadedByFile = new Array<number>(pendingFiles.length).fill(0);
  const alreadyCompletedFiles = files.filter((file) => findCompletedObjectForFile(completedByIdentity, file));
  let completedBytes = alreadyCompletedFiles.reduce((sum, file) => sum + Math.max(1, file.size), 0);
  let uploadedFiles = alreadyCompletedFiles.length;
  const failedFiles: FailedUploadFile[] = [];

  const reportProgress = (overrides: Partial<UploadProgressSnapshot> = {}) => {
    const activeBytes = loadedByFile.reduce((sum, value) => sum + Math.max(0, value), 0);
    const overallBytes = Math.min(totalBytes, completedBytes + activeBytes);
    const percent = Math.round((overallBytes / totalBytes) * 95);
    const safePercent = Math.max(1, Math.min(95, percent));
    onProgress(safePercent, {
      stage: 'uploading',
      percent: safePercent,
      uploadedFiles,
      totalFiles: files.length,
      ...buildUploadTelemetry(overallBytes, totalBytes),
      ...overrides
    });
  };

  const pendingEntries = pendingFiles.map((file, index) => ({ file, index }));
  const targetBatches = splitDirectUploadTargetBatches(pendingEntries, normalizeDirectUploadTargetLimits(targetLimits));
  diagnostics.targetBatches = targetBatches.length;
  const preparedDirectTargetPromises: Array<Promise<PreparedDirectUploadTargets> | null> = new Array(targetBatches.length).fill(null);

  function getDirectTargetEntries(batch: PendingDirectUploadFile[]) {
    return batch
      .map((entry, batchIndex) => ({ entry, batchIndex }))
      .filter(({ entry }) => !shouldUseMultipartUpload(entry.file));
  }

  async function prepareDirectUploadTargetsForBatch(batch: PendingDirectUploadFile[]) {
    throwIfUploadAborted(options.signal);
    const directTargetEntries = getDirectTargetEntries(batch);
    diagnostics.directFiles += directTargetEntries.length;
    diagnostics.multipartFiles += batch.length - directTargetEntries.length;
    const directTargetsByBatchIndex: PreparedDirectUploadTargets = new Map();
    if (!directTargetEntries.length) {
      return directTargetsByBatchIndex;
    }

    const targetRequestStartedAt = Date.now();
    const { targets } = await runWithOfflineRetry(
      () => createDirectUploadTargets(projectId, directTargetEntries.map(({ entry }) => entry.file)),
      {
        signal: options.signal,
        onPause: () => reportProgress({ stage: 'paused', offline: true })
      }
    );
    diagnostics.targetRequestMs += Date.now() - targetRequestStartedAt;
    if (targets.length !== directTargetEntries.length) {
      throw new Error('Direct upload target count mismatch.');
    }
    directTargetEntries.forEach(({ batchIndex }, targetIndex) => {
      const target = targets[targetIndex];
      if (target) {
        directTargetsByBatchIndex.set(batchIndex, target);
      }
    });
    return directTargetsByBatchIndex;
  }

  function ensurePreparedDirectTargets(batchIndex: number) {
    if (batchIndex < 0 || batchIndex >= targetBatches.length) {
      return null;
    }
    preparedDirectTargetPromises[batchIndex] ??= prepareDirectUploadTargetsForBatch(targetBatches[batchIndex] ?? []);
    return preparedDirectTargetPromises[batchIndex];
  }

  async function uploadTargetBatch(batch: PendingDirectUploadFile[], batchIndex: number) {
    throwIfUploadAborted(options.signal);
    const preparingStartedAt = Date.now();
    reportProgress({ stage: 'preparing' });
    const batchFiles = batch.map((item) => item.file);
    const adaptiveSampler = new ThroughputSampler(ADAPTIVE_UPLOAD_SAMPLE_MS, 1000);
    const telemetrySampler = new ThroughputSampler(UPLOAD_TELEMETRY_SAMPLE_MS, UPLOAD_TELEMETRY_MIN_SPAN_MS);
    const directTargetsByBatchIndex = await ensurePreparedDirectTargets(batchIndex) ?? new Map<number, DirectUploadTarget>();
    void ensurePreparedDirectTargets(batchIndex + 1);

    let nextBatchFileIndex = 0;
    const maxWorkerCount = Math.min(ADAPTIVE_UPLOAD_MAX_CONCURRENCY, batch.length);
    let targetWorkerCount = clampUploadConcurrency(getDirectObjectUploadConcurrency(batchFiles), maxWorkerCount);
    diagnostics.maxWorkerCount = Math.max(diagnostics.maxWorkerCount, maxWorkerCount);
    diagnostics.maxAdaptiveConcurrency = Math.max(diagnostics.maxAdaptiveConcurrency, targetWorkerCount);
    diagnostics.preparingMs += Date.now() - preparingStartedAt;
    let lastSampleAt = Date.now();
    const recordFileProgress = (fileIndex: number, fileSize: number, loadedBytes: number) => {
      const previousLoaded = Math.max(0, loadedByFile[fileIndex] ?? 0);
      const nextLoaded = Math.min(fileSize, Math.max(0, loadedBytes));
      const deltaBytes = nextLoaded - previousLoaded;
      loadedByFile[fileIndex] = nextLoaded;
      if (deltaBytes > 0) {
        adaptiveSampler.recordBytes(deltaBytes);
        telemetrySampler.recordBytes(deltaBytes);
      }
    };
    const reportUploadProgress = (overrides: Partial<UploadProgressSnapshot> = {}) =>
      reportProgress({
        ...buildUploadTelemetry(
          completedBytes + loadedByFile.reduce((sum, value) => sum + Math.max(0, value), 0),
          totalBytes,
          telemetrySampler.bytesPerSecond()
        ),
        ...overrides
      });
    const maybeAdjustConcurrency = () => {
      const now = Date.now();
      const elapsedMs = now - lastSampleAt;
      if (elapsedMs < ADAPTIVE_UPLOAD_SAMPLE_MS) {
        return;
      }

      lastSampleAt = now;
      const bps = adaptiveSampler.bytesPerSecond();
      if (!Number.isFinite(bps) || bps <= 0) {
        return;
      }

      if (bps < ADAPTIVE_UPLOAD_LOW_BPS) {
        targetWorkerCount = clampUploadConcurrency(
          Math.max(ADAPTIVE_UPLOAD_MIN_CONCURRENCY, targetWorkerCount - 2),
          maxWorkerCount
        );
      } else if (bps > ADAPTIVE_UPLOAD_HIGH_BPS) {
        targetWorkerCount = clampUploadConcurrency(Math.min(targetWorkerCount + 2, ADAPTIVE_UPLOAD_MAX_CONCURRENCY), maxWorkerCount);
      }
      diagnostics.maxAdaptiveConcurrency = Math.max(diagnostics.maxAdaptiveConcurrency, targetWorkerCount);
    };

    async function worker(workerIndex: number) {
      while (nextBatchFileIndex < batch.length) {
        throwIfUploadAborted(options.signal);
        if (workerIndex >= targetWorkerCount) {
          await delay(250);
          continue;
        }
        const wasUserPaused = await waitIfUploadPaused(options, () => reportProgress({ stage: 'paused', offline: false }));
        if (wasUserPaused) {
          reportProgress({ stage: 'uploading', offline: false });
        }
        const wasOffline = await waitIfOffline(options.signal, () => reportProgress({ stage: 'paused', offline: true }));
        if (wasOffline) {
          reportProgress({ stage: 'uploading' });
        }
        const batchFileIndex = nextBatchFileIndex;
        nextBatchFileIndex += 1;
        const entry = batch[batchFileIndex];
        if (!entry) {
          continue;
        }

        const file = entry.file;
        const fileIndex = entry.index;
        const fileIdentity = getFileUploadIdentity(file);
        let uploadedObject: UploadedObjectReference;
        try {
          if (shouldUseMultipartUpload(file)) {
            uploadedObject = await uploadDirectObjectFileMultipart(
              projectId,
              file,
              (loadedBytes) => {
                recordFileProgress(fileIndex, file.size, loadedBytes);
                maybeAdjustConcurrency();
                reportUploadProgress();
              },
              {
                fileIdentity,
                onOfflinePause: () => reportProgress({ stage: 'paused', offline: true }),
                onUserPause: () => reportProgress({ stage: 'paused', offline: false }),
                pauseController: options.pauseController,
                signal: options.signal
              }
            );
          } else {
            const target = directTargetsByBatchIndex.get(batchFileIndex);
            if (!target) {
              throw new Error('Direct upload target is missing.');
            }
            const latestTarget = await uploadDirectObjectFileWithRetry(target, file, (loadedBytes) => {
              recordFileProgress(fileIndex, file.size, loadedBytes);
              maybeAdjustConcurrency();
              reportUploadProgress();
            }, {
              onRetry: ({ attempt, maxAttempts }) => {
                loadedByFile[fileIndex] = 0;
                reportProgress({
                  stage: 'retrying',
                  currentFileName: file.name,
                  attempt,
                  maxAttempts
                });
              },
              refreshTarget: async () => {
                const refreshed = await runWithOfflineRetry(() => createDirectUploadTargets(projectId, [file]), {
                  signal: options.signal,
                  onPause: () => reportProgress({ stage: 'paused', offline: true })
                });
                const nextTarget = refreshed.targets[0];
                if (!nextTarget) {
                  throw new Error('Direct upload target refresh failed.');
                }
                directTargetsByBatchIndex.set(batchFileIndex, nextTarget);
                return nextTarget;
              },
              onOfflinePause: () => reportProgress({ stage: 'paused', offline: true }),
              projectId,
              signal: options.signal
            });
            directTargetsByBatchIndex.set(batchFileIndex, latestTarget);
            uploadedObject = {
              originalName: latestTarget.originalName || file.name,
              mimeType: file.type || latestTarget.mimeType || 'application/octet-stream',
              size: file.size || latestTarget.size,
              storageKey: latestTarget.storageKey
            };
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            const failedFile = {
              fileIdentity,
              fileName: file.name,
              reason: getUploadFailureReason(error),
              lastError: getUploadFailureMessage(error)
            };
            options.onFileFailed?.(failedFile);
            failedFiles.push(failedFile);
            if (options.continueOnFileError) {
              loadedByFile[fileIndex] = 0;
              reportProgress();
              continue;
            }
          }
          throw error;
        }
        completedByIdentity.set(fileIdentity, uploadedObject);
        completedByIdentity.set(getUploadedObjectIdentity(uploadedObject), uploadedObject);
        await appendPersistedCompleted(projectId, fileIdentity, uploadedObject);
        options.onFileUploaded?.(uploadedObject);
        completedBytes += Math.max(1, file.size);
        uploadedFiles += 1;
        loadedByFile[fileIndex] = 0;
        maybeAdjustConcurrency();
        reportUploadProgress();
      }
    }

    const uploadStartedAt = Date.now();
    await Promise.all(Array.from({ length: maxWorkerCount }, (_unused, workerIndex) => worker(workerIndex)));
    diagnostics.uploadMs += Date.now() - uploadStartedAt;
  }

  try {
    for (const [batchIndex, batch] of targetBatches.entries()) {
      await uploadTargetBatch(batch, batchIndex);
    }

    onProgress(96, {
      stage: 'finalizing',
      percent: 96,
      uploadedFiles: files.length,
      totalFiles: files.length
    });
    const completedObjects = files
      .map((file) => findCompletedObjectForFile(completedByIdentity, file))
      .filter((uploaded): uploaded is UploadedObjectReference => Boolean(uploaded));
    if (options.continueOnFileError && !completedObjects.length) {
      emitUploadBatchEvent('upload.batch-failed-files', { projectId, files, uploadedFiles, failedFiles });
      throw new Error('No files uploaded.');
    }
    if (failedFiles.length) {
      emitUploadBatchEvent('upload.batch-failed-files', { projectId, files, uploadedFiles, failedFiles });
      emitUploadPerformanceEvent({ projectId, status: 'failed', files, uploadedFiles, failedFiles, diagnostics });
      return {
        directUploadFiles: completedObjects
      };
    }
    const finalizingStartedAt = Date.now();
    const response = await completeDirectObjectUploadReferencesReliably(projectId, completedObjects, {
      signal: options.signal,
      onOfflinePause: () =>
        onProgress(96, {
          stage: 'paused',
          percent: 96,
          uploadedFiles: files.length,
          totalFiles: files.length,
          offline: true
        })
    });
    diagnostics.finalizingMs += Date.now() - finalizingStartedAt;
    await clearPersistedProject(projectId);
    emitUploadBatchEvent('upload.batch-completed', { projectId, files, uploadedFiles, failedFiles });
    emitUploadPerformanceEvent({ projectId, status: 'completed', files, uploadedFiles: files.length, failedFiles, diagnostics });
    onProgress(100, {
      stage: 'completed',
      percent: 100,
      uploadedFiles: files.length,
      totalFiles: files.length
    });
    return {
      ...response,
      directUploadFiles: completedObjects
    };
  } catch (error) {
    emitUploadPerformanceEvent({ projectId, status: 'failed', files, uploadedFiles, failedFiles, diagnostics, error });
    throw error;
  }
}

export async function uploadFiles(projectId: string, files: File[], onProgress: UploadProgressHandler, options: UploadFilesOptions = {}) {
  const capabilities = await fetchUploadCapabilities().catch(() => null);
  if (capabilities?.directObject.enabled) {
    return await uploadFilesViaDirectObject(projectId, files, onProgress, options, capabilities.directUploadTargets);
  }

  if ((capabilities?.localProxy.enabled || !capabilities) && isLocalDevelopmentOrigin()) {
    return await uploadFilesViaLocalProxy(projectId, files, onProgress);
  }

  throw new Error('Cloud upload is not available right now. Please try again later.');
}
