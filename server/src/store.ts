import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  AuditLogEntry,
  BillingActivationCode,
  BillingEntry,
  BillingSummary,
  ColorMode,
  EmailVerificationTokenRecord,
  HdrItem,
  HdrItemWorkflowState,
  PaymentOrderRecord,
  PaymentOrderRefundPreview,
  PasswordResetTokenRecord,
  ProjectGroup,
  ProjectDownloadJobRecord,
  ProjectJobState,
  ProjectRegenerationUsage,
  ProjectRecord,
  ResultAsset,
  SceneType,
  SessionRecord,
  SystemSettings,
  UserLocale,
  UserRole,
  UserAccountStatus,
  UserRecord
} from './types.js';
import {
  ensureDir,
  normalizeHex,
  sanitizeSegment
} from './utils.js';
import {
  createStorageProvider,
  type StorageProvider,
  type TrashFileInput,
  type TrashRetentionCategory
} from './storage.js';
import { normalizeBillingPackages } from './billing-packages.js';
import {
  createMetadataProvider,
  DEFAULT_RUNPOD_HDR_BATCH_SIZE,
  DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT,
  MAX_RUNPOD_HDR_BATCH_SIZE,
  MAX_RUNNINGHUB_MAX_IN_FLIGHT,
  MIN_RUNPOD_HDR_BATCH_SIZE,
  MIN_RUNNINGHUB_MAX_IN_FLIGHT,
  type DatabaseShape,
  type MetadataProvider
} from './metadata.js';
import { normalizeStudioFeatures } from './studio-features.js';

const DEFAULT_PROJECT_REGENERATION_FREE_LIMIT = 10;

interface GroupTemplate {
  sceneType: SceneType;
  colorMode: ColorMode;
  replacementColor: string | null;
  name: string;
}

const STORAGE_FOLDER_NAMES = {
  originals: '原始',
  previews: '缩略图',
  hdr: 'HDR合并',
  results: '结果',
  staging: '_staging'
} as const;

const LEGACY_FOLDER_NAMES = {
  originals: '鍘熷',
  previews: '缂╃暐鍥?',
  hdr: 'HDR鍚堝苟',
  results: '缁撴灉'
} as const;

const DELETED_SOURCE_RETENTION_DAYS = 7;
const DELETED_RESULT_RETENTION_DAYS = 30;
const PROJECT_DELETE_RETENTION_DAYS: Record<TrashRetentionCategory, number> = {
  originals: DELETED_SOURCE_RETENTION_DAYS,
  previews: DELETED_SOURCE_RETENTION_DAYS,
  hdr: DELETED_SOURCE_RETENTION_DAYS,
  staging: DELETED_SOURCE_RETENTION_DAYS,
  results: DELETED_RESULT_RETENTION_DAYS
};

function normalizeSystemSettings(input: Partial<SystemSettings> | undefined): SystemSettings {
  const parsedBatchSize = Number(input?.runpodHdrBatchSize ?? DEFAULT_RUNPOD_HDR_BATCH_SIZE);
  const parsedRunningHubMaxInFlight = Number(input?.runningHubMaxInFlight ?? DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT);
  return {
    runpodHdrBatchSize: Math.max(
      MIN_RUNPOD_HDR_BATCH_SIZE,
      Math.min(
        MAX_RUNPOD_HDR_BATCH_SIZE,
        Number.isFinite(parsedBatchSize) ? Math.round(parsedBatchSize) : DEFAULT_RUNPOD_HDR_BATCH_SIZE
      )
    ),
    runningHubMaxInFlight: Math.max(
      MIN_RUNNINGHUB_MAX_IN_FLIGHT,
      Math.min(
        MAX_RUNNINGHUB_MAX_IN_FLIGHT,
        Number.isFinite(parsedRunningHubMaxInFlight)
          ? Math.round(parsedRunningHubMaxInFlight)
          : DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT
      )
    ),
    billingPackages: normalizeBillingPackages(input?.billingPackages),
    studioFeatures: normalizeStudioFeatures(input?.studioFeatures)
  };
}

function createEmptyJobState(): ProjectJobState {
  return {
    id: nanoid(10),
    status: 'idle',
    phase: 'idle',
    percent: 0,
    label: '',
    detail: '',
    currentHdrItemId: null,
    startedAt: null,
    completedAt: null,
    workflowRealtime: {
      total: 0,
      entered: 0,
      returned: 0,
      active: 0,
      failed: 0,
      succeeded: 0,
      currentNodeName: '',
      currentNodeId: '',
      currentNodePercent: 0,
      monitorState: '',
      transport: '',
      detail: '',
      queuePosition: 0,
      remoteProgress: 0
    }
  };
}

function normalizeProjectJobState(job: ProjectJobState | null | undefined): ProjectJobState {
  const normalized = {
    ...createEmptyJobState(),
    ...(job ?? {})
  };
  if (normalized.status === 'completed') {
    normalized.phase = 'completed';
  } else if (normalized.status === 'failed') {
    normalized.phase = 'failed';
  } else if (normalized.status === 'queued') {
    normalized.phase = normalized.phase && normalized.phase !== 'idle' ? normalized.phase : 'queued';
  } else if (normalized.status === 'running') {
    normalized.phase = normalized.phase && normalized.phase !== 'idle' ? normalized.phase : 'workflow_running';
  } else if (!normalized.phase) {
    normalized.phase = 'idle';
  }
  return normalized;
}

function createEmptyRegenerationState() {
  return {
    freeUsed: false,
    status: 'idle' as const,
    colorCardNo: null,
    workflowName: null,
    taskId: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null
  };
}

function createEmptyWorkflowState(): HdrItemWorkflowState {
  return {
    stage: 'idle',
    runpodJobId: null,
    runpodBatchJobId: null,
    runningHubTaskId: null,
    runningHubWorkflowName: null,
    lastTaskId: null,
    lastTaskProvider: null,
    submittedAt: null,
    updatedAt: null,
    completedAt: null,
    errorMessage: null
  };
}

function normalizeWorkflowState(workflow: Partial<HdrItemWorkflowState> | null | undefined): HdrItemWorkflowState {
  const normalized = {
    ...createEmptyWorkflowState(),
    ...(workflow ?? {})
  };
  normalized.stage = ['idle', 'runpod', 'runninghub', 'completed', 'failed'].includes(normalized.stage)
    ? normalized.stage
    : 'idle';
  normalized.lastTaskProvider =
    normalized.lastTaskProvider === 'runpod' || normalized.lastTaskProvider === 'runninghub'
      ? normalized.lastTaskProvider
      : null;
  return normalized;
}

function normalizeProjectRegenerationUsage(
  usage: Partial<ProjectRegenerationUsage> | undefined,
  hdrItems: HdrItem[] = []
): ProjectRegenerationUsage {
  const legacyFreeUsed = hdrItems.filter((item) => item.regeneration?.freeUsed).length;
  const freeLimit = Math.max(
    0,
    Math.round(Number(usage?.freeLimit ?? DEFAULT_PROJECT_REGENERATION_FREE_LIMIT))
  );
  const freeUsed = Math.max(0, Math.round(Number(usage?.freeUsed ?? legacyFreeUsed)));
  const paidUsed = Math.max(0, Math.round(Number(usage?.paidUsed ?? 0)));
  return {
    freeLimit,
    freeUsed: Math.min(freeUsed, freeLimit),
    paidUsed
  };
}

function exposureKey(hdrItem: Pick<HdrItem, 'exposures'>) {
  return hdrItem.exposures
    .map((exposure) => exposure.originalName.toLowerCase())
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

function defaultGroupName(index: number) {
  return `第${index}组`;
}

function deriveUserKey(email: string) {
  const localPart = email.split('@')[0] ?? email;
  return sanitizeSegment(localPart.trim().toLowerCase()) || 'user';
}

function normalizeUserLocale(value: unknown): UserLocale {
  return value === 'en' ? 'en' : 'zh';
}

function normalizeUserRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'user';
}

function normalizeUserAccountStatus(value: unknown): UserAccountStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

function normalizeUserRecord(user: UserRecord): UserRecord {
  const rawEmailVerifiedAt = (user as Partial<UserRecord>).emailVerifiedAt;
  const emailVerifiedAt =
    typeof rawEmailVerifiedAt === 'string'
      ? rawEmailVerifiedAt
      : rawEmailVerifiedAt === null
        ? null
        : user.createdAt ?? new Date().toISOString();

  return {
    ...user,
    emailVerifiedAt,
    locale: normalizeUserLocale(user.locale),
    role: normalizeUserRole((user as Partial<UserRecord>).role),
    accountStatus: normalizeUserAccountStatus((user as Partial<UserRecord>).accountStatus)
  };
}

export class LocalStore {
  private readonly runtimeRoot: string;
  private readonly metadata: MetadataProvider;
  private readonly storage: StorageProvider;

