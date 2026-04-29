import fs from 'node:fs';
import { nanoid } from 'nanoid';
import {
  assertProjectDownloadAssetsReady,
  buildProjectDownloadArchive,
  type ProjectDownloadOptions
} from './downloads.js';
import { createObjectDownloadUrl, uploadFileToObjectStorage } from './object-storage.js';
import type { ProjectRecord } from './types.js';

type DownloadJobStatus = 'queued' | 'preflight' | 'packaging' | 'uploading' | 'ready' | 'failed' | 'cancelled';

interface DownloadJob {
  jobId: string;
  requestKey: string;
  projectId: string;
  userKey: string;
  project: ProjectRecord;
  options: ProjectDownloadOptions;
  status: DownloadJobStatus;
  progress: number;
  createdAt: number;
  completedAt: number | null;
  downloadUrl: string | null;
  expiresAt: number | null;
  error: string | null;
}

const JOB_RETENTION_MS = 5 * 60 * 1000;
const DOWNLOAD_URL_TTL_SECONDS = 6 * 60 * 60;
const jobs = new Map<string, DownloadJob>();
const activeByRequest = new Map<string, string>();
const queue: DownloadJob[] = [];
let workerRunning = false;

function getRequestKey(projectId: string, options: ProjectDownloadOptions) {
  return `${projectId}:${JSON.stringify(options)}`;
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

function publicJob(job: DownloadJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.status === 'ready' ? job.downloadUrl : null,
    expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
    error: job.error
  };
}

function startWorker() {
  if (workerRunning) {
    return;
  }
  workerRunning = true;
  void runWorker().finally(() => {
    workerRunning = false;
    if (queue.length) {
      startWorker();
    }
  });
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
      await assertProjectDownloadAssetsReady(job.project);
      if (isJobCancelled(job)) continue;

      job.status = 'packaging';
      job.progress = 35;
      const archive = await buildProjectDownloadArchive(job.project, job.options);
      archivePath = archive.zipPath;
      if (isJobCancelled(job)) {
        continue;
      }

      job.status = 'uploading';
      job.progress = 75;
      const storageKey = `downloads/${job.userKey}/${job.projectId}/${job.jobId}.zip`;
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
    } catch (error) {
      job.status = 'failed';
      job.progress = 100;
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Date.now();
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
  const requestKey = getRequestKey(input.project.id, input.options);
  const reused = getReusableJob(requestKey);
  if (reused) {
    return { job: publicJob(reused), reused: true };
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
    downloadUrl: null,
    expiresAt: null,
    error: null
  };
  jobs.set(job.jobId, job);
  activeByRequest.set(job.requestKey, job.jobId);
  queue.push(job);
  startWorker();
  return { job: publicJob(job), reused: false };
}

export function getDownloadJob(projectId: string, jobId: string, userKey: string) {
  const job = jobs.get(jobId);
  if (!job || job.projectId !== projectId || job.userKey !== userKey) {
    return null;
  }
  return publicJob(job);
}

export function cancelDownloadJob(projectId: string, jobId: string, userKey: string) {
  const job = jobs.get(jobId);
  if (!job || job.projectId !== projectId || job.userKey !== userKey) {
    return false;
  }
  if (job.status !== 'ready' && job.status !== 'failed') {
    job.status = 'cancelled';
    job.error = 'Download cancelled.';
    job.completedAt = Date.now();
  }
  return true;
}
