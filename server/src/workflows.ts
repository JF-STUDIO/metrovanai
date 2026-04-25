import path from 'node:path';
import type { ProjectGroup, WorkflowConfigFile, WorkflowConfigItem } from './types.js';
import { loadJson } from './utils.js';

export interface WorkflowRoute {
  workflow: WorkflowConfigItem;
  promptText: string | null;
}

export interface WorkflowRouteOptions {
  mode?: 'default' | 'regenerate';
  colorCardNo?: string | null;
}

export function loadWorkflowConfig(repoRoot: string) {
  const workflowsPath = path.join(repoRoot, 'server-runtime', 'workflows.json');
  return loadJson<WorkflowConfigFile>(workflowsPath, {
    active: '',
    apiKey: '',
    settings: {
      inputMode: 'files',
      groupMode: 'hdr',
      saveHDR: true,
      saveGroups: true,
      outputRoot: '',
      workflowMaxInFlight: 40,
      extraFolders: []
    },
    items: []
  });
}

export function getWorkflowByName(config: WorkflowConfigFile, name: string) {
  return config.items.find(
    (item) =>
      item.type === 'runninghub' &&
      item.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

function isRunnableRunningHubWorkflow(item: WorkflowConfigItem | undefined): item is WorkflowConfigItem {
  return Boolean(item?.type === 'runninghub' && item.workflowId?.trim());
}

function getDefaultRunningHubWorkflow(config: WorkflowConfigFile) {
  const activeWorkflow = config.active?.trim()
    ? getWorkflowByName(config, config.active)
    : undefined;
  if (isRunnableRunningHubWorkflow(activeWorkflow)) {
    return activeWorkflow;
  }

  return config.items.find(isRunnableRunningHubWorkflow);
}

function normalizeCardNo(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

function getWorkflowCardNo(workflow: WorkflowConfigItem) {
  return normalizeCardNo(workflow.colorCardNo ?? workflow.colorCard ?? workflow.cardNo ?? workflow.card);
}

function isRegenerationWorkflow(workflow: WorkflowConfigItem) {
  const purpose = String(workflow.purpose ?? '').trim().toLowerCase();
  const name = workflow.name.trim().toLowerCase();
  return (
    purpose === 'regenerate' ||
    purpose === 'regeneration' ||
    purpose === 'rerender' ||
    purpose === 'revision' ||
    Boolean(getWorkflowCardNo(workflow)) ||
    name.includes('regenerate') ||
    name.includes('rerender') ||
    name.includes('revision') ||
    name.includes('重新') ||
    name.includes('重修')
  );
}

function getRegenerationWorkflow(config: WorkflowConfigFile, colorCardNo: string | null | undefined) {
  const targetCardNo = normalizeCardNo(colorCardNo);
  const candidates = config.items.filter((item) => isRunnableRunningHubWorkflow(item) && isRegenerationWorkflow(item));
  const exact = candidates.find((item) => getWorkflowCardNo(item) === targetCardNo);
  if (exact) {
    return exact;
  }
  return candidates.find((item) => !getWorkflowCardNo(item));
}

export function resolveWorkflowRoute(
  config: WorkflowConfigFile,
  _group: ProjectGroup,
  options: WorkflowRouteOptions = {}
): WorkflowRoute {
  if (options.mode === 'regenerate') {
    const workflow = getRegenerationWorkflow(config, options.colorCardNo);
    if (!workflow) {
      throw new Error(`Regenerate workflow for color card ${options.colorCardNo ?? ''} is not configured.`);
    }
    return { workflow, promptText: options.colorCardNo ?? null };
  }

  const workflow = getDefaultRunningHubWorkflow(config);
  if (!workflow) {
    throw new Error('No RunningHub workflow is configured.');
  }

  return { workflow, promptText: null };
}

export function buildRunningHubNodeInfoList(
  workflow: WorkflowConfigItem,
  upload: { fileName: string; fileId: string; fileUrl: string },
  promptText: string | null
) {
  if (!workflow.inputs?.length) {
    throw new Error('Workflow input mappings are empty.');
  }

  const rows: Array<Record<string, string>> = [];
  for (const mapping of workflow.inputs) {
    if (!mapping.nodeId?.trim()) {
      continue;
    }

    const fieldName = (mapping.fieldName || 'image').trim();
    const mode = (mapping.mode || '').trim().toLowerCase();
    let fieldValue = '';
    if (
      mode.includes('url') ||
      mode.includes('fileurl') ||
      mode.includes('file_url') ||
      mode.includes('download') ||
      mode.includes('link')
    ) {
      fieldValue = upload.fileUrl || upload.fileId || upload.fileName;
    } else if (
      mode.includes('id') ||
      mode.includes('fileid') ||
      mode.includes('file_id') ||
      mode.includes('fid')
    ) {
      fieldValue = upload.fileId || upload.fileName || upload.fileUrl;
    } else {
      fieldValue = upload.fileName || upload.fileId || upload.fileUrl;
    }

    if (!fieldValue) {
      throw new Error('Upload result is missing fileName/fileId/fileUrl.');
    }

    rows.push({
      nodeId: mapping.nodeId.trim(),
      fieldName,
      field: fieldName,
      fieldValue
    });
  }

  if (workflow.prompt?.nodeId?.trim() && promptText?.trim()) {
    const promptField = (workflow.prompt.fieldName || 'prompt').trim();
    rows.push({
      nodeId: workflow.prompt.nodeId.trim(),
      fieldName: promptField,
      field: promptField,
      fieldValue: promptText.trim()
    });
  }

  if (!rows.length) {
    throw new Error('Workflow inputs do not contain a valid nodeId.');
  }

  return rows;
}