  constructor(repoRoot: string) {
    this.runtimeRoot = process.env.METROVAN_RUNTIME_ROOT
      ? path.resolve(process.env.METROVAN_RUNTIME_ROOT)
      : path.join(repoRoot, 'server-runtime');
    ensureDir(this.runtimeRoot);
    this.metadata = createMetadataProvider(process.env.METROVAN_METADATA_PROVIDER, {
      filePath: path.join(this.runtimeRoot, 'db.json')
    });
    this.storage = createStorageProvider(process.env.METROVAN_STORAGE_PROVIDER, {
      storageRoot: path.join(this.runtimeRoot, 'storage'),
      folderNames: STORAGE_FOLDER_NAMES,
      legacyFolderNames: LEGACY_FOLDER_NAMES
    });
  }

  getStorageRoot() {
    return this.storage.getRoot();
  }

  getStorageInfo() {
    return this.storage.getInfo();
  }

  getMetadataInfo() {
    return this.metadata.getInfo();
  }

  async initialize() {
    await this.metadata.initialize?.();
    this.storage.cleanupExpiredTrash();
  }

  cleanupExpiredTrash(now?: Date) {
    return this.storage.cleanupExpiredTrash(now);
  }

  toStorageKey(absolutePath: string) {
    return this.storage.toStorageKey(absolutePath);
  }

  resolveStoragePath(storageKey: string) {
    return this.storage.resolveStoragePath(storageKey);
  }

  toStorageUrlFromKey(storageKey: string) {
    return this.storage.toPublicUrlFromKey(storageKey);
  }

  private loadDb(): DatabaseShape {
    const raw = this.metadata.load();
    const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
    const passwordResetTokens = Array.isArray(raw.passwordResetTokens) ? raw.passwordResetTokens : [];
    const emailVerificationTokens = Array.isArray(raw.emailVerificationTokens) ? raw.emailVerificationTokens : [];
    const users = Array.isArray(raw.users)
      ? raw.users.map((user) => normalizeUserRecord(user))
      : [];
    return {
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      billing: Array.isArray(raw.billing) ? raw.billing : [],
      paymentOrders: Array.isArray(raw.paymentOrders)
        ? raw.paymentOrders.map((order) => this.normalizePaymentOrder(order as PaymentOrderRecord))
        : [],
      processedStripeEvents: Array.isArray(raw.processedStripeEvents) ? raw.processedStripeEvents : [],
      activationCodes: Array.isArray(raw.activationCodes) ? raw.activationCodes : [],
      downloadJobs: Array.isArray(raw.downloadJobs) ? raw.downloadJobs : [],
      users,
      sessions: sessions.filter((session) => !this.isSessionExpired(session)),
      passwordResetTokens: passwordResetTokens.filter((token) => !this.isPasswordResetTokenExpired(token)),
      emailVerificationTokens: emailVerificationTokens.filter((token) => !this.isEmailVerificationTokenExpired(token)),
      auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
      systemSettings: normalizeSystemSettings(raw.systemSettings)
    };
  }

  private saveDb(data: DatabaseShape) {
    this.metadata.save(data);
  }

  toStorageUrl(absolutePath: string) {
    return this.storage.toPublicUrl(absolutePath);
  }

  getProjectDirectories(projectOrUserKey: ProjectRecord | string, projectId?: string) {
    return this.storage.getProjectDirectories(projectOrUserKey, projectId);
  }

  ensureProjectDirectories(project: ProjectRecord) {
    return this.storage.ensureProjectDirectories(project);
  }

  listProjectOriginals(project: ProjectRecord) {
    return this.storage.listProjectOriginals(project);
  }

  listProjectStagedFiles(project: ProjectRecord) {
    return this.storage.listProjectStagedFiles(project);
  }

