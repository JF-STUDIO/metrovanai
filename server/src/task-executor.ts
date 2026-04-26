import fs from 'node:fs';
import path from 'node:path';
import type { HdrItem, ProjectRecord } from './types.js';
import type { LocalStore } from './store.js';
import { normalizeHex, sanitizeSegment } from './utils.js';
import { estimateReferenceWhiteBalanceGains, extractPreviewOrConvertToJpeg, fuseToJpeg } from './images.js';
import {
  createObjectDownloadUrl,
  createPersistentObjectKey,
  isObjectStorageConfigured,
  mirrorLocalFileToObjectStorage
} from './object-storage.js';
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
  mergedStorageKey?: string | null;
}

export interface WorkflowExecutionArtifact {
  resultPath: string;
  resultFileName: string;
  resultStorageKey?: string | null;
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
  storageKey?: string;
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

interface RunpodNativeTaskExecutorConfig {
  apiBaseUrl: string;
  endpointId: string;
  apiKey: string;
  pollMs: number;
  timeoutSeconds: number;
  maxInFlight: number;
  objectUrlExpiresSeconds: number;
}

interface RunpodNativeJobCreateResponse {
  id?: string;
  jobId?: string;
  status?: string;
  error?: string;
}

interface RunpodNativeJobStatusResponse {
  id?: string;
  status?: string;
  output?: unknown;
  error?: string;
  delayTime?: number;
  executionTime?: number;
}

interface RunpodResultArtifactPayload {
  storageKey?: string;
  downloadUrl?: string;
  base64Data?: string;
  fileName?: string;
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

function shouldUseObjectStorageForRemoteExecutor() {
  const value = String(process.env.METROVAN_REMOTE_EXECUTOR_OBJECT_IO ?? '').trim().toLowerCase();
  return (value === 'true' || value === '1' || value === 'yes') && isObjectStorageConfigured();
}

function shouldRunpodPostWorkflow() {
  const value = String(process.env.METROVAN_RUNPOD_POST_WORKFLOW_ENABLED ?? 'false').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function trimStoragePrefix(value: string | undefined, fallback: string) {
  return String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function isLikelyObjectStorageKey(storageKey: string | null | undefined) {
  if (!storageKey) {
    return false;
  }

  const normalizedKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefixes = [
    trimStoragePrefix(process.env.METROVAN_OBJECT_STORAGE_INCOMING_PREFIX, 'incoming'),
    trimStoragePrefix(process.env.METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX, 'projects')
  ].filter(Boolean);

  return prefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`));
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

function resolveRunpodNativeTaskExecutorConfig(): RunpodNativeTaskExecutorConfig {
  const endpointId = String(process.env.METROVAN_RUNPOD_ENDPOINT_ID ?? '').trim();
  const apiKey = String(process.env.METROVAN_RUNPOD_API_KEY ?? '').trim();

  if (!endpointId) {
    throw new Error('METROVAN_RUNPOD_ENDPOINT_ID is required when task executor is runpod-native.');
  }

  if (!apiKey) {
    throw new Error('METROVAN_RUNPOD_API_KEY is required when task executor is runpod-native.');
  }

  if (!isObjectStorageConfigured()) {
    throw new Error('Object storage is required when task executor is runpod-native.');
  }

  return {
    apiBaseUrl: trimTrailingSlash(String(process.env.METROVAN_RUNPOD_API_BASE_URL ?? 'https://api.runpod.ai/v2').trim()),
    endpointId,
    apiKey,
    pollMs: parsePositiveIntEnv(
      process.env.METROVAN_RUNPOD_POLL_MS ?? process.env.METROVAN_REMOTE_EXECUTOR_POLL_MS,
      2500
    ),
    timeoutSeconds: parsePositiveIntEnv(
      process.env.METROVAN_RUNPOD_TIMEOUT_SECONDS ?? process.env.METROVAN_REMOTE_EXECUTOR_TIMEOUT_SECONDS,
      3600
    ),
    maxInFlight: parsePositiveIntEnv(
      process.env.METROVAN_RUNPOD_MAX_IN_FLIGHT ?? process.env.METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT,
      5
    ),
    objectUrlExpiresSeconds: parsePositiveIntEnv(process.env.METROVAN_RUNPOD_OBJECT_URL_EXPIRES_SECONDS, 6 * 60 * 60)
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

function createRunpodHeaders(config: RunpodNativeTaskExecutorConfig) {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${config.apiKey}`);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function normalizeRunpodStatus(status: string | undefined) {
  return String(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isRunpodCompletedStatus(status: string | undefined) {
  return ['completed', 'complete', 'success', 'succeeded'].includes(normalizeRunpodStatus(status));
}

function isRunpodFailedStatus(status: string | undefined) {
  return ['failed', 'failure', 'cancelled', 'canceled', 'timed_out', 'timeout'].includes(normalizeRunpodStatus(status));
}

function getNestedString(value: unknown, pathSegments: string[]) {
  let current = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return '';
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : '';
}

function extractRunpodProgress(payload: RunpodNativeJobStatusResponse) {
  const output = payload.output;
  const candidates = [
    typeof output === 'object' && output ? (output as Record<string, unknown>).progress : null,
    typeof output === 'object' && output ? (output as Record<string, unknown>).progressPercent : null,
    typeof output === 'object' && output ? (output as Record<string, unknown>).percent : null
  ];
  const numeric = candidates.find((entry) => typeof entry === 'number' && Number.isFinite(entry));
  if (typeof numeric !== 'number') {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function extractRunpodResultArtifact(output: unknown): RunpodResultArtifactPayload {
  if (!output || typeof output !== 'object') {
    return {};
  }

  const outputRecord = output as Record<string, unknown>;
  const result =
    outputRecord.result && typeof outputRecord.result === 'object'
      ? (outputRecord.result as Record<string, unknown>)
      : {};
  const results =
    Array.isArray(outputRecord.results) && outputRecord.results[0] && typeof outputRecord.results[0] === 'object'
      ? (outputRecord.results[0] as Record<string, unknown>)
      : {};

  return {
    storageKey:
      getNestedString(outputRecord, ['storageKey']) ||
      getNestedString(outputRecord, ['resultStorageKey']) ||
      getNestedString(result, ['storageKey']) ||
      getNestedString(results, ['storageKey']),
    downloadUrl:
      getNestedString(outputRecord, ['downloadUrl']) ||
      getNestedString(outputRecord, ['url']) ||
      getNestedString(result, ['downloadUrl']) ||
      getNestedString(result, ['url']) ||
      getNestedString(results, ['downloadUrl']) ||
      getNestedString(results, ['url']),
    base64Data:
      getNestedString(outputRecord, ['base64Data']) ||
      getNestedString(outputRecord, ['imageBase64']) ||
      getNestedString(result, ['base64Data']) ||
      getNestedString(results, ['base64Data']),
    fileName:
      getNestedString(outputRecord, ['fileName']) ||
      getNestedString(result, ['fileName']) ||
      getNestedString(results, ['fileName'])
  };
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

    const mirrored = await mirrorLocalFileToObjectStorage({
      userKey: project.userKey,
      projectId: project.id,
      category: 'hdr',
      sourcePath: mergedPath,
      fileName: mergedFileName,
      contentType: 'image/jpeg'
    });

    return {
      mergedPath,
      mergedFileName,
      mergedStorageKey: mirrored?.storageKey ?? null
    };
  };

  return {
    ensureMergedHdrItem
  };
}

function createRunpodManifestContext() {
  const ensureMergedHdrItem = async (_project: ProjectRecord, hdrItem: HdrItem, hdrDir: string) => {
    const selectedExposure =
      hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0];
    const baseName =
      sanitizeSegment(
        path.basename(selectedExposure?.originalName ?? hdrItem.title, path.extname(selectedExposure?.originalName ?? ''))
      ) || sanitizeSegment(hdrItem.id);
    const mergedFileName = `${baseName || 'hdr'}.jpg`;
    const mergedPath = path.join(hdrDir, `${baseName || 'hdr'}_runpod-input.json`);

    fs.mkdirSync(hdrDir, { recursive: true });
    fs.writeFileSync(
      mergedPath,
      JSON.stringify(
        {
          version: 1,
          executor: 'runpod-native',
          hdrItemId: hdrItem.id,
          title: hdrItem.title,
          selectedExposureId: hdrItem.selectedExposureId,
          exposureIds: hdrItem.exposures.map((exposure) => exposure.id),
          createdAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    );

    return {
      mergedPath,
      mergedFileName,
      mergedStorageKey: null
    };
  };

  return {
    ensureMergedHdrItem
  };
}

async function executeRunningHubWorkflowFromFile(input: {
  store: LocalStore;
  workflowConfig: ReturnType<typeof loadWorkflowConfig>;
  runningHub: RunningHubClient;
  project: ProjectRecord;
  hdrItem: HdrItem;
  inputPath: string;
  inputFileName: string;
  onProgress?: (update: WorkflowExecutionProgress) => void;
  options?: WorkflowExecutionOptions;
}) {
  const group = input.project.groups.find((entry) => entry.id === input.hdrItem.groupId);
  if (!group) {
    throw new Error(`Missing project group for HDR item ${input.hdrItem.id}.`);
  }

  const route = resolveWorkflowRoute(input.workflowConfig, group, {
    mode: input.options?.mode ?? 'default',
    colorCardNo: input.options?.colorCardNo ?? null
  });
  const normalizedPrompt = normalizeHex(route.promptText);
  const upload = await input.runningHub.uploadFile(input.workflowConfig.apiKey, input.inputPath, 'input');
  const nodeInfoList = buildRunningHubNodeInfoList(route.workflow, upload, normalizedPrompt);
  const taskId = await input.runningHub.createTask(
    input.workflowConfig.apiKey,
    route.workflow.workflowId ?? '',
    nodeInfoList,
    route.workflow.instanceType ?? 'plus'
  );

  input.onProgress?.({
    monitorState: 'submitted',
    detail: `task ${taskId} submitted`,
    remoteProgress: 0,
    queuePosition: 0,
    workflowName: route.workflow.name,
    taskId
  });

  const outputs = await input.runningHub.waitTask(
    input.workflowConfig.apiKey,
    taskId,
    (update) => {
      input.onProgress?.({
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
  await input.runningHub.downloadFile(outputUrl, tempDownloadPath);

  const resultPath = buildWorkflowResultTargetPath(input.store, input.project, input.inputFileName, input.options);
  await extractPreviewOrConvertToJpeg(tempDownloadPath, resultPath, 95);
  const mirrored = await mirrorLocalFileToObjectStorage({
    userKey: input.project.userKey,
    projectId: input.project.id,
    category: 'results',
    sourcePath: resultPath,
    fileName: path.basename(resultPath),
    contentType: 'image/jpeg'
  });
  try {
    fs.rmSync(tempDownloadPath, { force: true });
  } catch {
    // ignore
  }

  return {
    resultPath,
    resultFileName: path.basename(resultPath),
    resultStorageKey: mirrored?.storageKey ?? null
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
      return await executeRunningHubWorkflowFromFile({
        store: this.store,
        workflowConfig,
        runningHub,
        project,
        hdrItem,
        inputPath: mergedPath,
        inputFileName: mergedFileName,
        onProgress,
        options
      });
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

      const objectIo = shouldUseObjectStorageForRemoteExecutor();
      const remoteInput = objectIo
        ? await mirrorLocalFileToObjectStorage({
            userKey: project.userKey,
            projectId: project.id,
            category: 'work',
            sourcePath: mergedPath,
            fileName: mergedFileName,
            contentType: 'image/jpeg'
          })
        : null;
      const mergedBuffer = remoteInput ? null : fs.readFileSync(mergedPath);
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
          inputImageBase64: mergedBuffer ? mergedBuffer.toString('base64') : undefined,
          inputStorageKey: remoteInput?.storageKey,
          inputDownloadUrl: remoteInput?.storageKey ? createObjectDownloadUrl(remoteInput.storageKey) : undefined
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
        if (!result?.downloadUrl && !result?.base64Data && !result?.storageKey) {
          throw new Error('Remote executor completed without returning a result artifact.');
        }

        let outputBuffer: Buffer;
        let outputExtension = path.extname(result.fileName ?? '');

        if (result.base64Data) {
          outputBuffer = Buffer.from(result.base64Data, 'base64');
        } else if (result.storageKey) {
          const objectDownloadResponse = await fetch(createObjectDownloadUrl(result.storageKey));
          if (!objectDownloadResponse.ok) {
            throw new Error(`Failed to download remote object result (${objectDownloadResponse.status}).`);
          }
          outputBuffer = Buffer.from(await objectDownloadResponse.arrayBuffer());
          if (!outputExtension) {
            outputExtension = path.extname(result.storageKey);
          }
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
        const mirrored = await mirrorLocalFileToObjectStorage({
          userKey: project.userKey,
          projectId: project.id,
          category: 'results',
          sourcePath: resultPath,
          fileName: path.basename(resultPath),
          contentType: 'image/jpeg'
        });
        try {
          fs.rmSync(tempDownloadPath, { force: true });
        } catch {
          // ignore
        }

        return {
          resultPath,
          resultFileName: path.basename(resultPath),
          resultStorageKey: mirrored?.storageKey ?? result.storageKey ?? null
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

class RunpodNativeTaskExecutionProvider implements TaskExecutionProvider {
  constructor(
    private readonly repoRoot: string,
    private readonly store: LocalStore
  ) {}

  getInfo(): TaskExecutionProviderInfo {
    return {
      provider: 'runpod-native',
      workflowEngine: 'runpod-serverless'
    };
  }

  createRunContext(): TaskExecutionRunContext {
    const config = resolveRunpodNativeTaskExecutorConfig();
    const manifestContext = createRunpodManifestContext();
    const endpointBaseUrl = `${config.apiBaseUrl}/${encodeURIComponent(config.endpointId)}`;
    const postWorkflowEnabled = shouldRunpodPostWorkflow();
    const workflowConfig = postWorkflowEnabled ? loadWorkflowConfig(this.repoRoot) : null;
    const runningHub = postWorkflowEnabled ? new RunningHubClient() : null;

    const ensureObjectBackedFile = async (input: {
      project: ProjectRecord;
      filePath: string | null | undefined;
      fileName: string;
      storageKey?: string | null;
      category: 'originals' | 'results' | 'work';
      contentType?: string;
    }) => {
      if (isLikelyObjectStorageKey(input.storageKey)) {
        return {
          storageKey: input.storageKey as string,
          downloadUrl: createObjectDownloadUrl(input.storageKey as string, config.objectUrlExpiresSeconds)
        };
      }

      if (!input.filePath || !fs.existsSync(input.filePath)) {
        throw new Error(`Source file is missing for ${input.fileName}.`);
      }

      const mirrored = await mirrorLocalFileToObjectStorage({
        userKey: input.project.userKey,
        projectId: input.project.id,
        category: input.category,
        sourcePath: input.filePath,
        fileName: input.fileName,
        contentType: input.contentType ?? 'application/octet-stream'
      });

      if (!mirrored?.storageKey) {
        throw new Error(`Could not prepare cloud source for ${input.fileName}.`);
      }

      return {
        storageKey: mirrored.storageKey,
        downloadUrl: createObjectDownloadUrl(mirrored.storageKey, config.objectUrlExpiresSeconds)
      };
    };

    const buildExposurePayload = async (project: ProjectRecord, hdrItem: HdrItem) =>
      await Promise.all(
        hdrItem.exposures.map(async (exposure) => {
          const objectSource = await ensureObjectBackedFile({
            project,
            filePath: exposure.storagePath,
            fileName: exposure.originalName || exposure.fileName,
            storageKey: exposure.storageKey,
            category: 'originals',
            contentType: exposure.mimeType || 'application/octet-stream'
          });

          return {
            id: exposure.id,
            fileName: exposure.fileName,
            originalName: exposure.originalName,
            extension: exposure.extension,
            mimeType: exposure.mimeType,
            size: exposure.size,
            isRaw: exposure.isRaw,
            storageKey: objectSource.storageKey,
            downloadUrl: objectSource.downloadUrl,
            captureTime: exposure.captureTime,
            sequenceNumber: exposure.sequenceNumber,
            exposureCompensation: exposure.exposureCompensation,
            exposureSeconds: exposure.exposureSeconds,
            iso: exposure.iso,
            fNumber: exposure.fNumber,
            focalLength: exposure.focalLength
          };
        })
      );

    const writeResultArtifact = async (input: {
      project: ProjectRecord;
      jobId: string;
      result: RunpodResultArtifactPayload;
      resultPath: string;
      outputStorageKey: string;
    }) => {
      let outputBuffer: Buffer;
      let outputExtension = path.extname(input.result.fileName ?? '') || '.jpg';
      let mirroredStorageKey: string | null = null;

      if (input.result.base64Data) {
        outputBuffer = Buffer.from(input.result.base64Data, 'base64');
      } else if (input.result.storageKey) {
        const objectDownloadResponse = await fetch(
          createObjectDownloadUrl(input.result.storageKey, config.objectUrlExpiresSeconds)
        );
        if (!objectDownloadResponse.ok) {
          throw new Error(`Failed to download cloud result (${objectDownloadResponse.status}).`);
        }
        outputBuffer = Buffer.from(await objectDownloadResponse.arrayBuffer());
        outputExtension = path.extname(input.result.storageKey) || outputExtension;
        mirroredStorageKey = input.result.storageKey;
      } else if (input.result.downloadUrl) {
        const downloadResponse = await fetch(input.result.downloadUrl);
        if (!downloadResponse.ok) {
          throw new Error(`Failed to download cloud result (${downloadResponse.status}).`);
        }
        outputBuffer = Buffer.from(await downloadResponse.arrayBuffer());
        try {
          outputExtension = path.extname(new URL(input.result.downloadUrl).pathname) || outputExtension;
        } catch {
          // Keep the fallback extension.
        }
      } else {
        const objectDownloadResponse = await fetch(createObjectDownloadUrl(input.outputStorageKey, config.objectUrlExpiresSeconds));
        if (!objectDownloadResponse.ok) {
          throw new Error('Runpod job completed without returning a result artifact.');
        }
        outputBuffer = Buffer.from(await objectDownloadResponse.arrayBuffer());
        mirroredStorageKey = input.outputStorageKey;
      }

      const tempDownloadPath = path.join(
        process.env.TEMP ?? process.cwd(),
        'metrovan_runpod_results',
        `${input.jobId}${outputExtension || '.jpg'}`
      );
      fs.mkdirSync(path.dirname(tempDownloadPath), { recursive: true });
      fs.writeFileSync(tempDownloadPath, outputBuffer);

      await extractPreviewOrConvertToJpeg(tempDownloadPath, input.resultPath, 95);

      if (!mirroredStorageKey) {
        const mirrored = await mirrorLocalFileToObjectStorage({
          userKey: input.project.userKey,
          projectId: input.project.id,
          category: 'results',
          sourcePath: input.resultPath,
          fileName: path.basename(input.resultPath),
          contentType: 'image/jpeg'
        });
        mirroredStorageKey = mirrored?.storageKey ?? null;
      }

      try {
        fs.rmSync(tempDownloadPath, { force: true });
      } catch {
        // ignore
      }

      return mirroredStorageKey;
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

      const mode = options?.mode ?? 'default';
      if (mode === 'regenerate' && postWorkflowEnabled) {
        if (!workflowConfig || !runningHub) {
          throw new Error('Post workflow is enabled but RunningHub workflow config is not available.');
        }

        return await executeRunningHubWorkflowFromFile({
          store: this.store,
          workflowConfig,
          runningHub,
          project,
          hdrItem,
          inputPath: mergedPath,
          inputFileName: mergedFileName,
          onProgress,
          options
        });
      }

      const shouldRunPostWorkflow = mode === 'default' && postWorkflowEnabled;
      const resultPath = buildWorkflowResultTargetPath(this.store, project, mergedFileName, options);
      const resultFileName = path.basename(resultPath);
      const runpodStageFileName = shouldRunPostWorkflow
        ? `${path.basename(resultFileName, path.extname(resultFileName))}_runpod-stage.jpg`
        : resultFileName;
      const runpodStagePath = shouldRunPostWorkflow
        ? path.join(this.store.getProjectDirectories(project).hdr, runpodStageFileName)
        : resultPath;
      fs.mkdirSync(path.dirname(runpodStagePath), { recursive: true });
      const outputStorageKey = createPersistentObjectKey({
        userKey: project.userKey,
        projectId: project.id,
        category: shouldRunPostWorkflow ? 'work' : 'results',
        fileName: runpodStageFileName
      });

      const inputPayload =
        mode === 'regenerate'
          ? {
              sourceImage: await ensureObjectBackedFile({
                project,
                filePath: mergedPath,
                fileName: mergedFileName,
                storageKey: hdrItem.resultKey,
                category: 'results',
                contentType: 'image/jpeg'
              })
            }
          : {
              exposures: await buildExposurePayload(project, hdrItem)
            };

      const createResponse = await fetch(`${endpointBaseUrl}/run`, {
        method: 'POST',
        headers: createRunpodHeaders(config),
        body: JSON.stringify({
          input: {
            contractVersion: 'metrovan.runpod.v1',
            projectId: project.id,
            userKey: project.userKey,
            hdrItemId: hdrItem.id,
            title: hdrItem.title,
            sceneType: group.sceneType,
            colorMode: group.colorMode,
            replacementColor: normalizeHex(group.replacementColor),
            workflowMode: mode,
            colorCardNo: options?.colorCardNo ?? null,
            outputSuffix: options?.outputSuffix ?? null,
            output: {
              storageKey: outputStorageKey,
              fileName: runpodStageFileName,
              contentType: 'image/jpeg'
            },
            ...inputPayload
          }
        })
      });
      const created = await readRemoteJson<RunpodNativeJobCreateResponse>(
        createResponse,
        'Runpod job submission failed.'
      );
      const jobId = created.id ?? created.jobId;
      if (!jobId) {
        throw new Error(created.error || 'Runpod did not return a job id.');
      }

      onProgress?.({
        monitorState: created.status ?? 'submitted',
        detail: `cloud job ${jobId} submitted`,
        remoteProgress: 0,
        queuePosition: 0,
        workflowName: 'runpod-native',
        taskId: jobId
      });

      const deadline = Date.now() + config.timeoutSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, config.pollMs));

        const statusResponse = await fetch(`${endpointBaseUrl}/status/${encodeURIComponent(jobId)}`, {
          headers: createRunpodHeaders(config)
        });
        const statusPayload = await readRemoteJson<RunpodNativeJobStatusResponse>(
          statusResponse,
          'Runpod status check failed.'
        );
        const remoteProgress = extractRunpodProgress(statusPayload);
        const status = statusPayload.status ?? 'processing';

        onProgress?.({
          monitorState: status,
          detail: `cloud job ${jobId} ${status}`,
          remoteProgress,
          queuePosition: Math.max(0, Math.round((statusPayload.delayTime ?? 0) / 1000)),
          workflowName: 'runpod-native',
          taskId: jobId
        });

        if (isRunpodFailedStatus(status)) {
          throw new Error(statusPayload.error || `Cloud job ${jobId} failed.`);
        }

        if (!isRunpodCompletedStatus(status)) {
          continue;
        }

        const result = extractRunpodResultArtifact(statusPayload.output);
        const resultStorageKey = await writeResultArtifact({
          project,
          jobId,
          result,
          resultPath: runpodStagePath,
          outputStorageKey
        });

        if (shouldRunPostWorkflow) {
          if (!workflowConfig || !runningHub) {
            throw new Error('Post workflow is enabled but RunningHub workflow config is not available.');
          }

          return await executeRunningHubWorkflowFromFile({
            store: this.store,
            workflowConfig,
            runningHub,
            project,
            hdrItem,
            inputPath: runpodStagePath,
            inputFileName: mergedFileName,
            onProgress,
            options
          });
        }

        return {
          resultPath,
          resultFileName,
          resultStorageKey
        };
      }

      throw new Error(`Cloud job timed out after ${config.timeoutSeconds} seconds.`);
    };

    return {
      getMergeConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(config.maxInFlight, totalPendingItems));
      },
      getMaxConcurrency(totalPendingItems: number) {
        return Math.max(1, Math.min(config.maxInFlight, totalPendingItems));
      },
      ensureMergedHdrItem: manifestContext.ensureMergedHdrItem,
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

  if (normalizedProvider === 'runpod-native' || normalizedProvider === 'runpod-serverless') {
    return new RunpodNativeTaskExecutionProvider(options.repoRoot, options.store);
  }

  throw new Error(`Unsupported task execution provider: ${provider}`);
}
