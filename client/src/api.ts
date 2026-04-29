import type { BillingEntry, BillingPackage, BillingSummary, PaymentOrderRecord, ProjectRecord } from './types';
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

export interface BillingPayload {
  summary: BillingSummary;
  entries: BillingEntry[];
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

export type UploadProgressStage = 'preparing' | 'uploading' | 'retrying' | 'paused' | 'finalizing' | 'completed';

export interface UploadProgressSnapshot {
  stage: UploadProgressStage;
  percent: number;
  uploadedFiles: number;
  totalFiles: number;
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
  items: ProjectRecord[];
}

export interface AdminOrdersPayload {
  total: number;
  items: PaymentOrderRecord[];
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
const DIRECT_OBJECT_UPLOAD_SMALL_FILE_CONCURRENCY = 8;
const DIRECT_OBJECT_UPLOAD_LARGE_FILE_CONCURRENCY = 6;
const DIRECT_OBJECT_UPLOAD_HUGE_FILE_CONCURRENCY = 4;
const MAX_UPLOAD_BATCH_RETRIES = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 850;
const UPLOAD_RETRY_JITTER_MS = 650;
const DIRECT_OBJECT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const LARGE_DIRECT_OBJECT_FILE_BYTES = 80 * 1024 * 1024;
const HUGE_DIRECT_OBJECT_FILE_BYTES = 200 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024;
const MULTIPART_PART_CONCURRENCY = 4;
const MULTIPART_PART_RETRIES = 5;
const ADAPTIVE_UPLOAD_MIN_CONCURRENCY = 2;
const ADAPTIVE_UPLOAD_MAX_CONCURRENCY = 12;
const ADAPTIVE_UPLOAD_LOW_BPS = 2 * 1024 * 1024;
const ADAPTIVE_UPLOAD_HIGH_BPS = 8 * 1024 * 1024;
const ADAPTIVE_UPLOAD_SAMPLE_MS = 4000;
const DEFAULT_DIRECT_UPLOAD_TARGET_MAX_FILES = 300;
const DEFAULT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES = 30 * 1024 * 1024 * 1024;

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

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function jsonRequest<T>(requestPath: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${requestPath}`, {
    credentials: 'include',
    ...init,
    headers: buildRequestHeaders(init)
  });

  if (!response.ok) {
    throw new ApiRequestError(await readErrorMessage(response), response.status);
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

export async function fetchUploadCapabilities() {
  return await jsonRequest<UploadCapabilitiesPayload>('/api/upload/capabilities');
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

export async function fetchAdminProjects(limit = 120) {
  const params = new URLSearchParams({ limit: String(limit) });
  return await jsonRequest<AdminProjectsPayload>(`/api/admin/projects?${params.toString()}`);
}

export async function fetchAdminOrders(limit = 120) {
  const params = new URLSearchParams({ limit: String(limit) });
  return await jsonRequest<AdminOrdersPayload>(`/api/admin/orders?${params.toString()}`);
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
    body: JSON.stringify({ ...input, confirm: true })
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

export async function deleteAdminUser(userId: string) {
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
    body: JSON.stringify({ confirm: true })
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

export async function downloadProjectArchive(projectId: string, input: DownloadRequestPayload) {
  const response = await fetch(`${API_ROOT}/api/projects/${encodeURIComponent(projectId)}/download`, {
    method: 'POST',
    credentials: 'include',
    headers: buildRequestHeaders({
      headers: { 'Content-Type': 'application/json' }
    }),
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    if (response.status === 409) {
      const payload = (await response.json().catch(() => null)) as { missingFiles?: unknown } | null;
      const missingFiles = Array.isArray(payload?.missingFiles) ? payload.missingFiles.filter((item) => typeof item === 'string') : [];
      const suffix = missingFiles.length ? ` Missing: ${missingFiles.slice(0, 5).join(', ')}` : '';
      throw new ApiRequestError(`Project results are incomplete.${suffix}`, response.status);
    }
    throw new ApiRequestError(await readErrorMessage(response), response.status);
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  return {
    downloadUrl,
    fileName: `${projectId}.zip`,
    revoke: () => URL.revokeObjectURL(downloadUrl)
  };
}

function uploadFileBatch(projectId: string, files: File[], onProgress: (loadedBytes: number) => void) {
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
        throw error;
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
    return await runWithOfflineRetry(() => completeDirectObjectUploadReferences(projectId, files), {
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
  return new Promise<void>((resolve, reject) => {
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
  });
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
  return new Promise<string>((resolve, reject) => {
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
  });
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

  if (pendingPartNumbers.length) {
    const refreshed = await runWithOfflineRetry(() => refreshMultipartPartUrls(projectId, storageKey, uploadId, pendingPartNumbers), {
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

  const reportProgress = () => {
    const activeLoadedBytes = batchLoadedBytes.reduce((sum, value) => sum + Math.max(0, value), 0);
    const overallBytes = Math.min(totalBytes, uploadedBytes + activeLoadedBytes);
    const percent = Math.round((overallBytes / totalBytes) * 100);
    onProgress(percent, {
      stage: percent >= 100 ? 'completed' : 'uploading',
      percent,
      uploadedFiles,
      totalFiles: files.length
    });
  };

  async function worker() {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex] ?? [];
      const batchBytes = batch.reduce((sum, file) => sum + Math.max(1, file.size), 0);
      const response = await uploadFileBatchWithRetry(projectId, batch, (loadedBytes) => {
        batchLoadedBytes[batchIndex] = Math.min(batchBytes, Math.max(0, loadedBytes));
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
  return {
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : DEFAULT_DIRECT_UPLOAD_TARGET_MAX_FILES,
    maxBatchBytes:
      Number.isFinite(maxBatchBytes) && maxBatchBytes > 0
        ? Math.floor(maxBatchBytes)
        : DEFAULT_DIRECT_UPLOAD_TARGET_MAX_BATCH_BYTES
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
  if (!pendingFiles.length) {
    const completedObjects = collectCompletedObjects(files, completedByIdentity);
    onProgress(96, {
      stage: 'finalizing',
      percent: 96,
      uploadedFiles: files.length,
      totalFiles: files.length
    });
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
    await clearPersistedProject(projectId);
    emitUploadBatchEvent('upload.batch-completed', { projectId, files, uploadedFiles: files.length, failedFiles: [] });
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
    const percent = Math.round((Math.min(totalBytes, completedBytes + activeBytes) / totalBytes) * 95);
    const safePercent = Math.max(1, Math.min(95, percent));
    onProgress(safePercent, {
      stage: 'uploading',
      percent: safePercent,
      uploadedFiles,
      totalFiles: files.length,
      ...overrides
    });
  };

  const pendingEntries = pendingFiles.map((file, index) => ({ file, index }));
  const targetBatches = splitDirectUploadTargetBatches(pendingEntries, normalizeDirectUploadTargetLimits(targetLimits));

  async function uploadTargetBatch(batch: PendingDirectUploadFile[]) {
    throwIfUploadAborted(options.signal);
    reportProgress({ stage: 'preparing' });
    const batchFiles = batch.map((item) => item.file);
    const { targets } = await runWithOfflineRetry(() => createDirectUploadTargets(projectId, batchFiles), {
      signal: options.signal,
      onPause: () => reportProgress({ stage: 'paused', offline: true })
    });
    if (targets.length !== batch.length) {
      throw new Error('Direct upload target count mismatch.');
    }

    let nextBatchFileIndex = 0;
    let batchCompletedBytes = 0;
    const maxWorkerCount = Math.min(ADAPTIVE_UPLOAD_MAX_CONCURRENCY, batch.length);
    let targetWorkerCount = clampUploadConcurrency(getDirectObjectUploadConcurrency(batchFiles), maxWorkerCount);
    let lastSampleAt = performance.now();
    let lastSampleBytes = 0;
    const getBatchTransferredBytes = () =>
      batchCompletedBytes + batch.reduce((sum, item) => sum + Math.max(0, loadedByFile[item.index] ?? 0), 0);
    const maybeAdjustConcurrency = () => {
      const now = performance.now();
      const elapsedMs = now - lastSampleAt;
      if (elapsedMs < ADAPTIVE_UPLOAD_SAMPLE_MS) {
        return;
      }

      const bytes = getBatchTransferredBytes();
      const bps = ((bytes - lastSampleBytes) * 1000) / elapsedMs;
      lastSampleAt = now;
      lastSampleBytes = bytes;
      if (!Number.isFinite(bps) || bps <= 0) {
        return;
      }

      if (bps < ADAPTIVE_UPLOAD_LOW_BPS) {
        targetWorkerCount = clampUploadConcurrency(
          Math.max(ADAPTIVE_UPLOAD_MIN_CONCURRENCY, Math.floor(targetWorkerCount * 0.7)),
          maxWorkerCount
        );
      } else if (bps > ADAPTIVE_UPLOAD_HIGH_BPS) {
        targetWorkerCount = clampUploadConcurrency(Math.min(targetWorkerCount + 1, ADAPTIVE_UPLOAD_MAX_CONCURRENCY), maxWorkerCount);
      }
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
        const target = targets[batchFileIndex];
        if (!entry || !target) {
          continue;
        }

        const file = entry.file;
        const fileIndex = entry.index;
        const fileIdentity = getFileUploadIdentity(file);
        let uploadedObject: UploadedObjectReference;
        try {
          if (file.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES) {
            uploadedObject = await uploadDirectObjectFileMultipart(
              projectId,
              file,
              (loadedBytes) => {
                loadedByFile[fileIndex] = Math.min(file.size, Math.max(0, loadedBytes));
                maybeAdjustConcurrency();
                reportProgress();
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
            const latestTarget = await uploadDirectObjectFileWithRetry(target, file, (loadedBytes) => {
              loadedByFile[fileIndex] = Math.min(file.size, Math.max(0, loadedBytes));
              maybeAdjustConcurrency();
              reportProgress();
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
                targets[batchFileIndex] = nextTarget;
                return nextTarget;
              },
              onOfflinePause: () => reportProgress({ stage: 'paused', offline: true }),
              projectId,
              signal: options.signal
            });
            targets[batchFileIndex] = latestTarget;
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
        batchCompletedBytes += Math.max(1, file.size);
        uploadedFiles += 1;
        loadedByFile[fileIndex] = 0;
        maybeAdjustConcurrency();
        reportProgress();
      }
    }

    await Promise.all(Array.from({ length: maxWorkerCount }, (_unused, workerIndex) => worker(workerIndex)));
  }

  for (const batch of targetBatches) {
    await uploadTargetBatch(batch);
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
  await clearPersistedProject(projectId);
  if (failedFiles.length) {
    emitUploadBatchEvent('upload.batch-failed-files', { projectId, files, uploadedFiles, failedFiles });
  }
  emitUploadBatchEvent('upload.batch-completed', { projectId, files, uploadedFiles, failedFiles });
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