  listProjects(userKey: string) {
    return this.loadDb().projects
      .filter((project) => project.userKey === userKey)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  listUsers() {
    return this.loadDb().users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  listUserSessions(userId: string) {
    return this.loadDb().sessions
      .filter((session) => session.userId === userId)
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  }

  listAuditLogs(input?: { targetUserId?: string; limit?: number }) {
    const limit = Math.max(1, Math.min(500, Math.round(input?.limit ?? 100)));
    return this.loadDb().auditLogs
      .filter((entry) => !input?.targetUserId || entry.targetUserId === input.targetUserId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }

  createAuditLog(input: {
    actorUserId?: string | null;
    actorEmail?: string | null;
    actorType: AuditLogEntry['actorType'];
    action: string;
    targetUserId?: string | null;
    targetProjectId?: string | null;
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  }) {
    const db = this.loadDb();
    const entry: AuditLogEntry = {
      id: nanoid(14),
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      actorType: input.actorType,
      action: input.action.trim(),
      targetUserId: input.targetUserId ?? null,
      targetProjectId: input.targetProjectId ?? null,
      ipAddress: input.ipAddress ?? '',
      userAgent: input.userAgent ?? '',
      details: input.details ?? {},
      createdAt: new Date().toISOString()
    };
    db.auditLogs.unshift(entry);
    db.auditLogs = db.auditLogs.slice(0, 5000);
    this.saveDb(db);
    return entry;
  }

  listRecoverableProjects() {
    return this.loadDb().projects
      .filter(
        (project) =>
          project.status === 'processing' || project.job?.status === 'queued' || project.job?.status === 'running'
      )
      .sort((a, b) => (a.updatedAt > b.updatedAt ? 1 : -1));
  }

  listProjectsNeedingResultRecovery() {
    return this.loadDb().projects
      .filter((project) =>
        project.hdrItems.some(
          (item) =>
            !item.resultUrl &&
            !item.resultKey &&
            (item.status === 'error' || item.workflow?.stage === 'failed') &&
            Boolean(item.workflow?.runningHubTaskId?.trim())
        )
      )
      .sort((a, b) => (a.updatedAt > b.updatedAt ? 1 : -1));
  }

  listBillingEntries(userKey: string) {
    return this.loadDb().billing
      .filter((entry) => entry.userKey === userKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  getBillingSummary(userKey: string): BillingSummary {
    const entries = this.listBillingEntries(userKey);
    return this.getBillingSummaryFromEntries(entries);
  }

  private getBillingSummaryFromEntries(entries: BillingEntry[]): BillingSummary {
    const totalCreditedPoints = entries
      .filter((entry) => entry.type === 'credit')
      .reduce((sum, entry) => sum + entry.points, 0);
    const totalChargedPoints = entries
      .filter((entry) => entry.type === 'charge')
      .reduce((sum, entry) => sum + entry.points, 0);
    const totalTopUpUsd = entries
      .filter((entry) => entry.type === 'credit')
      .reduce((sum, entry) => sum + entry.amountUsd, 0);

    return {
      availablePoints: Math.max(0, totalCreditedPoints - totalChargedPoints),
      totalCreditedPoints,
      totalChargedPoints,
      totalTopUpUsd: Number(totalTopUpUsd.toFixed(2))
    };
  }

  private getRawBillingBalanceFromEntries(entries: BillingEntry[]) {
    const totalCreditedPoints = entries
      .filter((entry) => entry.type === 'credit')
      .reduce((sum, entry) => sum + entry.points, 0);
    const totalChargedPoints = entries
      .filter((entry) => entry.type === 'charge')
      .reduce((sum, entry) => sum + entry.points, 0);
    return totalCreditedPoints - totalChargedPoints;
  }

  private normalizePaymentOrder(order: PaymentOrderRecord): PaymentOrderRecord {
    return {
      ...order,
      stripeRefundId: order.stripeRefundId ?? null,
      refundedAmountUsd: Number(Math.max(0, order.refundedAmountUsd ?? 0).toFixed(2)),
      refundedPoints: Math.max(0, Math.round(order.refundedPoints ?? 0)),
      refundBillingEntryId: order.refundBillingEntryId ?? null,
      refundedAt: order.refundedAt ?? null
    };
  }

  getProject(projectId: string) {
    return this.loadDb().projects.find((project) => project.id === projectId) ?? null;
  }

  getSystemSettings() {
    return normalizeSystemSettings(this.loadDb().systemSettings);
  }

  updateSystemSettings(input: Partial<SystemSettings>) {
    const db = this.loadDb();
    db.systemSettings = normalizeSystemSettings({
      ...db.systemSettings,
      ...input
    });
    this.saveDb(db);
    return db.systemSettings;
  }

  getProjectForUser(projectId: string, userKey: string) {
    const project = this.getProject(projectId);
    if (!project || project.userKey !== userKey) {
      return null;
    }
    return project;
  }

  getProjectDownloadJob(projectId: string, jobId: string, userKey: string) {
    return (
      this.loadDb().downloadJobs.find((job) => job.projectId === projectId && job.jobId === jobId && job.userKey === userKey) ??
      null
    );
  }

  listProjectDownloadJobs(projectId: string) {
    return this.loadDb().downloadJobs.filter((job) => job.projectId === projectId);
  }

  findReusableProjectDownloadJob(projectId: string, userKey: string, requestKey: string, retentionMs: number) {
    const job =
      this.loadDb().downloadJobs.find((item) => item.projectId === projectId && item.userKey === userKey && item.requestKey === requestKey) ??
      null;
    if (!job) {
      return null;
    }
    if (!['ready', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }
    if (job.status === 'ready' && job.completedAt && Date.now() - job.completedAt < retentionMs) {
      return job;
    }
    return null;
  }

  upsertProjectDownloadJob(job: ProjectDownloadJobRecord) {
    const db = this.loadDb();
    const index = db.downloadJobs.findIndex((item) => item.jobId === job.jobId);
    if (index === -1) {
      db.downloadJobs.unshift(job);
    } else {
      db.downloadJobs[index] = job;
    }
    db.downloadJobs = db.downloadJobs.slice(0, 1000);
    this.saveDb(db);
    return job;
  }

  markInterruptedDownloadJobsFailed(message: string) {
    const db = this.loadDb();
    let count = 0;
    db.downloadJobs = db.downloadJobs.map((job) => {
      if (['ready', 'failed', 'cancelled'].includes(job.status)) {
        return job;
      }
      count += 1;
      return {
        ...job,
        status: 'failed',
        progress: 100,
        completedAt: Date.now(),
        error: message
      };
    });
    if (count > 0) {
      this.saveDb(db);
    }
    return count;
  }

  getUserById(userId: string) {
    return this.loadDb().users.find((user) => user.id === userId) ?? null;
  }

  getUserByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    return this.loadDb().users.find((user) => user.email === normalizedEmail) ?? null;
  }

  getUserByGoogleSubject(googleSubject: string) {
    return this.loadDb().users.find((user) => user.googleSubject === googleSubject) ?? null;
  }

  createUser(input: {
    email: string;
    displayName: string;
    locale?: UserLocale;
    passwordHash?: string | null;
    googleSubject?: string | null;
  }) {
    const db = this.loadDb();
    const normalizedEmail = input.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: nanoid(12),
      userKey: this.ensureUniqueUserKey(db.users, deriveUserKey(normalizedEmail)),
      email: normalizedEmail,
      emailVerifiedAt: input.googleSubject ? now : null,
      displayName: input.displayName.trim() || deriveUserKey(normalizedEmail),
      locale: input.locale ?? 'zh',
      role: 'user',
      accountStatus: 'active',
      passwordHash: input.passwordHash ?? null,
      googleSubject: input.googleSubject ?? null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    };
    db.users.unshift(user);
    this.saveDb(db);
    return user;
  }

  updateUser(userId: string, updater: (user: UserRecord) => UserRecord) {
    const db = this.loadDb();
    const index = db.users.findIndex((user) => user.id === userId);
    if (index === -1) {
      return null;
    }

    const nextUser = updater(db.users[index]!);
    const updated = {
      ...nextUser,
      emailVerifiedAt: nextUser.emailVerifiedAt ?? null,
      locale: normalizeUserLocale(nextUser.locale),
      role: normalizeUserRole(nextUser.role),
      accountStatus: normalizeUserAccountStatus(nextUser.accountStatus),
      updatedAt: new Date().toISOString()
    };
    db.users[index] = updated;
    this.saveDb(db);
    return updated;
  }

  upsertGoogleUser(input: { email: string; displayName: string; googleSubject: string; locale?: UserLocale }) {
    const db = this.loadDb();
    const normalizedEmail = input.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const index = db.users.findIndex(
      (user) => user.googleSubject === input.googleSubject || user.email === normalizedEmail
    );

    if (index !== -1) {
      const existing = db.users[index]!;
      const updated: UserRecord = {
        ...existing,
        email: normalizedEmail,
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        displayName: input.displayName.trim() || existing.displayName,
        locale: input.locale ?? existing.locale ?? 'zh',
        role: normalizeUserRole(existing.role),
        accountStatus: normalizeUserAccountStatus(existing.accountStatus),
        googleSubject: input.googleSubject,
        updatedAt: now
      };
      db.users[index] = updated;
      this.saveDb(db);
      return updated;
    }

    const user: UserRecord = {
      id: nanoid(12),
      userKey: this.ensureUniqueUserKey(db.users, deriveUserKey(normalizedEmail)),
      email: normalizedEmail,
      emailVerifiedAt: now,
      displayName: input.displayName.trim() || deriveUserKey(normalizedEmail),
      locale: input.locale ?? 'zh',
      role: 'user',
      accountStatus: 'active',
      passwordHash: null,
      googleSubject: input.googleSubject,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    };
    db.users.unshift(user);
    this.saveDb(db);
    return user;
  }

  markUserLoggedIn(userId: string) {
    return this.updateUser(userId, (user) => ({
      ...user,
      lastLoginAt: new Date().toISOString()
    }));
  }

  createSession(userId: string, tokenHash: string, ttlMs: number, csrfTokenHash: string | null = null) {
    const db = this.loadDb();
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: nanoid(18),
      userId,
      tokenHash,
      csrfTokenHash,
      createdAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      lastSeenAt: now
    };
    db.sessions = db.sessions.filter((item) => !this.isSessionExpired(item));
    db.sessions.unshift(session);
    this.saveDb(db);
    return session;
  }

  getSessionByTokenHash(tokenHash: string) {
    const session = this.loadDb().sessions.find((item) => item.tokenHash === tokenHash) ?? null;
    if (!session || this.isSessionExpired(session)) {
      return null;
    }
    return session;
  }

  touchSession(sessionId: string) {
    const db = this.loadDb();
    const index = db.sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return null;
    }
    const updated = {
      ...db.sessions[index]!,
      lastSeenAt: new Date().toISOString()
    };
    db.sessions[index] = updated;
    this.saveDb(db);
    return updated;
  }

  setSessionCsrfTokenHash(sessionId: string, csrfTokenHash: string) {
    const db = this.loadDb();
    const index = db.sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return null;
    }

    const updated = {
      ...db.sessions[index]!,
      csrfTokenHash,
      lastSeenAt: new Date().toISOString()
    };
    db.sessions[index] = updated;
    this.saveDb(db);
    return updated;
  }

  deleteSessionByTokenHash(tokenHash: string) {
    const db = this.loadDb();
    const nextSessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (nextSessions.length === db.sessions.length) {
      return false;
    }
    db.sessions = nextSessions;
    this.saveDb(db);
    return true;
  }

  deleteSessionsForUser(userId: string) {
    const db = this.loadDb();
    const nextSessions = db.sessions.filter((session) => session.userId !== userId);
    const removed = db.sessions.length - nextSessions.length;
    if (!removed) {
      return 0;
    }

    db.sessions = nextSessions;
    this.saveDb(db);
    return removed;
  }

  deleteUser(userId: string) {
    const db = this.loadDb();
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      return null;
    }

    const projects = db.projects.filter((project) => project.userKey === user.userKey);
    const archives: Array<ReturnType<StorageProvider['trashProjectRoot']>> = [];
    const archiveErrors: Array<{ projectId: string; error: string }> = [];
    for (const project of projects) {
      try {
        archives.push(this.storage.trashProjectRoot(project, PROJECT_DELETE_RETENTION_DAYS));
      } catch (error) {
        archiveErrors.push({
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const removed = {
      projects: projects.length,
      sessions: db.sessions.filter((session) => session.userId === user.id).length,
      passwordResetTokens: db.passwordResetTokens.filter((token) => token.userId === user.id).length,
      emailVerificationTokens: db.emailVerificationTokens.filter((token) => token.userId === user.id).length,
      billingEntries: db.billing.filter((entry) => entry.userKey === user.userKey).length,
      paymentOrders: db.paymentOrders.filter((order) => order.userKey === user.userKey).length,
      auditLogs: db.auditLogs.filter((entry) => entry.actorUserId === user.id || entry.targetUserId === user.id).length
    };

    db.users = db.users.filter((item) => item.id !== user.id);
    db.projects = db.projects.filter((project) => project.userKey !== user.userKey);
    db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    db.passwordResetTokens = db.passwordResetTokens.filter((token) => token.userId !== user.id);
    db.emailVerificationTokens = db.emailVerificationTokens.filter((token) => token.userId !== user.id);
    db.billing = db.billing.filter((entry) => entry.userKey !== user.userKey);
    db.paymentOrders = db.paymentOrders.filter((order) => order.userKey !== user.userKey);
    db.auditLogs = db.auditLogs.filter((entry) => entry.actorUserId !== user.id && entry.targetUserId !== user.id);
    this.saveDb(db);
    return { user, removed, archives, archiveErrors };
  }

  createPasswordResetToken(userId: string, tokenHash: string, ttlMs: number) {
    const db = this.loadDb();
    const now = new Date().toISOString();
    db.passwordResetTokens = db.passwordResetTokens
      .filter((token) => !this.isPasswordResetTokenExpired(token))
      .map((token) =>
        token.userId === userId && token.usedAt === null
          ? {
              ...token,
              usedAt: now
            }
          : token
      );

    const token: PasswordResetTokenRecord = {
      id: nanoid(18),
      userId,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      usedAt: null
    };
    db.passwordResetTokens.unshift(token);
    this.saveDb(db);
    return token;
  }

  getPasswordResetTokenByHash(tokenHash: string) {
    const token = this.loadDb().passwordResetTokens.find((item) => item.tokenHash === tokenHash) ?? null;
    if (!token || token.usedAt !== null || this.isPasswordResetTokenExpired(token)) {
      return null;
    }
    return token;
  }

  markPasswordResetTokenUsed(tokenId: string) {
    const db = this.loadDb();
    const index = db.passwordResetTokens.findIndex((token) => token.id === tokenId);
    if (index === -1) {
      return null;
    }

    const updated: PasswordResetTokenRecord = {
      ...db.passwordResetTokens[index]!,
      usedAt: new Date().toISOString()
    };
    db.passwordResetTokens[index] = updated;
    this.saveDb(db);
    return updated;
  }

  createEmailVerificationToken(userId: string, tokenHash: string, ttlMs: number) {
    const db = this.loadDb();
    const now = new Date().toISOString();
    db.emailVerificationTokens = db.emailVerificationTokens
      .filter((token) => !this.isEmailVerificationTokenExpired(token))
      .map((token) =>
        token.userId === userId && token.usedAt === null
          ? {
              ...token,
              usedAt: now
            }
          : token
      );

    const token: EmailVerificationTokenRecord = {
      id: nanoid(18),
      userId,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      usedAt: null
    };
    db.emailVerificationTokens.unshift(token);
    this.saveDb(db);
    return token;
  }

  getEmailVerificationTokenByHash(tokenHash: string) {
    const token = this.loadDb().emailVerificationTokens.find((item) => item.tokenHash === tokenHash) ?? null;
    if (!token || token.usedAt !== null || this.isEmailVerificationTokenExpired(token)) {
      return null;
    }
    return token;
  }

  markEmailVerificationTokenUsed(tokenId: string) {
    const db = this.loadDb();
    const index = db.emailVerificationTokens.findIndex((token) => token.id === tokenId);
    if (index === -1) {
      return null;
    }

    const updated: EmailVerificationTokenRecord = {
      ...db.emailVerificationTokens[index]!,
      usedAt: new Date().toISOString()
    };
    db.emailVerificationTokens[index] = updated;
    this.saveDb(db);
    return updated;
  }

  createProject(input: {
    userKey: string;
    userDisplayName: string;
    name: string;
    address?: string;
    studioFeatureId?: string | null;
  }) {
    const db = this.loadDb();
    const now = new Date().toISOString();
    const feature = normalizeStudioFeatures(db.systemSettings?.studioFeatures).find(
      (item) => item.enabled && item.id === input.studioFeatureId
    );
    const project: ProjectRecord = {
      id: nanoid(10),
      userKey: input.userKey,
      userDisplayName: input.userDisplayName,
      name: input.name,
      address: input.address ?? '',
      status: 'draft',
      currentStep: 1,
      pointsEstimate: 0,
      pointsSpent: 0,
      studioFeatureId: feature?.id ?? null,
      studioFeatureTitle: feature?.titleZh ?? feature?.titleEn ?? null,
      workflowId: feature?.workflowId || null,
      workflowInputNodeId: feature?.inputNodeId || null,
      workflowOutputNodeId: feature?.outputNodeId || null,
      pointsPerPhoto: feature?.pointsPerPhoto ?? 1,
      regenerationUsage: normalizeProjectRegenerationUsage(undefined),
      photoCount: 0,
      groupCount: 1,
      downloadReady: false,
      createdAt: now,
      updatedAt: now,
      uploadCompletedAt: null,
      hdrItems: [],
      groups: [this.createGroupShape(1, defaultGroupName(1), 'pending')],
      resultAssets: [],
      job: createEmptyJobState()
    };
    db.projects.unshift(project);
    this.saveDb(db);
    this.ensureProjectDirectories(project);
    return project;
  }

  createBillingEntry(input: {
    userKey: string;
    type: 'charge' | 'credit';
    points: number;
    amountUsd: number;
    note: string;
    projectId?: string | null;
    projectName?: string | null;
    activationCodeId?: string | null;
    activationCode?: string | null;
    activationCodeLabel?: string | null;
  }) {
    const db = this.loadDb();
    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: input.userKey,
      type: input.type,
      points: Math.max(0, Math.round(input.points)),
      amountUsd: Number(Math.max(0, input.amountUsd).toFixed(2)),
      note: input.note.trim(),
      projectId: input.projectId ?? null,
      projectName: input.projectName?.trim() ?? '',
      activationCodeId: input.activationCodeId ?? null,
      activationCode: input.activationCode?.trim().toUpperCase() || null,
      activationCodeLabel: input.activationCodeLabel?.trim() || null,
      createdAt: new Date().toISOString()
    };
    db.billing.unshift(entry);
    this.saveDb(db);
    return entry;
  }

  listPaymentOrders(userKey?: string) {
    return this.loadDb().paymentOrders
      .filter((order) => !userKey || order.userKey === userKey)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  }

  getPaymentOrderById(orderId: string) {
    return this.loadDb().paymentOrders.find((order) => order.id === orderId) ?? null;
  }

  getPaymentOrderByStripeSessionId(sessionId: string) {
    return this.loadDb().paymentOrders.find((order) => order.stripeCheckoutSessionId === sessionId) ?? null;
  }

  getPaymentOrderByStripePaymentIntentId(paymentIntentId: string) {
    const normalizedPaymentIntentId = paymentIntentId.trim();
    if (!normalizedPaymentIntentId) {
      return null;
    }
    return (
      this.loadDb().paymentOrders.find((order) => order.stripePaymentIntentId === normalizedPaymentIntentId) ?? null
    );
  }

  getPaymentOrderRefundPreview(orderId: string) {
    const db = this.loadDb();
    const order = db.paymentOrders.find((item) => item.id === orderId);
    if (!order) {
      return null;
    }
    return this.buildPaymentOrderRefundPreview(db.billing, order);
  }

  private buildPaymentOrderRefundPreview(
    billingEntries: BillingEntry[],
    order: PaymentOrderRecord,
    input?: { refundAmountUsd?: number; refundPoints?: number }
  ): PaymentOrderRefundPreview {
    const normalizedOrder = this.normalizePaymentOrder(order);
    const userEntries = billingEntries.filter((entry) => entry.userKey === normalizedOrder.userKey);
    const rawBalance = this.getRawBillingBalanceFromEntries(userEntries);
    const alreadyRefundedAmountUsd = Number(Math.max(0, normalizedOrder.refundedAmountUsd).toFixed(2));
    const alreadyRefundedPoints = Math.max(0, Math.round(normalizedOrder.refundedPoints));
    const maxRefundAmountUsd = Number(Math.max(0, normalizedOrder.amountUsd - alreadyRefundedAmountUsd).toFixed(2));
    const maxRefundPoints = Math.max(0, normalizedOrder.points - alreadyRefundedPoints);
    const requestedAmountUsd =
      input?.refundAmountUsd === undefined
        ? maxRefundAmountUsd
        : Number(Math.max(0, Math.min(maxRefundAmountUsd, input.refundAmountUsd)).toFixed(2));
    const proportionalPoints =
      normalizedOrder.amountUsd > 0
        ? Math.round((normalizedOrder.points * requestedAmountUsd) / normalizedOrder.amountUsd)
        : maxRefundPoints;
    const requestedPoints =
      input?.refundPoints === undefined
        ? requestedAmountUsd > 0
          ? Math.min(maxRefundPoints, Math.max(1, proportionalPoints))
          : 0
        : Math.max(0, Math.min(maxRefundPoints, Math.round(input.refundPoints)));
    const refundablePoints = input?.refundAmountUsd === undefined && input?.refundPoints === undefined ? maxRefundPoints : requestedPoints;
    const refundableAmountUsd = requestedAmountUsd;

    return {
      orderId: normalizedOrder.id,
      orderAmountUsd: Number(Math.max(0, normalizedOrder.amountUsd).toFixed(2)),
      creditedPoints: Math.max(0, Math.round(normalizedOrder.points)),
      currentBalance: rawBalance,
      consumedPoints: Math.max(0, refundablePoints - Math.max(0, rawBalance)),
      alreadyRefundedAmountUsd,
      alreadyRefundedPoints,
      refundableAmountUsd,
      refundablePoints,
      balanceAfterRefund: rawBalance - refundablePoints
    };
  }

  refundPaymentOrderCredits(
    orderId: string,
    input: {
      stripeRefundId?: string | null;
      refundAmountUsd?: number;
      refundPoints?: number;
      note?: string;
    }
  ) {
    const db = this.loadDb();
    const index = db.paymentOrders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      return null;
    }

    const order = this.normalizePaymentOrder(db.paymentOrders[index]!);
    const stripeRefundId = input.stripeRefundId?.trim() || null;
    if (stripeRefundId && order.stripeRefundId === stripeRefundId && order.refundBillingEntryId) {
      return {
        order,
        entry: db.billing.find((entry) => entry.id === order.refundBillingEntryId) ?? null,
        preview: this.buildPaymentOrderRefundPreview(db.billing, order),
        created: false
      };
    }

    const preview = this.buildPaymentOrderRefundPreview(db.billing, order, {
      refundAmountUsd: input.refundAmountUsd,
      refundPoints: input.refundPoints
    });
    if (preview.refundableAmountUsd <= 0 || preview.refundablePoints <= 0) {
      return {
        order,
        entry: null,
        preview,
        created: false
      };
    }

    const now = new Date().toISOString();
    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: order.userKey,
      type: 'charge',
      points: preview.refundablePoints,
      amountUsd: preview.refundableAmountUsd,
      note: input.note?.trim() || `Stripe退款扣回积分：${order.packageName} [${order.id}]`,
      projectId: null,
      projectName: '',
      createdAt: now
    };

    db.billing.unshift(entry);
    const nextRefundedAmountUsd = Number((order.refundedAmountUsd + preview.refundableAmountUsd).toFixed(2));
    const nextRefundedPoints = order.refundedPoints + preview.refundablePoints;
    const isFullyRefunded =
      nextRefundedAmountUsd >= Number(Math.max(0, order.amountUsd - 0.01).toFixed(2)) ||
      nextRefundedPoints >= order.points;
    const updated: PaymentOrderRecord = {
      ...order,
      status: isFullyRefunded ? 'refunded' : order.status,
      errorMessage: null,
      stripeRefundId: stripeRefundId ?? order.stripeRefundId,
      refundedAmountUsd: nextRefundedAmountUsd,
      refundedPoints: nextRefundedPoints,
      refundBillingEntryId: entry.id,
      refundedAt: now,
      updatedAt: now
    };
    db.paymentOrders[index] = updated;
    this.saveDb(db);
    return {
      order: updated,
      entry,
      preview: this.buildPaymentOrderRefundPreview(db.billing, updated),
      created: true
    };
  }

  reversePaymentOrderRefund(orderId: string, input: { stripeRefundId?: string | null; note?: string }) {
    const db = this.loadDb();
    const index = db.paymentOrders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      return null;
    }

    const order = this.normalizePaymentOrder(db.paymentOrders[index]!);
    const stripeRefundId = input.stripeRefundId?.trim() || null;
    if (stripeRefundId && order.stripeRefundId && order.stripeRefundId !== stripeRefundId) {
      return { order, entry: null, created: false };
    }
    if (order.refundedAmountUsd <= 0 || order.refundedPoints <= 0) {
      return { order, entry: null, created: false };
    }

    const now = new Date().toISOString();
    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: order.userKey,
      type: 'credit',
      points: order.refundedPoints,
      amountUsd: order.refundedAmountUsd,
      note: input.note?.trim() || `Stripe退款失败返还积分：${order.packageName} [${order.id}]`,
      projectId: null,
      projectName: '',
      createdAt: now
    };
    db.billing.unshift(entry);

