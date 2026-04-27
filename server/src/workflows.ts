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
  const config = loadJson<WorkflowConfigFile>(workflowsPath, {
    active: '',
    apiKey: '',
    settings: {
      inputMode: 'files',
      groupMode: 'hdr',
      saveHDR: true,
      saveGroups: true,
      outputRoot: '',
      workflowMaxInFlight: 90,
      extraFolders: []
    },
    items: []
  });

  applyWorkflowEnvOverrides(config);
  return config;
}

function env(name: string) {
  return process.env[name]?.trim() ?? '';
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function upsertWorkflowItem(config: WorkflowConfigFile, item: WorkflowConfigItem) {
  const index = config.items.findIndex((current) => current.name.trim().toLowerCase() === item.name.trim().toLowerCase());
  if (index >= 0) {
    config.items[index] = item;
    return;
  }
  config.items.push(item);
}

function applyWorkflowEnvOverrides(config: WorkflowConfigFile) {
  const apiKey = env('METROVAN_RUNNINGHUB_API_KEY') || env('RUNNINGHUB_API_KEY');
  if (apiKey) {
    config.apiKey = apiKey;
  }

  config.settings.workflowMaxInFlight = parsePositiveInt(
    env('METROVAN_RUNNINGHUB_MAX_IN_FLIGHT') || env('METROVAN_WORKFLOW_MAX_IN_FLIGHT'),
    config.settings.workflowMaxInFlight
  );

  const defaultWorkflowId = env('METROVAN_RUNNINGHUB_DEFAULT_WORKFLOW_ID');
  if (defaultWorkflowId) {
    const name = env('METROVAN_RUNNINGHUB_DEFAULT_WORKFLOW_NAME') || 'default-runninghub';
    config.active = env('METROVAN_RUNNINGHUB_ACTIVE_WORKFLOW') || name;
    upsertWorkflowItem(config, {
      name,
      type: 'runninghub',
      workflowId: defaultWorkflowId,
      instanceType: env('METROVAN_RUNNINGHUB_DEFAULT_INSTANCE_TYPE') || 'plus',
      inputs: [
        {
          nodeId: env('METROVAN_RUNNINGHUB_DEFAULT_INPUT_NODE_ID') || '61',
          fieldName: env('METROVAN_RUNNINGHUB_DEFAULT_INPUT_FIELD') || 'image',
          mode: env('METROVAN_RUNNINGHUB_DEFAULT_INPUT_MODE') || 'image'
        }
      ],
      outputs: [
        {
          nodeId: env('METROVAN_RUNNINGHUB_DEFAULT_OUTPUT_NODE_ID') || '41',
          fieldName: env('METROVAN_RUNNINGHUB_DEFAULT_OUTPUT_FIELD') || 'output',
          mode: env('METROVAN_RUNNINGHUB_DEFAULT_OUTPUT_MODE') || 'file'
        }
      ]
    });
  } else if (env('METROVAN_RUNNINGHUB_ACTIVE_WORKFLOW')) {
    config.active = env('METROVAN_RUNNINGHUB_ACTIVE_WORKFLOW');
  }

  const regenerateWorkflowId = env('METROVAN_RUNNINGHUB_REGEN_WORKFLOW_ID');
  if (regenerateWorkflowId) {
    upsertWorkflowItem(config, {
      name: env('METROVAN_RUNNINGHUB_REGEN_WORKFLOW_NAME') || 'regenerate-runninghub',
      type: 'runninghub',
      purpose: 'regenerate',
      workflowId: regenerateWorkflowId,
      instanceType: env('METROVAN_RUNNINGHUB_REGEN_INSTANCE_TYPE') || 'plus',
      inputs: [
        {
          nodeId: env('METROVAN_RUNNINGHUB_REGEN_INPUT_NODE_ID') || '1',
          fieldName: env('METROVAN_RUNNINGHUB_REGEN_INPUT_FIELD') || 'image',
          mode: env('METROVAN_RUNNINGHUB_REGEN_INPUT_MODE') || 'image'
        }
      ],
      outputs: [
        {
          nodeId: env('METROVAN_RUNNINGHUB_REGEN_OUTPUT_NODE_ID') || '46',
          fieldName: env('METROVAN_RUNNINGHUB_REGEN_OUTPUT_FIELD') || 'output',
          mode: env('METROVAN_RUNNINGHUB_REGEN_OUTPUT_MODE') || 'file'
        }
      ],
      prompt: {
        nodeId: env('METROVAN_RUNNINGHUB_REGEN_PROMPT_NODE_ID') || '35',
        fieldName: env('METROVAN_RUNNINGHUB_REGEN_PROMPT_FIELD') || 'color',
        mode: 'text',
        defaultText: env('METROVAN_RUNNINGHUB_REGEN_PROMPT_DEFAULT') || '#F2E8D8'
      }
    });
  }
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
