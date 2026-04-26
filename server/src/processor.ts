import fs from 'node:fs';
import path from 'node:path';
import type { HdrItem, ProjectRecord } from './types.js';
import type { LocalStore } from './store.js';
import { delay, normalizeHex, sanitizeSegment } from './utils.js';
import {
  createTaskExecutionProvider,
  type TaskExecutionProvider,
  type WorkflowBatchExecutionItem,
  type WorkflowBatchExecutionResult,
  type WorkflowExecutionArtifact,
  type WorkflowExecutionProgress,
  type TaskExecutionRunContext
} from './task-executor.js';

const POINT_PRICE_USD = 0.25;

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  push(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  close() {
    this.closed = true;
    while (this.waiters.length) {
      this.waiters.shift()?.(null);
    }
  }

  async shift(): Promise<T | null> {
    if (this.items.length) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return await new Promise<T | null>((resolve) => this.waiters.push(resolve));
  }

  tryShift(): T | null {
    if (this.items.length) {
      return this.items.shift() ?? null;
    }
    return null;
  }

  async shiftWithTimeout(timeoutMs: number): Promise<T | null> {
    if (this.items.length || this.closed) {
      return await this.shift();
    }

    return await new Promise<T | null>((resolve) => {
      let settled = false;
      const waiter = (value: T | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        resolve(null);
      }, Math.max(0, timeoutMs));
      this.waiters.push(waiter);
    });
  }
}

interface WorkflowQueueItem {
  hdrItemId: string;
  mergedPath: string;
  mergedFileName: string;
}

interface MergeQueueItem {
  hdrItemId: string;
}

interface StartOptions {
  recovery?: boolean;
}

