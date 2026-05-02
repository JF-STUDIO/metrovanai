import fs from 'node:fs';
import { nanoid } from 'nanoid';
import {
  assertProjectDownloadAssetsReady,
  buildProjectDownloadArchive,
  type ProjectDownloadOptions
} from './downloads.js';
import { createObjectDownloadUrl, uploadFileToObjectStorage } from './object-storage.js';
import type { ProjectDownloadJobRecord, ProjectDownloadJobStatus, ProjectRecord } from './types.js';

interface DownloadJobStore {
  getProjectDownloadJob(projectId: string, jobId: string, userKey: string): ProjectDownloadJobRecord | null;
  findReusableProjectDownloadJob(
    projectId: string,
    userKey: string,
    requestKey: string,
    retentionMs: number
  ): ProjectDownloadJobRecord | null;
  upsertProjectDownloadJob(job: ProjectDownloadJobRecord): ProjectDownloadJobRecord;
  markInterruptedDownloadJobsFailed(message: string): number;
}

interface DownloadJob {
  jobId: string;
  requestKey: string;
  projectId: string;
  userKey: string;
  project: ProjectRecord;
  options: ProjectDownloadOptions;
  status: ProjectDownloadJobStatus;
  progress: number;
  createdAt: number;
  completedAt: number | null;
  downloadKey: string | null;
  downloadUrl: string | null;
  expiresAt: number | null;
  error: string | null;
}

const JOB_RETENTION_MS = 5 * 60 * 1000;
const DOWNLOAD_URL_TTL_SECONDS = 6 * 60 * 60;
const MAX_DOWNLOAD_JOB_WORKERS = Math.max(
  1,
  Math.round(Number(process.env.METROVAN_DOWNLOAD_JOB_WORKERS ?? 3) || 3)
);
const jobs = new Map<string, DownloadJob>();
const activeByRequest = new Map<string, string>();
const queue: DownloadJob[] = [];
let jobStore: DownloadJobStore | null = null;
let activeWorkers = 0;

export function configureDownloadJobs(store: DownloadJobStore) {
  jobStore = store;
}

export function getDownloadJobStats() {
  const statuses = new Map<ProjectDownloadJobStatus, number>();
  for (const job of jobs.values()) {
    statuses.set(job.status, (statuses.get(job.status) ?? 0) + 1);
  }

  return {
    maxWorkers: MAX_DOWNLOAD_JOB_WORKERS,
    activeWorkers,
    queued: queue.filter((job) => job.status === 'queued').length,
    inMemoryJobs: jobs.size,
    activeRequests: activeByRequest.size,
    statuses: Object.fromEntries(statuses.entries())
  };
}

export function recoverInterruptedDownloadJobsAfterRestart() {
  return jobStore?.markInterruptedDownloadJobsFailed('Server restarted before download completion.') ?? 0;
}

function getProjectDownloadFingerprint(project: ProjectRecord) {
  const resultSignature = [...project.resultAssets]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((asset) => [asset.id, asset.fileName, asset.storageKey ?? '', asset.storageUrl, asset.sortOrder].join(':'))
    .join('|');
  return `${project.updatedAt}:${project.resultAssets.length}:${resultSignature}`;
}

function getRequestKey(project: ProjectRecord, options: ProjectDownloadOptions) {
  return `${project.id}:${getProjectDownloadFingerprint(project)}:${JSON.stringify(options)}`;
}

function getReusableJob(requestKey: string) {
  const existingId = activeByRequest.get(requestKey);
  const existing = existingId ? jobs.get(existingId) ?? null : null;
  if (!existing) {
    return null;
  }
  if (!['ready', 'failed', 'cancelled'].includes(existing.status)) {
    return existing;
  }
  if (existing.status === 'ready' && existing.completedAt && Date.now() - existing.completedAt < JOB_RETENTION_MS) {
    return existing;
  }
  activeByRequest.delete(requestKey);
  return null;
}

function publicJob(job: DownloadJob | ProjectDownloadJobRecord) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.status === 'ready' ? job.downloadUrl : null,
    expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
    error: job.error
  };
}

function logJobEvent(event: 'created' | 'reused', job: DownloadJob | ProjectDownloadJobRecord) {
  console.log(`[download-job] ${event}: project=${job.projectId} job=${job.jobId} status=${job.status}`);
}

function persistJob(job: DownloadJob) {
  jobStore?.upsertProjectDownloadJob({
    jobId: job.jobId,
    requestKey: job.requestKey,
    projectId: job.projectId,
    userKey: job.userKey,
    options: job.options,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    downloadKey: job.downloadKey,
    downloadUrl: job.downloadUrl,
    expiresAt: job.expiresAt,
    error: job.error
  });
}

