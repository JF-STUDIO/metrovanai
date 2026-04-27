import type { BillingEntry, BillingPackage, BillingSummary, PaymentOrderRecord, ProjectRecord } from './types';

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
}

export type UploadProgressStage = 'preparing' | 'uploading' | 'retrying' | 'finalizing' | 'completed';

export interface UploadProgressSnapshot {
  stage: UploadProgressStage;
  percent: number;
  uploadedFiles: number;
  totalFiles: number;
  currentFileName?: string;
  attempt?: number;
  maxAttempts?: number;
}

export type UploadProgressHandler = (percent: number, snapshot?: UploadProgressSnapshot) => void;

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
const MAX_UPLOAD_CONCURRENT_BATCHES = 24;
const MAX_UPLOAD_BATCH_RETRIES = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 850;
const UPLOAD_RETRY_JITTER_MS = 650;
const DIRECT_OBJECT_UPLOAD_TIMEOUT_MS = 8 * 60 * 1000;

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

async function jsonRequest<T>(requestPath: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${requestPath}`, {
    credentials: 'include',
    ...init,
    headers: buildRequestHeaders(init)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
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

export async function updateAdminSettings(input: AdminSystemSettings) {
  return await jsonRequest<{ settings: AdminSystemSettings }>('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ ...input, confirm: true })
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

export async function downloadProjectArchive(projectId: string, input: DownloadRequestPayload) {
  const response = await fetch(`${API_ROOT}/api/projects/${projectId}/download`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob,
    fileName: match?.[1] ?? `${projectId}.zip`
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

  for (let attempt = 1; attempt <= MAX_UPLOAD_BATCH_RETRIES; attempt += 1) {
    try {
      onProgress(0);
      return await uploadFileBatch(projectId, batch, onProgress);
    } catch (error) {
      lastError = error;
      onProgress(0);
      if (attempt >= MAX_UPLOAD_BATCH_RETRIES) {
        break;
      }
      await delay(uploadRetryDelay(attempt));
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

async function completeDirectObjectUpload(projectId: string, files: File[], targets: DirectUploadTarget[]) {
  return await jsonRequest<{ project: ProjectRecord }>(`/api/projects/${projectId}/direct-upload/complete`, {
    method: 'POST',
    body: JSON.stringify({
      files: targets.map((target, index) => {
        const file = files[index];
        return {
          originalName: target.originalName || file?.name || `upload-${index + 1}`,
          mimeType: file?.type || target.mimeType || 'application/octet-stream',
          size: file?.size || target.size,
          storageKey: target.storageKey
        };
      })
    })
  });
}

function uploadDirectObjectFile(target: DirectUploadTarget, file: File, onProgress: (loadedBytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new DirectUploadError(`Direct upload failed: ${xhr.status}`, xhr.status));
      }
    });
    xhr.addEventListener('error', () => reject(new DirectUploadError('Direct upload failed.')));
    xhr.addEventListener('timeout', () => reject(new DirectUploadError('Direct upload timed out.')));
    xhr.addEventListener('abort', () => reject(new DirectUploadError('Direct upload was interrupted.')));
    xhr.send(file);
  });
}

async function uploadDirectObjectFileWithRetry(
  target: DirectUploadTarget,
  file: File,
  onProgress: (loadedBytes: number) => void,
  options: {
    onRetry?: (retry: { attempt: number; maxAttempts: number; error: unknown }) => void;
    refreshTarget?: () => Promise<DirectUploadTarget>;
  } = {}
) {
  let lastError: unknown = null;
  let activeTarget = target;

  for (let attempt = 1; attempt <= MAX_UPLOAD_BATCH_RETRIES; attempt += 1) {
    try {
      onProgress(0);
      await uploadDirectObjectFile(activeTarget, file, onProgress);
      return activeTarget;
    } catch (error) {
      lastError = error;
      onProgress(0);
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
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Direct upload failed.');
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

async function uploadFilesViaDirectObject(projectId: string, files: File[], onProgress: UploadProgressHandler) {
  onProgress(1, {
    stage: 'preparing',
    percent: 1,
    uploadedFiles: 0,
    totalFiles: files.length
  });
  const { targets } = await createDirectUploadTargets(projectId, files);
  if (targets.length !== files.length) {
    throw new Error('Direct upload target count mismatch.');
  }

  const totalBytes = Math.max(
    1,
    files.reduce((sum, file) => sum + Math.max(1, file.size), 0)
  );
  const loadedByFile = new Array<number>(files.length).fill(0);
  let completedBytes = 0;
  let uploadedFiles = 0;
  let nextFileIndex = 0;

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

  async function worker() {
    while (nextFileIndex < files.length) {
      const fileIndex = nextFileIndex;
      nextFileIndex += 1;
      const file = files[fileIndex];
      const target = targets[fileIndex];
      if (!file || !target) {
        continue;
      }

      const latestTarget = await uploadDirectObjectFileWithRetry(target, file, (loadedBytes) => {
        loadedByFile[fileIndex] = Math.min(file.size, Math.max(0, loadedBytes));
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
          const refreshed = await createDirectUploadTargets(projectId, [file]);
          const nextTarget = refreshed.targets[0];
          if (!nextTarget) {
            throw new Error('Direct upload target refresh failed.');
          }
          targets[fileIndex] = nextTarget;
          return nextTarget;
        }
      });
      targets[fileIndex] = latestTarget;

      completedBytes += Math.max(1, file.size);
      uploadedFiles += 1;
      loadedByFile[fileIndex] = 0;
      reportProgress();
    }
  }

  const workerCount = Math.min(MAX_UPLOAD_CONCURRENT_BATCHES, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  onProgress(96, {
    stage: 'finalizing',
    percent: 96,
    uploadedFiles: files.length,
    totalFiles: files.length
  });
  const response = await completeDirectObjectUpload(projectId, files, targets);
  onProgress(100, {
    stage: 'completed',
    percent: 100,
    uploadedFiles: files.length,
    totalFiles: files.length
  });
  return {
    ...response,
    directUploadFiles: targets.map((target, index) => {
      const file = files[index];
      return {
        originalName: target.originalName || file?.name || `upload-${index + 1}`,
        mimeType: file?.type || target.mimeType || 'application/octet-stream',
        size: file?.size || target.size,
        storageKey: target.storageKey
      };
    })
  };
}

export async function uploadFiles(projectId: string, files: File[], onProgress: UploadProgressHandler) {
  const capabilities = await fetchUploadCapabilities().catch(() => null);
  if (capabilities?.directObject.enabled) {
    return await uploadFilesViaDirectObject(projectId, files, onProgress);
  }

  if ((capabilities?.localProxy.enabled || !capabilities) && isLocalDevelopmentOrigin()) {
    return await uploadFilesViaLocalProxy(projectId, files, onProgress);
  }

  throw new Error('Cloud upload is not available right now. Please try again later.');
}