function createProcessingText(status: HdrItem['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'error') return '处理失败';
  if (status === 'review') return '待确认';
  return '处理中';
}

export class ProjectProcessor {
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly activeRegenerations = new Map<string, Promise<void>>();
  private readonly taskExecution: TaskExecutionProvider;

  constructor(
    private readonly repoRoot: string,
    private readonly store: LocalStore
  ) {
    this.taskExecution = createTaskExecutionProvider(process.env.METROVAN_TASK_EXECUTOR, {
      repoRoot,
      store
    });
  }

  getExecutionInfo() {
    return this.taskExecution.getInfo();
  }

  async start(projectId: string, options: StartOptions = {}) {
    if (this.activeJobs.has(projectId)) {
      return this.store.getProject(projectId);
    }

    const project = this.store.getProject(projectId);
    if (!project) {
      return null;
    }

    const completedCount = this.countCompletedHdrItems(project);
    const pendingCount = this.getPendingHdrItems(project).length;
    const baselinePercent = this.calculateBaselinePercent(project, completedCount);

    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'queued',
      percent: baselinePercent,
      label: '澶勭悊涓?',
      detail:
        pendingCount > 0
          ? options.recovery
            ? `姝ｅ湪鎭㈠锛屽墿浣?${pendingCount} 缁勫緟缁窇`
            : '绛夊緟寮€濮?'
          : completedCount > 0
            ? '姝ｅ湪鏍￠獙宸插瓨鍦ㄧ殑缁撴灉'
            : '绛夊緟寮€濮?',
      currentHdrItemId: null,
      startedAt: job.startedAt ?? new Date().toISOString(),
      completedAt: null,
      workflowRealtime: {
        ...job.workflowRealtime,
        total: project.hdrItems.length,
        entered: completedCount,
        returned: completedCount,
        active: 0,
        failed: 0,
        succeeded: completedCount,
        currentNodeName: '',
        currentNodeId: '',
        currentNodePercent: completedCount > 0 ? 100 : 0,
        monitorState: '',
        transport: '',
        detail: '',
        queuePosition: 0,
        remoteProgress: completedCount > 0 ? 100 : 0
      }
    }));

    const promise = this.run(projectId, options).finally(() => {
      this.activeJobs.delete(projectId);
    });
    this.activeJobs.set(projectId, promise);
    return this.store.getProject(projectId);
  }

  async recoverInterruptedProjects() {
    const recoverableProjects = this.store.listRecoverableProjects();
    let recovered = 0;

    for (const project of recoverableProjects) {
      const started = await this.start(project.id, { recovery: true });
      if (started) {
        recovered += 1;
      }
    }

    return recovered;
  }

  async regenerateResult(projectId: string, hdrItemId: string, input: { colorCardNo: string }) {
    const activeKey = `${projectId}:${hdrItemId}`;
    if (this.activeRegenerations.has(activeKey)) {
      return this.store.getProject(projectId);
    }

    const project = this.store.getProject(projectId);
    if (!project) {
      return null;
    }

    const hdrItem = project.hdrItems.find((item) => item.id === hdrItemId);
    if (!hdrItem || !this.isHdrItemCompleted(hdrItem)) {
      throw new Error('This result is not ready for regeneration.');
    }

    if (hdrItem.regeneration?.freeUsed) {
      throw new Error('The free regeneration for this photo has already been used.');
    }

    const colorCardNo = normalizeHex(input.colorCardNo);
    if (!colorCardNo) {
      throw new Error('Invalid regeneration color.');
    }
    const now = new Date().toISOString();
    this.store.setHdrItemState(projectId, hdrItemId, (item) => ({
      ...item,
      regeneration: {
        ...(item.regeneration ?? {
          freeUsed: false,
          status: 'idle',
          colorCardNo: null,
          workflowName: null,
          taskId: null,
          startedAt: null,
          completedAt: null,
          errorMessage: null
        }),
        status: 'running',
        colorCardNo,
        workflowName: null,
        taskId: null,
        startedAt: now,
        completedAt: null,
        errorMessage: null
      }
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      label: 'Regenerating result',
      detail: `Regenerating ${hdrItem.title} with color card ${colorCardNo}`,
      currentHdrItemId: hdrItemId,
      startedAt: job.startedAt ?? now,
      completedAt: null,
      percent: Math.max(job.percent, 1),
      workflowRealtime: {
        ...job.workflowRealtime,
        total: 1,
        entered: 0,
        returned: 0,
        active: 0,
        failed: 0,
        succeeded: 0,
        monitorState: 'queued',
        detail: '',
        remoteProgress: 0,
        currentNodePercent: 0
      }
    }));

    const promise = this.runRegeneration(projectId, hdrItemId, colorCardNo).finally(() => {
      this.activeRegenerations.delete(activeKey);
    });
    this.activeRegenerations.set(activeKey, promise);
    void promise;
    return this.store.getProject(projectId);
  }

  private async runRegeneration(projectId: string, hdrItemId: string, colorCardNo: string) {
    const taskExecution = this.taskExecution.createRunContext();
    const initialProject = this.store.getProject(projectId);
    const initialHdrItem = initialProject?.hdrItems.find((item) => item.id === hdrItemId);
    if (!initialProject || !initialHdrItem) {
      return;
    }

    try {
      const sourcePath = initialHdrItem.resultPath;
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('The finished result file is missing.');
      }
      const sourceFileName =
        initialHdrItem.resultFileName ?? path.basename(sourcePath) ?? `${sanitizeSegment(initialHdrItem.title) || hdrItemId}.jpg`;

      const project = this.store.getProject(projectId) ?? initialProject;
      const hdrItem = project.hdrItems.find((item) => item.id === hdrItemId) ?? initialHdrItem;
      const result = await taskExecution.executeWorkflowTask(
        project,
        hdrItem,
        sourcePath,
        sourceFileName,
        (update) => {
          this.store.setHdrItemState(projectId, hdrItemId, (item) => ({
            ...item,
            regeneration: {
              ...(item.regeneration ?? {
                freeUsed: false,
                status: 'idle',
                colorCardNo,
                workflowName: null,
                taskId: null,
                startedAt: null,
                completedAt: null,
                errorMessage: null
              }),
              status: 'running',
              colorCardNo,
              workflowName: update.workflowName,
              taskId: update.taskId,
              errorMessage: null
            }
          }));
          this.store.setJobState(projectId, (job) => ({
            ...job,
            status: 'running',
            label: 'Regenerating result',
            detail: update.detail || `Regenerating ${hdrItem.title}`,
            currentHdrItemId: hdrItemId,
            percent: Math.max(job.percent, Math.round(update.remoteProgress)),
            workflowRealtime: {
              ...job.workflowRealtime,
              entered: 1,
              active: 1,
              monitorState: update.monitorState,
              detail: update.detail,
              remoteProgress: update.remoteProgress,
              queuePosition: update.queuePosition,
              transport: 'poll',
              currentNodeName: update.workflowName,
              currentNodeId: update.taskId,
              currentNodePercent: update.remoteProgress
            }
          }));
        },
        {
          mode: 'regenerate',
          colorCardNo
        }
      );

      const completedAt = new Date().toISOString();
      this.store.setHdrItemState(projectId, hdrItemId, (item) => ({
        ...item,
        resultKey: result.resultStorageKey ?? this.store.toStorageKey(result.resultPath),
        resultPath: result.resultPath,
        resultUrl: this.store.toStorageUrl(result.resultPath),
        resultFileName: result.resultFileName,
        status: 'completed',
        errorMessage: null,
        regeneration: {
          ...(item.regeneration ?? {
            freeUsed: false,
            status: 'idle',
            colorCardNo,
            workflowName: null,
            taskId: null,
            startedAt: null,
            completedAt: null,
            errorMessage: null
          }),
          freeUsed: true,
          status: 'completed',
          colorCardNo,
          completedAt,
          errorMessage: null
        }
      }));
      this.store.updateProject(projectId, (project) => ({
        ...project,
        status: 'completed',
        currentStep: 4
      }));
      this.store.setJobState(projectId, (job) => ({
        ...job,
        status: 'completed',
        label: 'Regeneration completed',
        detail: `${hdrItem.title} regenerated with color card ${colorCardNo}`,
        currentHdrItemId: null,
        completedAt,
        percent: 100,
        workflowRealtime: {
          ...job.workflowRealtime,
          returned: 1,
          succeeded: 1,
          active: 0,
          monitorState: 'returned',
          remoteProgress: 100,
          queuePosition: 0,
          currentNodePercent: 100
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      this.store.setHdrItemState(projectId, hdrItemId, (item) => ({
        ...item,
        regeneration: {
          ...(item.regeneration ?? {
            freeUsed: false,
            status: 'idle',
            colorCardNo,
            workflowName: null,
            taskId: null,
            startedAt: null,
            completedAt: null,
            errorMessage: null
          }),
          status: 'failed',
          colorCardNo,
          completedAt,
          errorMessage: message
        }
      }));
      this.store.setJobState(projectId, (job) => ({
        ...job,
        status: 'failed',
        label: 'Regeneration failed',
        detail: message,
        currentHdrItemId: null,
        completedAt,
        workflowRealtime: {
          ...job.workflowRealtime,
          failed: 1,
          active: 0,
          monitorState: 'error',
          detail: message
        }
      }));
    }
  }

  private async run(projectId: string, options: StartOptions = {}) {
    const initialProject = this.store.getProject(projectId);
    if (!initialProject) {
      return;
    }

    if (!initialProject.hdrItems.length) {
      this.store.setJobState(projectId, (job) => ({
        ...job,
        status: 'failed',
        label: '澶勭悊澶辫触',
        detail: '娌℃湁鍙鐞嗙殑 HDR 鍒嗙粍',
        completedAt: new Date().toISOString()
      }));
      return;
    }

    const pendingHdrItems = this.getPendingHdrItems(initialProject);
    if (!pendingHdrItems.length) {
      this.finishRecoveredProject(projectId, initialProject);
      return;
    }

    const taskExecution = this.taskExecution.createRunContext();
    const projectDirs = this.store.getProjectDirectories(initialProject);
    let mergeCompleted = 0;

    this.store.updateProject(projectId, (project) => ({
      ...project,
      status: 'processing',
      currentStep: 3
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      label: '澶勭悊涓?',
      detail: options.recovery ? '姝ｅ湪鎭㈠鏈畬鎴愮殑 HDR 浠诲姟' : '姝ｅ湪鍚堝苟 HDR',
      percent: Math.max(1, job.percent)
    }));

    await this.runParallelMergeAndWorkflow(projectId, pendingHdrItems, taskExecution, projectDirs.hdr);
    pendingHdrItems.splice(0, pendingHdrItems.length);
    const queue = { push: (_item: WorkflowQueueItem) => undefined, close: () => undefined };
    const workers: Array<Promise<void>> = [];

    try {
      for (const queuedHdrItem of pendingHdrItems) {
        const currentProject = this.store.getProject(projectId);
        const hdrItem = currentProject?.hdrItems.find((item) => item.id === queuedHdrItem.id);
        if (!hdrItem || this.isHdrItemCompleted(hdrItem)) {
          continue;
        }

        this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
          ...item,
          status: 'hdr-processing',
          statusText: createProcessingText('hdr-processing'),
          errorMessage: null
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          label: '澶勭悊涓?',
          detail: `姝ｅ湪鍚堝苟 ${hdrItem.title}`,
          currentHdrItemId: hdrItem.id
        }));

        try {
          const { mergedFileName, mergedPath, mergedStorageKey } = await taskExecution.ensureMergedHdrItem(
            currentProject ?? initialProject,
            hdrItem,
            projectDirs.hdr
          );
          const mergedUrl = this.store.toStorageUrl(mergedPath);
          mergeCompleted += 1;

          this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
            ...item,
            mergedKey: mergedStorageKey ?? this.store.toStorageKey(mergedPath),
            mergedPath,
            mergedUrl,
            status: 'workflow-upload',
            statusText: createProcessingText('workflow-upload'),
            errorMessage: null
          }));
          this.store.setJobState(projectId, (job) => ({
            ...job,
            percent: Math.max(job.percent, Math.round((mergeCompleted / Math.max(1, pendingHdrItems.length)) * 45)),
            detail: `HDR 宸插悎骞?${mergeCompleted}/${pendingHdrItems.length}`
          }));
          queue.push({
            hdrItemId: hdrItem.id,
            mergedPath,
            mergedFileName
          });
        } catch (error) {
          mergeCompleted += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
            ...item,
            status: 'error',
            statusText: createProcessingText('error'),
            errorMessage: message
          }));
          this.store.setJobState(projectId, (job) => ({
            ...job,
            workflowRealtime: {
              ...job.workflowRealtime,
              failed: job.workflowRealtime.failed + 1
            },
            detail: message
          }));
        }
      }
    } finally {
      queue.close();
    }

    await Promise.all(workers);
    const finalProject = this.store.getProject(projectId);
    const hasSuccess = Boolean(finalProject?.resultAssets.length);
    const finalFailed = finalProject?.job?.workflowRealtime.failed ?? 0;

    this.store.updateProject(projectId, (project) => ({
      ...project,
      status: hasSuccess ? 'completed' : 'failed',
      currentStep: hasSuccess ? 4 : 3,
      pointsSpent: hasSuccess ? this.countCompletedHdrItems(project) : 0
    }));
    this.store.settleProjectProcessingCredits(projectId, POINT_PRICE_USD);
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: hasSuccess ? 'completed' : 'failed',
      label: hasSuccess ? '澶勭悊瀹屾垚' : '澶勭悊澶辫触',
      detail: hasSuccess
        ? `瀹屾垚 ${finalProject?.resultAssets.length ?? 0} 寮狅紝澶辫触 ${finalFailed} 寮燻`
        : '娌℃湁鎴愬姛鍥炰紶鐨勭粨鏋滃浘',
      completedAt: new Date().toISOString(),
      currentHdrItemId: null,
      percent: hasSuccess ? 100 : Math.max(job.percent, 1)
    }));
  }

  private countCompletedHdrItems(project: ProjectRecord) {
    return project.hdrItems.filter((item) => this.isHdrItemCompleted(item)).length;
  }

  private getPendingHdrItems(project: ProjectRecord) {
    return project.hdrItems.filter((item) => !this.isHdrItemCompleted(item));
  }

  private isHdrItemCompleted(item: HdrItem) {
    return Boolean(item.resultPath && item.resultUrl && fs.existsSync(item.resultPath));
  }

  private calculateBaselinePercent(project: ProjectRecord, completedCount: number) {
    if (!project.hdrItems.length || !completedCount) {
      return 0;
    }

    return Math.min(99, 46 + Math.round((completedCount / project.hdrItems.length) * 54));
  }

  private finishRecoveredProject(projectId: string, project: ProjectRecord) {
    const completedCount = this.countCompletedHdrItems(project);
    const hasSuccess = completedCount > 0;

    this.store.updateProject(projectId, (current) => ({
      ...current,
      status: hasSuccess ? 'completed' : 'failed',
      currentStep: hasSuccess ? 4 : 3,
      pointsSpent: hasSuccess ? completedCount : 0
    }));
    this.store.settleProjectProcessingCredits(projectId, POINT_PRICE_USD);
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: hasSuccess ? 'completed' : 'failed',
      label: hasSuccess ? '澶勭悊瀹屾垚' : '澶勭悊澶辫触',
      detail: hasSuccess ? '宸蹭粠鎸佷箙鍖栫粨鏋滄仮澶嶏紝鏃犻渶閲嶆柊澶勭悊銆?' : '娌℃湁鍙仮澶嶇殑澶勭悊涓粨鏋?',
      currentHdrItemId: null,
      completedAt: new Date().toISOString(),
      percent: hasSuccess ? 100 : Math.max(job.percent, 1),
      workflowRealtime: {
        ...job.workflowRealtime,
        total: project.hdrItems.length,
        returned: completedCount,
        succeeded: completedCount,
        active: 0,
        currentNodeName: '',
        currentNodeId: '',
        currentNodePercent: hasSuccess ? 100 : 0,
        monitorState: hasSuccess ? 'recovered' : '',
        detail: hasSuccess ? 'recovered_from_persisted_outputs' : '',
        queuePosition: 0,
        remoteProgress: hasSuccess ? 100 : 0
      }
    }));
  }

  private async runParallelMergeAndWorkflow(
    projectId: string,
    pendingHdrItems: HdrItem[],
    taskExecution: TaskExecutionRunContext,
    hdrDir: string
  ) {
    const mergeQueue = new AsyncQueue<MergeQueueItem>();
    const workflowQueue = new AsyncQueue<WorkflowQueueItem>();
    const mergeProgress = {
      completed: 0,
      total: pendingHdrItems.length
    };
    const mergeWorkerCount = taskExecution.getMergeConcurrency(pendingHdrItems.length);
    const mergeWorkers = Array.from({ length: mergeWorkerCount }, () =>
      this.mergeWorker(projectId, mergeQueue, workflowQueue, taskExecution, hdrDir, mergeProgress)
    );

    for (const item of pendingHdrItems) {
      mergeQueue.push({ hdrItemId: item.id });
    }
    mergeQueue.close();

    await Promise.all(mergeWorkers);
    workflowQueue.close();

    const workerCount = taskExecution.getMaxConcurrency(pendingHdrItems.length);
    const workflowWorkers = Array.from({ length: workerCount }, () =>
      this.workflowWorker(projectId, workflowQueue, taskExecution)
    );
    await Promise.all(workflowWorkers);
  }

  private async mergeWorker(
    projectId: string,
    mergeQueue: AsyncQueue<MergeQueueItem>,
    workflowQueue: AsyncQueue<WorkflowQueueItem>,
    taskExecution: TaskExecutionRunContext,
    hdrDir: string,
    mergeProgress: { completed: number; total: number }
  ) {
    while (true) {
      const queuedItem = await mergeQueue.shift();
      if (!queuedItem) {
        return;
      }

      const currentProject = this.store.getProject(projectId);
      const hdrItem = currentProject?.hdrItems.find((item) => item.id === queuedItem.hdrItemId);
      if (!currentProject || !hdrItem || this.isHdrItemCompleted(hdrItem)) {
        continue;
      }

      this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
        ...item,
        status: 'hdr-processing',
        statusText: createProcessingText('hdr-processing'),
        errorMessage: null
      }));
      this.store.setJobState(projectId, (job) => ({
        ...job,
        label: 'HDR processing',
        detail: `Merging ${hdrItem.title}`,
        currentHdrItemId: hdrItem.id
      }));

      try {
        const { mergedFileName, mergedPath, mergedStorageKey } = await taskExecution.ensureMergedHdrItem(currentProject, hdrItem, hdrDir);
        const mergedUrl = this.store.toStorageUrl(mergedPath);
        mergeProgress.completed += 1;

        this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
          ...item,
          mergedKey: mergedStorageKey ?? this.store.toStorageKey(mergedPath),
          mergedPath,
          mergedUrl,
          status: 'workflow-upload',
          statusText: createProcessingText('workflow-upload'),
          errorMessage: null
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          percent: Math.max(job.percent, Math.round((mergeProgress.completed / Math.max(1, mergeProgress.total)) * 45)),
          detail: `HDR merged ${mergeProgress.completed}/${mergeProgress.total}`
        }));
        workflowQueue.push({
          hdrItemId: hdrItem.id,
          mergedPath,
          mergedFileName
        });
      } catch (error) {
        mergeProgress.completed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.store.setHdrItemState(projectId, hdrItem.id, (item) => ({
          ...item,
          status: 'error',
          statusText: createProcessingText('error'),
          errorMessage: message
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          workflowRealtime: {
            ...job.workflowRealtime,
            failed: job.workflowRealtime.failed + 1
          },
          detail: message
        }));
      }

      await delay(150);
    }
  }

  private collectWorkflowBatch(
    firstItem: WorkflowQueueItem,
    queue: AsyncQueue<WorkflowQueueItem>,
    taskExecution: TaskExecutionRunContext
  ) {
    const maxBatchSize = taskExecution.executeWorkflowBatch
      ? Math.max(1, taskExecution.getWorkflowBatchSize?.(Number.MAX_SAFE_INTEGER) ?? 1)
      : 1;
    const queuedItems = [firstItem];

    while (queuedItems.length < maxBatchSize) {
      const nextItem = queue.tryShift();
      if (!nextItem) {
        break;
      }
      queuedItems.push(nextItem);
    }

    return queuedItems;
  }

  private resolveWorkflowBatchItems(projectId: string, queuedItems: WorkflowQueueItem[]) {
    const currentProject = this.store.getProject(projectId);
    if (!currentProject) {
      return { currentProject: null, executionItems: [] as WorkflowBatchExecutionItem[] };
    }

    const executionItems: WorkflowBatchExecutionItem[] = [];
    for (const queuedItem of queuedItems) {
      const hdrItem = currentProject.hdrItems.find((entry) => entry.id === queuedItem.hdrItemId);
      const group = currentProject.groups.find((entry) => entry.id === hdrItem?.groupId);
      if (!hdrItem || !group || this.isHdrItemCompleted(hdrItem)) {
        continue;
      }

      executionItems.push({
        hdrItem,
        mergedPath: queuedItem.mergedPath,
        mergedFileName: queuedItem.mergedFileName
      });
    }

    return { currentProject, executionItems };
  }

  private markWorkflowBatchUploading(projectId: string, executionItems: WorkflowBatchExecutionItem[]) {
    for (const executionItem of executionItems) {
      this.store.setHdrItemState(projectId, executionItem.hdrItem.id, (entry) => ({
        ...entry,
        status: 'workflow-upload',
        statusText: createProcessingText('workflow-upload')
      }));
    }

    this.store.setJobState(projectId, (job) => ({
      ...job,
      workflowRealtime: {
        ...job.workflowRealtime,
        entered: job.workflowRealtime.entered + executionItems.length,
        active: job.workflowRealtime.active + executionItems.length,
        monitorState: 'uploading',
        detail: `Submitting ${executionItems.length} HDR group${executionItems.length === 1 ? '' : 's'}`
      }
    }));
  }

  private markWorkflowBatchProgress(
    projectId: string,
    executionItems: WorkflowBatchExecutionItem[],
    update: WorkflowExecutionProgress
  ) {
    const targetItems = update.hdrItemId
      ? executionItems.filter((executionItem) => executionItem.hdrItem.id === update.hdrItemId)
      : executionItems;
    const currentHdrItemId = targetItems[0]?.hdrItem.id ?? executionItems[0]?.hdrItem.id ?? null;

    for (const executionItem of targetItems) {
      this.store.setHdrItemState(projectId, executionItem.hdrItem.id, (entry) => ({
        ...entry,
        status: 'workflow-running',
        statusText: createProcessingText('workflow-running')
      }));
    }

    this.store.setJobState(projectId, (job) => ({
      ...job,
      percent: Math.max(job.percent, 46),
      label: 'Processing',
      detail: update.detail || 'Cloud processing is running.',
      currentHdrItemId,
      workflowRealtime: {
        ...job.workflowRealtime,
        monitorState: update.monitorState,
        detail: update.detail,
        remoteProgress: update.remoteProgress,
        queuePosition: update.queuePosition,
        transport: 'poll',
        currentNodeName: update.workflowName,
        currentNodeId: update.taskId,
        currentNodePercent: update.remoteProgress
      }
    }));
  }

  private async executeWorkflowBatchItems(
    project: ProjectRecord,
    executionItems: WorkflowBatchExecutionItem[],
    taskExecution: TaskExecutionRunContext,
    onProgress: (update: WorkflowExecutionProgress) => void
  ): Promise<WorkflowBatchExecutionResult[]> {
    if (taskExecution.executeWorkflowBatch) {
      return await taskExecution.executeWorkflowBatch(project, executionItems, onProgress);
    }

    return await Promise.all(
      executionItems.map(async (executionItem) => {
        try {
          const artifact = await taskExecution.executeWorkflowTask(
            project,
            executionItem.hdrItem,
            executionItem.mergedPath,
            executionItem.mergedFileName,
            onProgress
          );
          return { hdrItemId: executionItem.hdrItem.id, artifact };
        } catch (error) {
          return {
            hdrItemId: executionItem.hdrItem.id,
            errorMessage: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );
  }

  private completeWorkflowItem(projectId: string, hdrItem: HdrItem, result: WorkflowExecutionArtifact) {
    this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
      ...entry,
      resultKey: result.resultStorageKey ?? this.store.toStorageKey(result.resultPath),
      resultPath: result.resultPath,
      resultUrl: this.store.toStorageUrl(result.resultPath),
      resultFileName: result.resultFileName,
      status: 'completed',
      statusText: createProcessingText('completed'),
      errorMessage: null
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      percent: Math.max(
        job.percent,
        46 + Math.round(((job.workflowRealtime.returned + 1) / Math.max(1, job.workflowRealtime.total)) * 54)
      ),
      workflowRealtime: {
        ...job.workflowRealtime,
        returned: job.workflowRealtime.returned + 1,
        succeeded: job.workflowRealtime.succeeded + 1,
        active: Math.max(0, job.workflowRealtime.active - 1),
        monitorState: 'returned',
        detail: `${hdrItem.title} completed`,
        remoteProgress: 100,
        queuePosition: 0,
        currentNodePercent: 100
      }
    }));
  }

  private failWorkflowItem(projectId: string, hdrItem: HdrItem, message: string) {
    this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
      ...entry,
      status: 'error',
      statusText: createProcessingText('error'),
      errorMessage: message
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      workflowRealtime: {
        ...job.workflowRealtime,
        failed: job.workflowRealtime.failed + 1,
        active: Math.max(0, job.workflowRealtime.active - 1),
        monitorState: 'error',
        detail: message
      }
    }));
  }

  private async processWorkflowBatchFromFirstItem(
    projectId: string,
    firstItem: WorkflowQueueItem,
    queue: AsyncQueue<WorkflowQueueItem>,
    taskExecution: TaskExecutionRunContext
  ) {
    const queuedItems = this.collectWorkflowBatch(firstItem, queue, taskExecution);
    const { currentProject, executionItems } = this.resolveWorkflowBatchItems(projectId, queuedItems);
    if (!currentProject || !executionItems.length) {
      return;
    }

    try {
      this.markWorkflowBatchUploading(projectId, executionItems);
      const results = await this.executeWorkflowBatchItems(
        currentProject,
        executionItems,
        taskExecution,
        (update) => this.markWorkflowBatchProgress(projectId, executionItems, update)
      );

      const hdrItemsById = new Map(executionItems.map((executionItem) => [executionItem.hdrItem.id, executionItem.hdrItem]));
      for (const result of results) {
        const hdrItem = hdrItemsById.get(result.hdrItemId);
        if (!hdrItem) {
          continue;
        }
        if (result.artifact) {
          this.completeWorkflowItem(projectId, hdrItem, result.artifact);
        } else {
          this.failWorkflowItem(projectId, hdrItem, result.errorMessage || 'Cloud processing did not return a result.');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const executionItem of executionItems) {
        this.failWorkflowItem(projectId, executionItem.hdrItem, message);
      }
    }
  }

  private async workflowWorker(
    projectId: string,
    queue: AsyncQueue<WorkflowQueueItem>,
    taskExecution: TaskExecutionRunContext
  ) {
    while (true) {
      const item = await queue.shift();
      if (!item) {
        return;
      }

      await this.processWorkflowBatchFromFirstItem(projectId, item, queue, taskExecution);
      await delay(150);
      continue;

      /*
      const currentProject = this.store.getProject(projectId);
      const hdrItem = currentProject?.hdrItems.find((entry) => entry.id === item.hdrItemId);
      const group = currentProject?.groups.find((entry) => entry.id === hdrItem?.groupId);
      if (!currentProject || !hdrItem || !group || this.isHdrItemCompleted(hdrItem)) {
        continue;
      }

      try {
        this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
          ...entry,
          status: 'workflow-upload',
          statusText: createProcessingText('workflow-upload')
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          workflowRealtime: {
            ...job.workflowRealtime,
            entered: job.workflowRealtime.entered + 1,
            active: job.workflowRealtime.active + 1,
            monitorState: 'uploading',
            detail: `姝ｅ湪涓婁紶 ${hdrItem.title}`
          }
        }));

        const result = await taskExecution.executeWorkflowTask(
          currentProject,
          hdrItem,
          item.mergedPath,
          item.mergedFileName,
          (update) => {
            this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
              ...entry,
              status: 'workflow-running',
              statusText: createProcessingText('workflow-running')
            }));
            this.store.setJobState(projectId, (job) => ({
              ...job,
              percent: Math.max(job.percent, 46),
              label: '澶勭悊涓?',
              detail: update.detail || `浠诲姟 ${update.taskId} 鎵ц涓?`,
              currentHdrItemId: hdrItem.id,
              workflowRealtime: {
                ...job.workflowRealtime,
                monitorState: update.monitorState,
                detail: update.detail,
                remoteProgress: update.remoteProgress,
                queuePosition: update.queuePosition,
                transport: 'poll',
                currentNodeName: update.workflowName,
                currentNodeId: update.taskId,
                currentNodePercent: update.remoteProgress
              }
            }));
          }
        );

        this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
          ...entry,
          resultKey: result.resultStorageKey ?? this.store.toStorageKey(result.resultPath),
          resultPath: result.resultPath,
          resultUrl: this.store.toStorageUrl(result.resultPath),
          resultFileName: result.resultFileName,
          status: 'completed',
          statusText: createProcessingText('completed'),
          errorMessage: null
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          percent: Math.max(
            job.percent,
            46 + Math.round(((job.workflowRealtime.returned + 1) / Math.max(1, job.workflowRealtime.total)) * 54)
          ),
          workflowRealtime: {
            ...job.workflowRealtime,
            returned: job.workflowRealtime.returned + 1,
            succeeded: job.workflowRealtime.succeeded + 1,
            active: Math.max(0, job.workflowRealtime.active - 1),
            monitorState: 'returned',
            detail: `${hdrItem.title} 宸插洖浼燻`,
            remoteProgress: 100,
            queuePosition: 0,
            currentNodePercent: 100
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
          ...entry,
          status: 'error',
          statusText: createProcessingText('error'),
          errorMessage: message
        }));
        this.store.setJobState(projectId, (job) => ({
          ...job,
          workflowRealtime: {
            ...job.workflowRealtime,
            failed: job.workflowRealtime.failed + 1,
            active: Math.max(0, job.workflowRealtime.active - 1),
            monitorState: 'error',
            detail: message
          }
        }));
      }
      */

      await delay(150);
    }
  }
}