function persistRecord(job: ProjectDownloadJobRecord) {
  jobStore?.upsertProjectDownloadJob(job);
}

function startWorker() {
  const availableWorkers = Math.max(0, MAX_DOWNLOAD_JOB_WORKERS - activeWorkers);
  const workersToStart = Math.min(availableWorkers, queue.length);
  for (let index = 0; index < workersToStart; index += 1) {
    activeWorkers += 1;
    void runWorker().finally(() => {
      activeWorkers -= 1;
      if (queue.length) {
        startWorker();
      }
    });
  }
}

function isJobCancelled(job: DownloadJob) {
  return job.status === 'cancelled';
}

async function runWorker() {
  while (queue.length) {
    const job = queue.shift();
    if (!job || isJobCancelled(job)) {
      continue;
    }
    let archivePath: string | null = null;
    try {
      job.status = 'preflight';
      job.progress = 8;
      persistJob(job);
      await assertProjectDownloadAssetsReady(job.project);
      if (isJobCancelled(job)) continue;

      job.status = 'packaging';
      job.progress = 35;
      persistJob(job);
      const archive = await buildProjectDownloadArchive(job.project, job.options);
      archivePath = archive.zipPath;
      if (isJobCancelled(job)) {
        continue;
      }

      job.status = 'uploading';
      job.progress = 75;
      const storageKey = `downloads/${job.userKey}/${job.projectId}/${job.jobId}.zip`;
      job.downloadKey = storageKey;
      persistJob(job);
      await uploadFileToObjectStorage({
        sourcePath: archive.zipPath,
        storageKey,
        contentType: 'application/zip'
      });
      fs.rmSync(archivePath, { force: true });
      archivePath = null;
      if (isJobCancelled(job)) {
        continue;
      }

      job.downloadUrl = createObjectDownloadUrl(storageKey, DOWNLOAD_URL_TTL_SECONDS);
      job.expiresAt = Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000;
      job.status = 'ready';
      job.progress = 100;
      job.completedAt = Date.now();
      persistJob(job);
    } catch (error) {
      job.status = 'failed';
      job.progress = 100;
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Date.now();
      persistJob(job);
    } finally {
      if (archivePath) {
        fs.rmSync(archivePath, { force: true });
      }
    }
  }
}

export function enqueueDownloadJob(input: {
  project: ProjectRecord;
  userKey: string;
  options: ProjectDownloadOptions;
}) {
  const requestKey = getRequestKey(input.project, input.options);
  const reused = getReusableJob(requestKey);
  if (reused) {
    logJobEvent('reused', reused);
    return { job: publicJob(reused), reused: true };
  }
  const persisted = jobStore?.findReusableProjectDownloadJob(input.project.id, input.userKey, requestKey, JOB_RETENTION_MS) ?? null;
  if (persisted) {
    logJobEvent('reused', persisted);
    return { job: publicJob(persisted), reused: true };
  }

  const job: DownloadJob = {
    jobId: nanoid(12),
    requestKey,
    projectId: input.project.id,
    userKey: input.userKey,
    project: input.project,
    options: input.options,
    status: 'queued',
    progress: 1,
    createdAt: Date.now(),
    completedAt: null,
    downloadKey: null,
    downloadUrl: null,
    expiresAt: null,
    error: null
  };
  jobs.set(job.jobId, job);
  activeByRequest.set(job.requestKey, job.jobId);
  persistJob(job);
  logJobEvent('created', job);
  queue.push(job);
  startWorker();
  return { job: publicJob(job), reused: false };
}

export function getDownloadJob(projectId: string, jobId: string, userKey: string) {
  const job = jobs.get(jobId);
  if (!job || job.projectId !== projectId || job.userKey !== userKey) {
    const persisted = jobStore?.getProjectDownloadJob(projectId, jobId, userKey) ?? null;
    return persisted ? publicJob(persisted) : null;
  }
  return publicJob(job);
}

export function cancelDownloadJob(projectId: string, jobId: string, userKey: string) {
  const job = jobs.get(jobId);
  if (!job || job.projectId !== projectId || job.userKey !== userKey) {
    const persisted = jobStore?.getProjectDownloadJob(projectId, jobId, userKey) ?? null;
    if (!persisted) {
      return false;
    }
    if (persisted.status !== 'ready' && persisted.status !== 'failed') {
      persistRecord({
        ...persisted,
        status: 'cancelled',
        error: 'Download cancelled.',
        completedAt: Date.now()
      });
    }
    return true;
  }
  if (job.status !== 'ready' && job.status !== 'failed') {
    job.status = 'cancelled';
    job.error = 'Download cancelled.';
    job.completedAt = Date.now();
    persistJob(job);
  }
  return true;
}
