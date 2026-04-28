import fs from 'node:fs';
import path from 'node:path';
import { openAsBlob } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { delay, ensureDir } from './utils.js';

const BASE_URL = 'https://www.runninghub.cn/';

export interface RunningHubUploadResult {
  fileName: string;
  fileId: string;
  fileUrl: string;
  raw: Record<string, unknown>;
}

export interface RunningHubStatusResult {
  taskId: string;
  status: string;
  detail: string;
  remoteProgress: number;
  queuePosition: number;
  raw: Record<string, unknown>;
}

export interface RunningHubOutputsResult {
  taskId: string;
  endpoint: string;
  fileUrls: string[];
  raw: Record<string, unknown>;
}

export interface RunningHubRealtimeUpdate {
  taskStatus: string;
  monitorState: string;
  detail: string;
  remoteProgress: number;
  queuePosition: number;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value === undefined || value === null ? '' : String(value);
}

function numberValue(record: Record<string, unknown> | null | undefined, key: string, fallback = 0) {
  const value = record?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  return asRecord(record?.[key]);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim() ?? '';
}

function ensureApiKey(apiKey: string) {
  if (!apiKey?.trim()) {
    throw new Error('Missing RunningHub API key.');
  }
}

function isTransientRunningHubError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('task_queue_maxed') ||
    normalized.includes('queue') ||
    normalized.includes('525') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('timeout') ||
    normalized.includes('temporarily') ||
    normalized.includes('too many')
  );
}

async function ensureSuccess(response: Response) {
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`RunningHub request failed: ${response.status} ${bodyText}`);
  }

  const parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  const code = parsed.code === undefined || parsed.code === null ? '0' : String(parsed.code);
  if (code && code !== '0') {
    throw new Error(String(parsed.msg ?? 'RunningHub returned failure.'));
  }

  return parsed;
}

function extractFileUrls(value: unknown, bucket: string[]) {
  const record = asRecord(value);
  if (record) {
    const fileUrl = firstNonEmpty(
      text(record, 'fileUrl'),
      text(record, 'file_url'),
      text(record, 'url'),
      text(record, 'downloadUrl'),
      text(record, 'download_url')
    );
    if (fileUrl) {
      bucket.push(fileUrl);
    }
    for (const child of Object.values(record)) {
      extractFileUrls(child, bucket);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      extractFileUrls(child, bucket);
    }
  }
}

function isOutputsReady(response: Record<string, unknown>) {
  const data = response.data;
  return Array.isArray(data);
}