    const updated: PaymentOrderRecord = {
      ...order,
      status: order.fulfilledAt ? 'paid' : order.status === 'refunded' ? 'paid' : order.status,
      stripeRefundId: null,
      refundedAmountUsd: 0,
      refundedPoints: 0,
      refundBillingEntryId: null,
      refundedAt: null,
      errorMessage: 'Stripe refund failed; refunded points were restored.',
      updatedAt: now
    };
    db.paymentOrders[index] = updated;
    this.saveDb(db);
    return { order: updated, entry, created: true };
  }

  hasProcessedStripeEvent(eventId: string) {
    if (!eventId.trim()) {
      return false;
    }
    return this.loadDb().processedStripeEvents.some((event) => event.id === eventId);
  }

  markStripeEventProcessed(eventId: string, eventType: string) {
    const normalizedEventId = eventId.trim();
    if (!normalizedEventId) {
      return null;
    }

    const db = this.loadDb();
    const existing = db.processedStripeEvents.find((event) => event.id === normalizedEventId);
    if (existing) {
      return existing;
    }

    const record = {
      id: normalizedEventId,
      type: eventType,
      processedAt: new Date().toISOString()
    };
    db.processedStripeEvents.unshift(record);
    db.processedStripeEvents = db.processedStripeEvents.slice(0, 5000);
    this.saveDb(db);
    return record;
  }

  createPaymentOrder(input: {
    userId: string;
    userKey: string;
    email: string;
    packageId: string;
    packageName: string;
    points: number;
    amountUsd: number;
    currency: string;
    activationCodeId?: string | null;
    activationCode?: string | null;
    activationCodeLabel?: string | null;
  }) {
    const db = this.loadDb();
    const now = new Date().toISOString();
    const order: PaymentOrderRecord = {
      id: nanoid(14),
      userId: input.userId,
      userKey: input.userKey,
      email: input.email.trim().toLowerCase(),
      packageId: input.packageId,
      packageName: input.packageName,
      points: Math.max(0, Math.round(input.points)),
      amountUsd: Number(Math.max(0, input.amountUsd).toFixed(2)),
      currency: input.currency.trim().toLowerCase() || 'usd',
      activationCodeId: input.activationCodeId ?? null,
      activationCode: input.activationCode?.trim().toUpperCase() || null,
      activationCodeLabel: input.activationCodeLabel?.trim() || null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeCustomerId: null,
      stripeReceiptUrl: null,
      stripeInvoiceUrl: null,
      stripeInvoicePdfUrl: null,
      stripeRefundId: null,
      refundedAmountUsd: 0,
      refundedPoints: 0,
      refundBillingEntryId: null,
      refundedAt: null,
      checkoutUrl: null,
      status: 'pending',
      errorMessage: null,
      billingEntryId: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      fulfilledAt: null
    };
    db.paymentOrders.unshift(order);
    this.saveDb(db);
    return order;
  }

  updatePaymentOrder(orderId: string, updater: (order: PaymentOrderRecord) => PaymentOrderRecord) {
    const db = this.loadDb();
    const index = db.paymentOrders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      return null;
    }

    const updated = {
      ...updater(db.paymentOrders[index]!),
      updatedAt: new Date().toISOString()
    };
    db.paymentOrders[index] = updated;
    this.saveDb(db);
    return updated;
  }

  attachStripeCheckoutSession(
    orderId: string,
    input: { sessionId: string; checkoutUrl: string | null; customerId?: string | null }
  ) {
    return this.updatePaymentOrder(orderId, (order) => ({
      ...order,
      stripeCheckoutSessionId: input.sessionId,
      stripeCustomerId: input.customerId ?? order.stripeCustomerId,
      checkoutUrl: input.checkoutUrl,
      status: 'checkout_created',
      errorMessage: null
    }));
  }

  markPaymentOrderStatus(
    orderId: string,
    input: {
      status: PaymentOrderRecord['status'];
      errorMessage?: string | null;
      stripePaymentIntentId?: string | null;
      stripeCustomerId?: string | null;
      stripeReceiptUrl?: string | null;
      stripeInvoiceUrl?: string | null;
      stripeInvoicePdfUrl?: string | null;
    }
  ) {
    return this.updatePaymentOrder(orderId, (order) => ({
      ...order,
      status: input.status,
      errorMessage: input.errorMessage ?? order.errorMessage,
      stripePaymentIntentId: input.stripePaymentIntentId ?? order.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId ?? order.stripeCustomerId,
      stripeReceiptUrl: input.stripeReceiptUrl ?? order.stripeReceiptUrl ?? null,
      stripeInvoiceUrl: input.stripeInvoiceUrl ?? order.stripeInvoiceUrl ?? null,
      stripeInvoicePdfUrl: input.stripeInvoicePdfUrl ?? order.stripeInvoicePdfUrl ?? null
    }));
  }

  attachStripePaymentDocuments(
    orderId: string,
    input: { stripeReceiptUrl?: string | null; stripeInvoiceUrl?: string | null; stripeInvoicePdfUrl?: string | null }
  ) {
    return this.updatePaymentOrder(orderId, (order) => ({
      ...order,
      stripeReceiptUrl: input.stripeReceiptUrl ?? order.stripeReceiptUrl ?? null,
      stripeInvoiceUrl: input.stripeInvoiceUrl ?? order.stripeInvoiceUrl ?? null,
      stripeInvoicePdfUrl: input.stripeInvoicePdfUrl ?? order.stripeInvoicePdfUrl ?? null
    }));
  }

  fulfillPaymentOrder(
    orderId: string,
    input: {
      stripePaymentIntentId?: string | null;
      stripeCustomerId?: string | null;
      stripeReceiptUrl?: string | null;
      stripeInvoiceUrl?: string | null;
      stripeInvoicePdfUrl?: string | null;
      note?: string;
    } = {}
  ) {
    const db = this.loadDb();
    const index = db.paymentOrders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      return null;
    }

    const order = db.paymentOrders[index]!;
    if (order.fulfilledAt && order.billingEntryId) {
      const updated: PaymentOrderRecord = {
        ...order,
        stripePaymentIntentId: input.stripePaymentIntentId ?? order.stripePaymentIntentId,
        stripeCustomerId: input.stripeCustomerId ?? order.stripeCustomerId,
        stripeReceiptUrl: input.stripeReceiptUrl ?? order.stripeReceiptUrl ?? null,
        stripeInvoiceUrl: input.stripeInvoiceUrl ?? order.stripeInvoiceUrl ?? null,
        stripeInvoicePdfUrl: input.stripeInvoicePdfUrl ?? order.stripeInvoicePdfUrl ?? null,
        updatedAt: new Date().toISOString()
      };
      db.paymentOrders[index] = updated;
      this.saveDb(db);
      return {
        order: updated,
        entry: db.billing.find((entry) => entry.id === order.billingEntryId) ?? null,
        created: false
      };
    }

    const now = new Date().toISOString();
    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: order.userKey,
      type: 'credit',
      points: order.points,
      amountUsd: Number(order.amountUsd.toFixed(2)),
      note:
        input.note ??
        `Stripe top-up: ${order.packageName}${order.activationCode ? ` with ${order.activationCode}` : ''}`,
      projectId: null,
      projectName: '',
      createdAt: now
    };

    db.billing.unshift(entry);

    if (order.activationCodeId) {
      const activationCodeIndex = db.activationCodes.findIndex((item) => item.id === order.activationCodeId);
      if (activationCodeIndex !== -1) {
        db.activationCodes[activationCodeIndex] = {
          ...db.activationCodes[activationCodeIndex]!,
          redemptionCount: Math.max(0, db.activationCodes[activationCodeIndex]!.redemptionCount) + 1,
          updatedAt: now
        };
      }
    }

    const updated: PaymentOrderRecord = {
      ...order,
      status: 'paid',
      errorMessage: null,
      stripePaymentIntentId: input.stripePaymentIntentId ?? order.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId ?? order.stripeCustomerId,
      stripeReceiptUrl: input.stripeReceiptUrl ?? order.stripeReceiptUrl ?? null,
      stripeInvoiceUrl: input.stripeInvoiceUrl ?? order.stripeInvoiceUrl ?? null,
      stripeInvoicePdfUrl: input.stripeInvoicePdfUrl ?? order.stripeInvoicePdfUrl ?? null,
      billingEntryId: entry.id,
      paidAt: order.paidAt ?? now,
      fulfilledAt: now,
      updatedAt: now
    };
    db.paymentOrders[index] = updated;
    this.saveDb(db);
    return { order: updated, entry, created: true };
  }

  getActivationCodeByCode(code: string) {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      return null;
    }

    return this.loadDb().activationCodes.find((item) => item.code.trim().toUpperCase() === normalizedCode) ?? null;
  }

  getActivationCodeById(activationCodeId: string) {
    return this.loadDb().activationCodes.find((item) => item.id === activationCodeId) ?? null;
  }

  hasUserRedeemedActivationCode(userKey: string, activationCodeId: string) {
    const db = this.loadDb();
    return (
      db.billing.some((entry) => entry.userKey === userKey && entry.activationCodeId === activationCodeId) ||
      db.paymentOrders.some(
        (order) =>
          order.userKey === userKey &&
          order.activationCodeId === activationCodeId &&
          (order.status === 'paid' || Boolean(order.fulfilledAt))
      )
    );
  }

  listActivationCodes() {
    return [...this.loadDb().activationCodes].sort((left, right) => {
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  redeemActivationCode(activationCodeId: string) {
    const db = this.loadDb();
    const index = db.activationCodes.findIndex((item) => item.id === activationCodeId);
    if (index === -1) {
      return null;
    }

    const updated: BillingActivationCode = {
      ...db.activationCodes[index]!,
      redemptionCount: Math.max(0, db.activationCodes[index]!.redemptionCount) + 1,
      updatedAt: new Date().toISOString()
    };
    db.activationCodes[index] = updated;
    this.saveDb(db);
    return updated;
  }

  upsertActivationCode(input: {
    id?: string;
    code: string;
    label: string;
    active?: boolean;
    packageId?: string | null;
    discountPercentOverride?: number | null;
    bonusPoints?: number;
    maxRedemptions?: number | null;
    redemptionCount?: number;
    expiresAt?: string | null;
  }) {
    const db = this.loadDb();
    const normalizedCode = input.code.trim().toUpperCase();
    const now = new Date().toISOString();
    const nextRecord: BillingActivationCode = {
      id: input.id ?? nanoid(10),
      code: normalizedCode,
      label: input.label.trim() || normalizedCode,
      active: input.active ?? true,
      packageId: input.packageId ?? null,
      discountPercentOverride:
        input.discountPercentOverride === null || input.discountPercentOverride === undefined
          ? null
          : Math.max(0, Number(input.discountPercentOverride)),
      bonusPoints: Math.max(0, Math.round(input.bonusPoints ?? 0)),
      maxRedemptions:
        input.maxRedemptions === null || input.maxRedemptions === undefined
          ? null
          : Math.max(1, Math.round(input.maxRedemptions)),
      redemptionCount: Math.max(0, Math.round(input.redemptionCount ?? 0)),
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now
    };

    const index = db.activationCodes.findIndex((item) => item.id === nextRecord.id || item.code === normalizedCode);
    if (index !== -1) {
      const existing = db.activationCodes[index]!;
      db.activationCodes[index] = {
        ...existing,
        ...nextRecord,
        createdAt: existing.createdAt,
        redemptionCount: input.redemptionCount === undefined ? existing.redemptionCount : nextRecord.redemptionCount
      };
    } else {
      db.activationCodes.unshift(nextRecord);
    }

    this.saveDb(db);
    return db.activationCodes[index !== -1 ? index : 0]!;
  }

  deleteActivationCode(id: string) {
    const db = this.loadDb();
    const index = db.activationCodes.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const removed = db.activationCodes.splice(index, 1)[0]!;
    this.saveDb(db);
    return removed;
  }

  getProjectChargeEntry(projectId: string) {
    return (
      this.loadDb().billing.find((entry) => entry.projectId === projectId && entry.type === 'charge') ?? null
    );
  }

  reserveProjectProcessingCredits(projectId: string, amountUsdPerPoint: number) {
    const db = this.loadDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      return { ok: false as const, error: 'Project not found.', availablePoints: 0, requiredPoints: 0 };
    }

    const requiredPoints = Math.max(0, Math.round(project.pointsEstimate));
    if (requiredPoints <= 0) {
      return { ok: true as const, entry: null, availablePoints: this.getBillingSummaryFromEntries(db.billing.filter((entry) => entry.userKey === project.userKey)).availablePoints, requiredPoints };
    }

    const existing = db.billing.find((entry) => entry.projectId === projectId && entry.type === 'charge') ?? null;
    if (existing) {
      return {
        ok: true as const,
        entry: existing,
        availablePoints: this.getBillingSummaryFromEntries(db.billing.filter((entry) => entry.userKey === project.userKey)).availablePoints,
        requiredPoints
      };
    }

    const summary = this.getBillingSummaryFromEntries(db.billing.filter((entry) => entry.userKey === project.userKey));
    if (summary.availablePoints < requiredPoints) {
      return {
        ok: false as const,
        error: `Insufficient credits. Current balance ${summary.availablePoints}, required ${requiredPoints}.`,
        availablePoints: summary.availablePoints,
        requiredPoints
      };
    }

    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: project.userKey,
      type: 'charge',
      points: requiredPoints,
      amountUsd: Number((requiredPoints * amountUsdPerPoint).toFixed(2)),
      note: `项目处理预扣：${project.name} [${project.id}]`,
      projectId: project.id,
      projectName: project.name,
      createdAt: new Date().toISOString()
    };
    db.billing.unshift(entry);
    this.saveDb(db);
    return { ok: true as const, entry, availablePoints: summary.availablePoints - requiredPoints, requiredPoints };
  }

  reserveProjectRegenerationCredit(projectId: string, amountUsdPerPoint: number) {
    const db = this.loadDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      return {
        ok: false as const,
        error: 'Project not found.',
        charged: false as const,
        free: false as const,
        entry: null,
        availablePoints: 0,
        requiredPoints: 0,
        usage: normalizeProjectRegenerationUsage(undefined)
      };
    }

    const now = new Date().toISOString();
    project.regenerationUsage = normalizeProjectRegenerationUsage(project.regenerationUsage, project.hdrItems);
    if (project.regenerationUsage.freeUsed < project.regenerationUsage.freeLimit) {
      project.regenerationUsage = {
        ...project.regenerationUsage,
        freeUsed: project.regenerationUsage.freeUsed + 1
      };
      project.updatedAt = now;
      this.saveDb(db);
      return {
        ok: true as const,
        charged: false as const,
        free: true as const,
        entry: null,
        availablePoints: this.getBillingSummaryFromEntries(
          db.billing.filter((entry) => entry.userKey === project.userKey)
        ).availablePoints,
        requiredPoints: 0,
        usage: project.regenerationUsage
      };
    }

    const requiredPoints = 1;
    const summary = this.getBillingSummaryFromEntries(db.billing.filter((entry) => entry.userKey === project.userKey));
    if (summary.availablePoints < requiredPoints) {
      return {
        ok: false as const,
        error: `Insufficient credits. Current balance ${summary.availablePoints}, required ${requiredPoints}.`,
        charged: false as const,
        free: false as const,
        entry: null,
        availablePoints: summary.availablePoints,
        requiredPoints,
        usage: project.regenerationUsage
      };
    }

    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: project.userKey,
      type: 'charge',
      points: requiredPoints,
      amountUsd: Number((requiredPoints * amountUsdPerPoint).toFixed(2)),
      note: `图片重新生成：${project.name}`,
      projectId: null,
      projectName: project.name,
      createdAt: now
    };
    db.billing.unshift(entry);
    project.regenerationUsage = {
      ...project.regenerationUsage,
      paidUsed: project.regenerationUsage.paidUsed + 1
    };
    project.updatedAt = now;
    this.saveDb(db);
    return {
      ok: true as const,
      charged: true as const,
      free: false as const,
      entry,
      availablePoints: summary.availablePoints - requiredPoints,
      requiredPoints,
      usage: project.regenerationUsage
    };
  }

  refundProjectRegenerationCredit(
    projectId: string,
    reservation: { charged: boolean; free: boolean; entry: BillingEntry | null }
  ) {
    const db = this.loadDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }

    const now = new Date().toISOString();
    project.regenerationUsage = normalizeProjectRegenerationUsage(project.regenerationUsage, project.hdrItems);
    if (reservation.free) {
      project.regenerationUsage = {
        ...project.regenerationUsage,
        freeUsed: Math.max(0, project.regenerationUsage.freeUsed - 1)
      };
    }

    if (reservation.charged && reservation.entry) {
      const entry: BillingEntry = {
        id: nanoid(12),
        userKey: project.userKey,
        type: 'credit',
        points: reservation.entry.points,
        amountUsd: 0,
        note: `图片重新生成退款：${project.name}`,
        projectId: null,
        projectName: project.name,
        createdAt: now
      };
      db.billing.unshift(entry);
      project.regenerationUsage = {
        ...project.regenerationUsage,
        paidUsed: Math.max(0, project.regenerationUsage.paidUsed - 1)
      };
    }

    project.updatedAt = now;
    this.saveDb(db);
    return project.regenerationUsage;
  }

  settleProjectProcessingCredits(projectId: string, amountUsdPerPoint: number) {
    const db = this.loadDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }

    const desiredNetCharge = Math.max(0, Math.round(project.pointsSpent));
    const projectEntries = db.billing.filter((entry) => entry.projectId === project.id);
    const chargedPoints = projectEntries
      .filter((entry) => entry.type === 'charge')
      .reduce((sum, entry) => sum + entry.points, 0);
    const creditedPoints = projectEntries
      .filter((entry) => entry.type === 'credit')
      .reduce((sum, entry) => sum + entry.points, 0);
    const netChargedPoints = chargedPoints - creditedPoints;
    const delta = desiredNetCharge - netChargedPoints;

    if (delta === 0) {
      return { action: 'unchanged' as const, points: 0 };
    }

    const now = new Date().toISOString();
    if (delta > 0) {
      const entry: BillingEntry = {
        id: nanoid(12),
        userKey: project.userKey,
        type: 'charge',
        points: delta,
        amountUsd: Number((delta * amountUsdPerPoint).toFixed(2)),
        note: `项目处理追加扣费：${project.name} [${project.id}]`,
        projectId: project.id,
        projectName: project.name,
        createdAt: now
      };
      db.billing.unshift(entry);
      this.saveDb(db);
      return { action: 'charged' as const, points: delta, entry };
    }

    const refundPoints = Math.abs(delta);
    const entry: BillingEntry = {
      id: nanoid(12),
      userKey: project.userKey,
      type: 'credit',
      points: refundPoints,
      amountUsd: 0,
      note: `项目处理退款：${project.name} [${project.id}]`,
      projectId: project.id,
      projectName: project.name,
      createdAt: now
    };
    db.billing.unshift(entry);
    this.saveDb(db);
    return { action: 'refunded' as const, points: refundPoints, entry };
  }

  createProjectCharge(projectId: string, amountUsdPerPoint: number) {
    const project = this.getProject(projectId);
    if (!project || project.pointsSpent <= 0) {
      return null;
    }

    const existing = this.getProjectChargeEntry(projectId);
    if (existing) {
      return existing;
    }

    return this.createBillingEntry({
      userKey: project.userKey,
      type: 'charge',
      points: project.pointsSpent,
      amountUsd: project.pointsSpent * amountUsdPerPoint,
      note: `项目处理扣费：${project.name}`,
      projectId: project.id,
      projectName: project.name
    });
  }

  updateProject(projectId: string, updater: (project: ProjectRecord) => ProjectRecord) {
    const db = this.loadDb();
    const index = db.projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      return null;
    }

    const updated = this.recomputeProject({
      ...updater(db.projects[index]!),
      updatedAt: new Date().toISOString()
    });
    db.projects[index] = updated;
    this.saveDb(db);
    return updated;
  }

  deleteProject(projectId: string) {
    const db = this.loadDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }

    const archive = this.storage.trashProjectRoot(project, PROJECT_DELETE_RETENTION_DAYS);
    db.projects = db.projects.filter((item) => item.id !== projectId);
    this.saveDb(db);
    return { project, archive };
  }

  replaceHdrItems(projectId: string, hdrItems: HdrItem[], options: { inputComplete?: boolean } = {}) {
    return this.updateProject(projectId, (project) => {
      const nextHdrItems = hdrItems.map((item, index) => ({ ...item, index: index + 1 }));
      const importedGroup = this.createGroupShape(1, defaultGroupName(1), 'pending');

      for (const hdrItem of nextHdrItems) {
        hdrItem.groupId = importedGroup.id;
        importedGroup.hdrItemIds.push(hdrItem.id);
      }

      project.hdrItems = nextHdrItems;
      project.groups = nextHdrItems.length ? [importedGroup] : [this.createGroupShape(1, defaultGroupName(1), 'pending')];
      const keepActiveUploadState = project.status === 'uploading' || project.status === 'processing';
      if (keepActiveUploadState) {
        project.currentStep = 3;
      } else {
        project.status = nextHdrItems.length ? 'review' : 'draft';
        project.currentStep = nextHdrItems.length ? 2 : 1;
      }
      project.downloadReady = false;
      project.uploadCompletedAt = options.inputComplete ? new Date().toISOString() : null;
      if (!keepActiveUploadState) {
        project.job = createEmptyJobState();
      }
      return project;
    });
  }

  mergeHdrItems(projectId: string, hdrItems: HdrItem[], options: { inputComplete?: boolean } = {}) {
    return this.updateProject(projectId, (project) => {
      const existingByExposureKey = new Map(project.hdrItems.map((item) => [exposureKey(item), item]));
      const mergedItems = [...project.hdrItems];

      for (const incoming of hdrItems) {
        const key = exposureKey(incoming);
        const existing = existingByExposureKey.get(key);
        if (!existing) {
          mergedItems.push(incoming);
          existingByExposureKey.set(key, incoming);
          continue;
        }

        Object.assign(existing, {
          ...incoming,
          id: existing.id,
          index: existing.index,
          title: existing.title || incoming.title,
          groupId: existing.groupId,
          sceneType: existing.sceneType,
          status: existing.status,
          statusText: existing.statusText,
          errorMessage: existing.errorMessage,
          mergedKey: existing.mergedKey,
          mergedPath: existing.mergedPath,
          mergedUrl: existing.mergedUrl,
          resultKey: existing.resultKey,
          resultPath: existing.resultPath,
          resultUrl: existing.resultUrl,
          resultFileName: existing.resultFileName,
          regeneration: existing.regeneration
        });
      }

      const baseGroup = project.groups[0] ?? this.createGroupShape(1, defaultGroupName(1), 'pending');
      baseGroup.hdrItemIds = [];
      project.hdrItems = mergedItems.map((item, index) => {
        item.index = index + 1;
        item.title = `HDR ${index + 1}`;
        item.groupId = baseGroup.id;
        item.sceneType = baseGroup.sceneType;
        baseGroup.hdrItemIds.push(item.id);
        return item;
      });
      project.groups = project.hdrItems.length ? [baseGroup] : [this.createGroupShape(1, defaultGroupName(1), 'pending')];
      if (options.inputComplete) {
        project.uploadCompletedAt = new Date().toISOString();
      }
      project.downloadReady = false;
      if (project.status !== 'processing' && project.status !== 'uploading') {
        project.status = project.hdrItems.length ? 'review' : 'draft';
        project.currentStep = project.hdrItems.length ? 2 : 1;
      }
      return project;
    });
  }

  createGroup(projectId: string) {
    return this.updateProject(projectId, (project) => {
      project.groups.push(
        this.createGroupShape(project.groups.length + 1, defaultGroupName(project.groups.length + 1), 'pending')
      );
      return project;
    });
  }

  updateGroup(projectId: string, groupId: string, input: { sceneType?: SceneType; colorMode?: ColorMode; replacementColor?: string | null }) {
    return this.updateProject(projectId, (project) => {
      const target = project.groups.find((group) => group.id === groupId);
      if (!target) {
        return project;
      }

      target.sceneType = input.sceneType ?? target.sceneType;
      target.colorMode = input.colorMode ?? target.colorMode;
      target.replacementColor =
        target.colorMode === 'replace' ? normalizeHex(input.replacementColor ?? target.replacementColor) : null;
      for (const hdrItem of project.hdrItems.filter((item) => item.groupId === target.id)) {
        hdrItem.sceneType = target.sceneType;
      }
      return project;
    });
  }

  moveHdrItem(projectId: string, hdrItemId: string, targetGroupId: string) {
    return this.updateProject(projectId, (project) => {
      project.groups.forEach((group) => {
        group.hdrItemIds = group.hdrItemIds.filter((id) => id !== hdrItemId);
      });
      const target = project.groups.find((group) => group.id === targetGroupId);
      const hdrItem = project.hdrItems.find((item) => item.id === hdrItemId);
      if (target && hdrItem) {
        target.hdrItemIds.push(hdrItemId);
        hdrItem.groupId = target.id;
        hdrItem.sceneType = target.sceneType;
      }
      project.groups = this.normalizeGroups(project.groups, project.hdrItems);
      return project;
    });
  }

  reorderResultAssets(projectId: string, orderedHdrItemIds: string[]) {
    return this.updateProject(projectId, (project) => {
      const hdrItemsById = new Map(project.hdrItems.map((item) => [item.id, item]));
      const seen = new Set<string>();
      const reordered: HdrItem[] = [];

      for (const hdrItemId of orderedHdrItemIds) {
        const item = hdrItemsById.get(hdrItemId);
        if (!item || seen.has(hdrItemId)) {
          continue;
        }
        reordered.push(item);
        seen.add(hdrItemId);
      }

      for (const item of project.hdrItems) {
        if (seen.has(item.id)) {
          continue;
        }
        reordered.push(item);
      }

      project.hdrItems = reordered;
      return project;
    });
  }

  setHdrExposureSelection(projectId: string, hdrItemId: string, exposureId: string) {
    return this.updateProject(projectId, (project) => {
      const item = project.hdrItems.find((hdrItem) => hdrItem.id === hdrItemId);
      if (!item || !item.exposures.some((exposure) => exposure.id === exposureId)) {
        return project;
      }

      item.selectedExposureId = exposureId;
      const selected = item.exposures.find((exposure) => exposure.id === exposureId) ?? item.exposures[0] ?? null;
      item.previewUrl = selected?.previewUrl ?? item.previewUrl;
      return project;
    });
  }

  deleteHdrItem(projectId: string, hdrItemId: string) {
    return this.updateProject(projectId, (project) => {
      const target = project.hdrItems.find((item) => item.id === hdrItemId);
      if (!target) {
        return project;
      }

      const filesToTrash: TrashFileInput[] = [];
      for (const exposure of target.exposures) {
        filesToTrash.push({
          absolutePath: exposure.storagePath,
          category: 'originals',
          retentionDays: DELETED_SOURCE_RETENTION_DAYS,
          label: exposure.originalName || exposure.fileName
        });
        filesToTrash.push({
          absolutePath: exposure.previewPath,
          category: 'previews',
          retentionDays: DELETED_SOURCE_RETENTION_DAYS,
          label: `${exposure.originalName || exposure.fileName} preview`
        });
      }
      filesToTrash.push({
        absolutePath: target.mergedPath,
        category: 'hdr',
        retentionDays: DELETED_SOURCE_RETENTION_DAYS,
        label: `${target.title} HDR`
      });
      filesToTrash.push({
        absolutePath: target.resultPath,
        category: 'results',
        retentionDays: DELETED_RESULT_RETENTION_DAYS,
        label: target.resultFileName ?? `${target.title} result`
      });
      this.storage.trashFiles(project, filesToTrash, `hdr-item-${hdrItemId}`);

      project.hdrItems = project.hdrItems.filter((item) => item.id !== hdrItemId);
      project.groups.forEach((group) => {
        group.hdrItemIds = group.hdrItemIds.filter((id) => id !== hdrItemId);
      });
      project.groups = this.normalizeGroups(project.groups, project.hdrItems);
      if (!project.hdrItems.length) {
        project.status = 'draft';
        project.currentStep = 1;
        project.job = createEmptyJobState();
      }
      return project;
    });
  }

  setJobState(projectId: string, updater: (job: ProjectJobState) => ProjectJobState) {
    return this.updateProject(projectId, (project) => {
      project.job = normalizeProjectJobState(updater(normalizeProjectJobState(project.job)));
      return project;
    });
  }

  setHdrItemState(projectId: string, hdrItemId: string, updater: (item: HdrItem) => HdrItem) {
    return this.updateProject(projectId, (project) => {
      project.hdrItems = project.hdrItems.map((item) => (item.id === hdrItemId ? updater(item) : item));
      return project;
    });
  }

  recomputeProject(project: ProjectRecord) {
    project = this.normalizeProjectStorageDescriptors(project);
    project.uploadCompletedAt ??= null;
    project.groups = this.normalizeGroups(project.groups, project.hdrItems);
    project.hdrItems = project.hdrItems.map((item, index) => ({
      ...item,
      index: index + 1,
      title: item.title || `HDR ${index + 1}`,
      workflow: normalizeWorkflowState(item.workflow),
      regeneration: {
        ...createEmptyRegenerationState(),
        ...(item.regeneration ?? {})
      }
    }));
    project.regenerationUsage = normalizeProjectRegenerationUsage(project.regenerationUsage, project.hdrItems);
    project.photoCount = project.hdrItems.reduce((sum, item) => sum + item.exposures.length, 0);
    project.groupCount = project.groups.length;
    project.pointsPerPhoto = Math.max(0, Math.round(Number(project.pointsPerPhoto ?? 1) || 1));
    project.pointsEstimate = project.hdrItems.length * project.pointsPerPhoto;
    project.resultAssets = this.deriveResultAssets(project);
    project.downloadReady = project.resultAssets.length > 0 && project.status === 'completed';
    project.job = normalizeProjectJobState(project.job);
    return project;
  }

  private deriveResultAssets(project: ProjectRecord): ResultAsset[] {
    return project.hdrItems
      .filter((item) => item.resultUrl && item.resultPath && item.resultFileName)
      .map((item, index) => ({
        id: `result-${item.id}`,
        hdrItemId: item.id,
        fileName: item.resultFileName as string,
        storageKey: item.resultKey ?? this.deriveStorageKey(item.resultPath) ?? undefined,
        storagePath: item.resultPath as string,
        storageUrl: item.resultUrl as string,
        previewUrl: item.resultUrl,
        sortOrder: index,
        regeneration: item.regeneration
      }));
  }

  private normalizeProjectStorageDescriptors(project: ProjectRecord) {
    project.hdrItems = project.hdrItems.map((item) => {
      const exposures = item.exposures.map((exposure) => {
        const storageKey = exposure.storageKey ?? this.deriveStorageKey(exposure.storagePath);
        const previewKey =
          exposure.previewPath !== null
            ? exposure.previewKey !== undefined
              ? exposure.previewKey
              : this.deriveStorageKey(exposure.previewPath)
            : null;
        return {
          ...exposure,
          storageKey: storageKey ?? undefined,
          storageUrl: storageKey ? this.toStorageUrlFromKey(storageKey) : exposure.storageUrl,
          previewKey,
          previewUrl: previewKey ? this.toStorageUrlFromKey(previewKey) : exposure.previewUrl
        };
      });

      const mergedKey = item.mergedPath !== null ? item.mergedKey ?? this.deriveStorageKey(item.mergedPath) : null;
      const resultKey = item.resultPath !== null ? item.resultKey ?? this.deriveStorageKey(item.resultPath) : null;

      return {
        ...item,
        exposures,
        mergedKey,
        mergedUrl: mergedKey ? this.toStorageUrlFromKey(mergedKey) : item.mergedUrl,
        resultKey,
        resultUrl: resultKey ? this.toStorageUrlFromKey(resultKey) : item.resultUrl
      };
    });

    return project;
  }

  private deriveStorageKey(absolutePath: string | null) {
    if (!absolutePath) {
      return null;
    }

    try {
      return this.toStorageKey(absolutePath);
    } catch {
      return null;
    }
  }

  private ensureUniqueUserKey(users: UserRecord[], base: string) {
    const normalizedBase = sanitizeSegment(base) || 'user';
    let candidate = normalizedBase;
    let suffix = 2;
    while (users.some((user) => user.userKey === candidate)) {
      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private isSessionExpired(session: SessionRecord) {
    const expiresAt = Date.parse(session.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  }

  private isPasswordResetTokenExpired(token: PasswordResetTokenRecord) {
    const expiresAt = Date.parse(token.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  }

  private isEmailVerificationTokenExpired(token: EmailVerificationTokenRecord) {
    const expiresAt = Date.parse(token.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  }

  private buildGroupTemplateMap(project: ProjectRecord) {
    const templates = new Map<string, GroupTemplate>();
    for (const hdrItem of project.hdrItems) {
      const group = project.groups.find((item) => item.id === hdrItem.groupId);
      if (!group) {
        continue;
      }

      templates.set(exposureKey(hdrItem), {
        sceneType: group.sceneType,
        colorMode: group.colorMode,
        replacementColor: group.replacementColor,
        name: group.name
      });
    }
    return templates;
  }

  private createGroupShape(
    index: number,
    name: string,
    sceneType: SceneType,
    colorMode: ColorMode = 'default',
    replacementColor: string | null = null
  ): ProjectGroup {
    return {
      id: nanoid(8),
      index,
      name,
      sceneType,
      colorMode,
      replacementColor: normalizeHex(replacementColor),
      hdrItemIds: []
    };
  }

  private normalizeGroups(groups: ProjectGroup[], hdrItems: HdrItem[]) {
    const validHdrIds = new Set(hdrItems.map((item) => item.id));
    const kept = groups
      .map((group) => ({
        ...group,
        hdrItemIds: group.hdrItemIds.filter((hdrItemId) => validHdrIds.has(hdrItemId))
      }))
      .filter((group) => group.hdrItemIds.length > 0);

    if (!kept.length) {
      return [this.createGroupShape(1, defaultGroupName(1), 'pending')];
    }

    return kept.map((group, index) => ({
      ...group,
      index: index + 1,
      name: group.name || defaultGroupName(index + 1)
    }));
  }
}
