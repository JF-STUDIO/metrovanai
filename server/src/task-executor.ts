import fs from 'node:fs';
import path from 'node:path';
import type { HdrItem, ProjectRecord } from './types.js';
import type { LocalStore } from './store.js';
import { normalizeHex, sanitizeSegment } from './utils.js';
import { estimateReferenceWhiteBalanceGains, extractPreviewOrConvertToJpeg, fuseToJpeg } from './images.js';
import { RunningHubClient } from './runninghub.js';
import { buildRunningHubNodeInfoList, loadWorkflowConfig, resolveWorkflowRoute } from './workflows.js';

export interface TaskExecutionProviderInfo {
  provider: string;
  workflowEngine: string;
}

export interface WorkflowExecutionProgress {
  monitorState: string;
  detail: string;
  remoteProgress: number;
  queuePosition: number;
  workflowName: string;
  taskId: string;
}

export interface MergedHdrArtifact {
  mergedPath: string;
  mergedFileName: string;
}

export interface WorkflowExecutionArtifact {
  resultPath: string;
  resultFileName: string;
}

export interface WorkflowExecutionOptions {
  mode?: 'default' | 'regenerate';
  colorCardNo?: string | null;
  outputSuffix?: string | null;
}

export interface TaskExecutionRunContext {
  getMergeConcurrency(totalPendingItems: number): number;
  getMaxConcurrency(totalPendingItems: number): number;
  ensureMergedHdrItem(project: ProjectRecord, hdrItem: HdrItem, hdrDir: string): Promise<MergedHdrArtifact>;
  executeWorkflowTask(
    project: ProjectRecord,
    hdrItem: HdrItem,
    mergedPath: string,
    mergedFileName: string,
    onProgress?: (update: WorkflowExecutionProgress) => void,
    options?: WorkflowExecutionOptions
  ): Promise<WorkflowExecutionArtifact>;
}

export interface TaskExecutionProvider {
  getInfo(): TaskExecutionProviderInfo;
  createRunContext(): TaskExecutionRunContext;
}

interface RemoteHttpTaskExecutorConfig {
  baseUrl: string;
  token: string;
  pollMs: number;
  timeoutSeconds: number;
  maxInFlight: number;
}

interface RemoteHttpJobCreateResponse {
  jobId: string;
  status?: string;
  detail?: string;
}

interface RemoteHttpJobResultPayload {
  downloadUrl?: string;
  base64Data?: string;
  fileName?: string;
}

interface RemoteHttpJobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  detail?: string;
  queuePosition?: number;
  workflowName?: string;
  result?: RemoteHttpJobResultPayload;
}