export class RunningHubClient {
  async uploadFile(apiKey: string, filePath: string, fileType = 'input'): Promise<RunningHubUploadResult> {
    ensureApiKey(apiKey);

    const endpoints: Array<{ mode: 'new' | 'legacy'; url: string }> = [
      { mode: 'new', url: 'openapi/v2/media/upload/binary' },
      { mode: 'legacy', url: 'task/openapi/upload' },
      { mode: 'legacy', url: 'task/openapi/uploadFile' },
      { mode: 'legacy', url: 'task/openapi/file/upload' },
      { mode: 'legacy', url: 'task/openapi/upload/file' }
    ];

    let lastError: unknown = null;
    for (const endpoint of endpoints) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const form = new FormData();
          if (endpoint.mode === 'legacy') {
            form.append('apiKey', apiKey.trim());
            form.append('fileType', fileType);
          }

          const blob = await openAsBlob(filePath);
          form.append('file', blob, path.basename(filePath));

          const response = await fetch(new URL(endpoint.url, BASE_URL), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
              Host: 'www.runninghub.cn',
              Accept: 'application/json'
            },
            body: form
          });
          const parsed = await ensureSuccess(response);
          const data = nested(parsed, 'data') ?? parsed;
          return {
            raw: data,
            fileName: text(data, 'fileName'),
            fileId: firstNonEmpty(text(data, 'fileId'), text(data, 'file_id'), text(data, 'id'), text(data, 'fid')),
            fileUrl: firstNonEmpty(
              text(data, 'fileUrl'),
              text(data, 'file_url'),
              text(data, 'url'),
              text(data, 'downloadUrl'),
              text(data, 'download_url')
            )
          };
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await delay(attempt * 2000);
          }
        }
      }
    }

    throw new Error(`RunningHub upload failed. ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async createTask(
    apiKey: string,
    workflowId: string,
    nodeInfoList: Array<Record<string, unknown>>,
    instanceType: string
  ) {
    ensureApiKey(apiKey);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        const response = await fetch(new URL('task/openapi/create', BASE_URL), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey.trim()}`,
            Host: 'www.runninghub.cn',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            apiKey: apiKey.trim(),
            workflowId: workflowId.trim(),
            nodeInfoList,
            ...(instanceType?.trim() ? { instanceType: instanceType.trim() } : {})
          })
        });
        const parsed = await ensureSuccess(response);
        const data = nested(parsed, 'data');
        const taskId = firstNonEmpty(text(data, 'taskId'), text(parsed, 'taskId'), data ? String(data) : '');
        if (!taskId) {
          throw new Error('RunningHub create response missing taskId.');
        }
        return taskId;
      } catch (error) {
        lastError = error;
        if (attempt >= 10 || !isTransientRunningHubError(error)) {
          break;
        }
        await delay(Math.min(30000, 2500 * attempt));
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
  }

  async getTaskStatus(apiKey: string, taskId: string): Promise<RunningHubStatusResult> {
    ensureApiKey(apiKey);
    const response = await fetch(new URL('task/openapi/status', BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        Host: 'www.runninghub.cn',
        Accept: 'application/json'
      },
      body: JSON.stringify({ apiKey: apiKey.trim(), taskId: taskId.trim() })
    });
    const parsed = await ensureSuccess(response);
    const data = nested(parsed, 'data');
    const rootDataText = stringValue(parsed.data);
    return {
      taskId,
      raw: parsed,
      status: firstNonEmpty(
        text(data, 'status'),
        text(data, 'state'),
        text(data, 'taskStatus'),
        text(parsed, 'status'),
        rootDataText
      ),
      detail:
        firstNonEmpty(text(data, 'detail')) ||
        (numberValue(data, 'progress', 0) > 0 ? `progress=${numberValue(data, 'progress', 0)}` : ''),
      remoteProgress:
        numberValue(data, 'progress', 0) ||
        numberValue(data, 'percent', 0) ||
        numberValue(data, 'percentage', 0),
      queuePosition:
        numberValue(data, 'queueIndex', 0) ||
        numberValue(data, 'queuePos', 0) ||
        numberValue(data, 'queuePosition', 0)
    };
  }

  async getOutputs(apiKey: string, taskId: string): Promise<RunningHubOutputsResult> {
    ensureApiKey(apiKey);
    const endpoints = ['task/openapi/outputs', 'task/openapi/output', 'task/openapi/result', 'task/openapi/results'];
    let lastError: unknown = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(new URL(endpoint, BASE_URL), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey.trim()}`,
            Host: 'www.runninghub.cn',
            Accept: 'application/json'
          },
          body: JSON.stringify({ apiKey: apiKey.trim(), taskId: taskId.trim() })
        });
        const parsed = await ensureSuccess(response);
        const fileUrls: string[] = [];
        extractFileUrls(parsed, fileUrls);
        return {
          taskId,
          endpoint,
          raw: parsed,
          fileUrls: Array.from(new Set(fileUrls))
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`RunningHub outputs fetch failed. ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async waitTask(
    apiKey: string,
    taskId: string,
    onProgress?: (update: RunningHubRealtimeUpdate) => void,
    maxWaitSeconds = 3600
  ) {
    const deadline = Date.now() + maxWaitSeconds * 1000;

    while (Date.now() < deadline) {
      let status: RunningHubStatusResult;
      try {
        status = await this.getTaskStatus(apiKey, taskId);
      } catch (error) {
        if (!isTransientRunningHubError(error)) {
          throw error;
        }
        onProgress?.({
          taskStatus: 'RUNNING',
          monitorState: 'retrying',
          detail: error instanceof Error ? error.message : String(error),
          remoteProgress: 0,
          queuePosition: 0
        });
        await delay(5000);
        continue;
      }
      onProgress?.({
        taskStatus: status.status || 'RUNNING',
        monitorState: status.queuePosition > 0 ? 'polling' : 'connected',
        detail: status.detail,
        remoteProgress: status.remoteProgress,
        queuePosition: status.queuePosition
      });

      const normalizedStatus = status.status.toLowerCase();
      if (['success', 'done', 'completed', 'finish', 'finished'].some((value) => normalizedStatus.includes(value))) {
        break;
      }
      if (['error', 'failed', 'cancel', 'aborted'].some((value) => normalizedStatus.includes(value))) {
        throw new Error(`RunningHub task failed: ${status.status || status.detail || taskId}`);
      }

      await delay(3000);
    }

    let outputs: RunningHubOutputsResult | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      outputs = await this.getOutputs(apiKey, taskId);
      if (isOutputsReady(outputs.raw) && outputs.fileUrls.length > 0) {
        return outputs;
      }
      await delay(3000);
    }

    throw new Error('RunningHub outputs are not ready.');
  }

  async downloadFile(url: string, targetPath: string) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`File download failed: ${response.status} ${await response.text()}`);
        }
        if (!response.body) {
          throw new Error('File download failed: empty response body.');
        }

        ensureDir(path.dirname(targetPath));
        await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(targetPath));
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= 4 || !isTransientRunningHubError(error)) {
          break;
        }
        await delay(2000 * attempt);
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
  }
}