function parsePositiveIntEnv(rawValue: string | undefined, fallback: number) {
  const parsed = Number(rawValue ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function buildWorkflowResultTargetPath(
  store: LocalStore,
  project: ProjectRecord,
  mergedFileName: string,
  options?: WorkflowExecutionOptions
) {
  const baseName = path.basename(mergedFileName, path.extname(mergedFileName));
  const suffix = sanitizeSegment(options?.outputSuffix ?? '');
  const fileName = `${baseName}${suffix ? `_${suffix}` : ''}.jpg`;
  return path.join(store.getProjectDirectories(project).results, fileName);
}

function resolveLocalMergeMaxInFlight() {
  return parsePositiveIntEnv(process.env.METROVAN_LOCAL_MERGE_MAX_IN_FLIGHT, 2);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveRemoteHttpTaskExecutorConfig(): RemoteHttpTaskExecutorConfig {
  const baseUrl = trimTrailingSlash(String(process.env.METROVAN_REMOTE_EXECUTOR_URL ?? '').trim());
  if (!baseUrl) {
    throw new Error('METROVAN_REMOTE_EXECUTOR_URL is required when task executor is runpod-http.');
  }

  return {
    baseUrl,
    token: String(process.env.METROVAN_REMOTE_EXECUTOR_TOKEN ?? '').trim(),
    pollMs: parsePositiveIntEnv(process.env.METROVAN_REMOTE_EXECUTOR_POLL_MS, 2500),
    timeoutSeconds: parsePositiveIntEnv(process.env.METROVAN_REMOTE_EXECUTOR_TIMEOUT_SECONDS, 1800),
    maxInFlight: parsePositiveIntEnv(process.env.METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT, 2)
  };
}

async function readRemoteJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const rawText = await response.text();
  let parsed: unknown = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
        ? parsed.error
        : rawText || fallbackMessage;
    throw new Error(message);
  }

  return (parsed ?? {}) as T;
}

function createLocalHdrMergeContext(store: LocalStore) {
  const whiteBalanceGainCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof estimateReferenceWhiteBalanceGains>>>
  >();

  const estimateGroupWhiteBalanceGains = async (project: ProjectRecord, groupId: string) => {
    const group = project.groups.find((entry) => entry.id === groupId);
    if (!group) {
      return null;
    }

    const orderedGroupItems = group.hdrItemIds
      .map((hdrItemId) => project.hdrItems.find((item) => item.id === hdrItemId))
      .filter((item): item is HdrItem => Boolean(item))
      .sort((left, right) => left.index - right.index);

    const referenceItem =
      orderedGroupItems.find((item) => item.exposures.some((exposure) => exposure.isRaw)) ??
      orderedGroupItems[0] ??
      null;
    if (!referenceItem) {
      return null;
    }

    try {
      return await estimateReferenceWhiteBalanceGains(
        referenceItem.exposures.map((exposure) => ({
          path: exposure.storagePath,
          exposureCompensation: exposure.exposureCompensation,
          isRaw: exposure.isRaw
        }))
      );
    } catch (error) {
      console.warn(
        `[white-balance] group reference estimation failed for ${group.name || group.id}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  };

  const getGroupWhiteBalanceGains = async (project: ProjectRecord, hdrItem: HdrItem) => {
    const groupId = hdrItem.groupId;
    if (!groupId) {
      return null;
    }

    if (!whiteBalanceGainCache.has(groupId)) {
      whiteBalanceGainCache.set(groupId, estimateGroupWhiteBalanceGains(project, groupId));
    }

    return await whiteBalanceGainCache.get(groupId)!;
  };

  const ensureMergedHdrItem = async (project: ProjectRecord, hdrItem: HdrItem, hdrDir: string) => {
    if (hdrItem.mergedPath && fs.existsSync(hdrItem.mergedPath)) {
      return {
        mergedPath: hdrItem.mergedPath,
        mergedFileName: path.basename(hdrItem.mergedPath)
      };
    }

    const selectedExposure =
      hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0];
    const mergedFileName = `${path.basename(
      selectedExposure?.originalName ?? hdrItem.title,
      path.extname(selectedExposure?.originalName ?? '')
    )}.jpg`;
    const mergedPath = path.join(hdrDir, mergedFileName);
    const whiteBalanceGains = await getGroupWhiteBalanceGains(project, hdrItem);
    await fuseToJpeg(
      hdrItem.exposures.map((exposure) => ({
        path: exposure.storagePath,
        exposureCompensation: exposure.exposureCompensation,
        isRaw: exposure.isRaw
      })),
      mergedPath,
      95,
      {
        whiteBalanceGains,
        disableToneAdjustments: true,
        fastPreprocess: true
      }
    );

    return {
      mergedPath,
      mergedFileName
    };
  };

  return {
    ensureMergedHdrItem
  };
}

class LocalRunningHubTaskExecutionProvider implements TaskExecutionProvider {
  constructor(
    private readonly repoRoot: string,
    private readonly store: LocalStore
  ) {}

  getInfo(): TaskExecutionProviderInfo {
    return {
      provider: 'local-runninghub',
      workflowEngine: 'runninghub'
    };
  }

  createRunContext(): TaskExecutionRunContext {
    const workflowConfig = loadWorkflowConfig(this.repoRoot);
    const runningHub = new RunningHubClient();
    const localMerge = createLocalHdrMergeContext(this.store);

    const executeWorkflowTask = async (
      project: ProjectRecord,
      hdrItem: HdrItem,
      mergedPath: string,
      mergedFileName: string,
      onProgress?: (update: WorkflowExecutionProgress) => void,
      options?: WorkflowExecutionOptions
    ) => {
      const group = project.groups.find((entry) => entry.id === hdrItem.groupId);
      if (!group) {
        throw new Error(`Missing project group for HDR item ${hdrItem.id}.`);
      }

      const route = resolveWorkflowRoute(workflowConfig, group, {
        mode: options?.mode ?? 'default',
        colorCardNo: options?.colorCardNo ?? null
      });
      const normalizedPrompt = normalizeHex(route.promptText);
      const upload = await runningHub.uploadFile(workflowConfig.apiKey, mergedPath, 'input');
      const nodeInfoList = buildRunningHubNodeInfoList(route.workflow, upload, normalizedPrompt);
      const taskId = await runningHub.createTask(
        workflowConfig.apiKey,
        route.workflow.workflowId ?? '',
        nodeInfoList,
        route.workflow.instanceType ?? 'plus'
      );

      onProgress?.({
        monitorState: 'submitted',
        detail: `task ${taskId} submitted`,
        remoteProgress: 0,
        queuePosition: 0,
        workflowName: route.workflow.name,
        taskId
      });

      const outputs = await runningHub.waitTask(
        workflowConfig.apiKey,
        taskId,
        (update) => {
          onProgress?.({
            monitorState: update.monitorState,
            detail: update.detail,
            remoteProgress: update.remoteProgress,
            queuePosition: update.queuePosition,
            workflowName: route.workflow.name,
            taskId
          });
        },
        3600
      );

      const outputUrl = outputs.fileUrls[0];
      if (!outputUrl) {
        throw new Error('RunningHub result is missing output URL.');
      }

      const tempDownloadPath = path.join(
        process.env.TEMP ?? process.cwd(),
        'metrovan_downloads',
        `${taskId}${path.extname(outputUrl.split('?')[0] ?? '.png') || '.png'}`
      );
      await runningHub.downloadFile(outputUrl, tempDownloadPath);

      const resultPath = buildWorkflowResultTargetPath(this.store, project, mergedFileName, options);
      await extractPreviewOrConvertToJpeg(tempDownloadPath, resultPath, 95);
      try {
        fs.rmSync(tempDownloadPath, { force: true });
      } catch {
        // ignore
      }

      return {
        resultPath,
        resultFileName: path.basename(resultPath)
      };
    };

    return {
      getMergeConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(resolveLocalMergeMaxInFlight(), totalPendingItems));
      },
      getMaxConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(workflowConfig.settings.workflowMaxInFlight || 40, totalPendingItems));
      },
      ensureMergedHdrItem: localMerge.ensureMergedHdrItem,
      executeWorkflowTask
    };
  }
}

class RemoteHttpTaskExecutionProvider implements TaskExecutionProvider {
  constructor(private readonly store: LocalStore) {}

  getInfo(): TaskExecutionProviderInfo {
    return {
      provider: 'runpod-http',
      workflowEngine: 'remote-http'
    };
  }

  createRunContext(): TaskExecutionRunContext {
    const config = resolveRemoteHttpTaskExecutorConfig();
    const localMerge = createLocalHdrMergeContext(this.store);

    const createHeaders = () => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      if (config.token) {
        headers.set('Authorization', `Bearer ${config.token}`);
      }
      return headers;
    };

    const executeWorkflowTask = async (
      project: ProjectRecord,
      hdrItem: HdrItem,
      mergedPath: string,
      mergedFileName: string,
      onProgress?: (update: WorkflowExecutionProgress) => void,
      options?: WorkflowExecutionOptions
    ) => {
      const group = project.groups.find((entry) => entry.id === hdrItem.groupId);
      if (!group) {
        throw new Error(`Missing project group for HDR item ${hdrItem.id}.`);
      }

      const mergedBuffer = fs.readFileSync(mergedPath);
      const createResponse = await fetch(`${config.baseUrl}/jobs`, {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify({
          projectId: project.id,
          hdrItemId: hdrItem.id,
          title: hdrItem.title,
          sceneType: group.sceneType,
          colorMode: group.colorMode,
          replacementColor: normalizeHex(group.replacementColor),
          workflowMode: options?.mode ?? 'default',
          colorCardNo: options?.colorCardNo ?? null,
          inputFileName: mergedFileName,
          inputMimeType: 'image/jpeg',
          inputImageBase64: mergedBuffer.toString('base64')
        })
      });
      const created = await readRemoteJson<RemoteHttpJobCreateResponse>(
        createResponse,
        'Remote executor job submission failed.'
      );

      if (!created.jobId) {
        throw new Error('Remote executor did not return a job id.');
      }

      onProgress?.({
        monitorState: created.status ?? 'submitted',
        detail: created.detail ?? `remote job ${created.jobId} submitted`,
        remoteProgress: 0,
        queuePosition: 0,
        workflowName: 'runpod-http',
        taskId: created.jobId
      });

      const deadline = Date.now() + config.timeoutSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, config.pollMs));

        const statusResponse = await fetch(`${config.baseUrl}/jobs/${encodeURIComponent(created.jobId)}`, {
          headers: createHeaders()
        });
        const statusPayload = await readRemoteJson<RemoteHttpJobStatusResponse>(
          statusResponse,
          'Remote executor status check failed.'
        );

        const remoteProgress = Math.max(0, Math.min(100, Math.round(statusPayload.progress ?? 0)));
        onProgress?.({
          monitorState: statusPayload.status,
          detail: statusPayload.detail ?? `remote job ${created.jobId} ${statusPayload.status}`,
          remoteProgress,
          queuePosition: Math.max(0, Math.round(statusPayload.queuePosition ?? 0)),
          workflowName: statusPayload.workflowName ?? 'runpod-http',
          taskId: created.jobId
        });

        if (statusPayload.status === 'failed') {
          throw new Error(statusPayload.detail || `Remote executor job ${created.jobId} failed.`);
        }

        if (statusPayload.status !== 'completed') {
          continue;
        }

        const result = statusPayload.result;
        if (!result?.downloadUrl && !result?.base64Data) {
          throw new Error('Remote executor completed without returning a result artifact.');
        }

        let outputBuffer: Buffer;
        let outputExtension = path.extname(result.fileName ?? '');

        if (result.base64Data) {
          outputBuffer = Buffer.from(result.base64Data, 'base64');
        } else {
          const downloadResponse = await fetch(result.downloadUrl as string, {
            headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined
          });
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download remote result (${downloadResponse.status}).`);
          }
          outputBuffer = Buffer.from(await downloadResponse.arrayBuffer());
          if (!outputExtension) {
            outputExtension = path.extname(new URL(result.downloadUrl as string).pathname);
          }
        }

        const tempDownloadPath = path.join(
          process.env.TEMP ?? process.cwd(),
          'metrovan_remote_results',
          `${created.jobId}${outputExtension || '.png'}`
        );
        fs.mkdirSync(path.dirname(tempDownloadPath), { recursive: true });
        fs.writeFileSync(tempDownloadPath, outputBuffer);

        const resultPath = buildWorkflowResultTargetPath(this.store, project, mergedFileName, options);
        await extractPreviewOrConvertToJpeg(tempDownloadPath, resultPath, 95);
        try {
          fs.rmSync(tempDownloadPath, { force: true });
        } catch {
          // ignore
        }

        return {
          resultPath,
          resultFileName: path.basename(resultPath)
        };
      }

      throw new Error(`Remote executor timed out after ${config.timeoutSeconds} seconds.`);
    };

    return {
      getMergeConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(resolveLocalMergeMaxInFlight(), totalPendingItems));
      },
      getMaxConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(config.maxInFlight, totalPendingItems));
      },
      ensureMergedHdrItem: localMerge.ensureMergedHdrItem,
      executeWorkflowTask
    };
  }
}

export function createTaskExecutionProvider(
  provider: string | undefined,
  options: { repoRoot: string; store: LocalStore }
): TaskExecutionProvider {
  const normalizedProvider = (provider ?? 'local-runninghub').trim().toLowerCase();
  if (normalizedProvider === 'local-runninghub') {
    return new LocalRunningHubTaskExecutionProvider(options.repoRoot, options.store);
  }

  if (normalizedProvider === 'runpod-http' || normalizedProvider === 'remote-http') {
    return new RemoteHttpTaskExecutionProvider(options.store);
  }

  throw new Error(`Unsupported task execution provider: ${provider}`);
}
