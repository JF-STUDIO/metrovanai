import fs from 'node:fs';
import path from 'node:path';
import type { HdrItem, ProjectRecord } from './types.js';
import type { LocalStore } from './store.js';
import { delay, normalizeHex, sanitizeSegment } from './utils.js';
import { captureServerError, logServerEvent } from './observability.js';
import {
  createTaskExecutionProvider,
  type TaskExecutionProvider,
  type WorkflowBatchExecutionItem,
  type WorkflowBatchExecutionResult,
  type WorkflowExecutionArtifact,
  type WorkflowExecutionProgress,
  type TaskExecutionRunContext
} from './task-executor.js';
import { isConfiguredObjectStorageKey } from './object-storage.js';

const POINT_PRICE_USD = 0.25;
const STREAMING_UPLOAD_POLL_MS = 750;
const STREAMING_UPLOAD_IDLE_TIMEOUT_MS = Number(process.env.METROVAN_STREAMING_UPLOAD_IDLE_TIMEOUT_MS ?? 15 * 60 * 1000);
const WORKFLOW_BATCH_FILL_WAIT_MS = Math.max(
  0,
  Number(process.env.METROVAN_WORKFLOW_BATCH_FILL_WAIT_MS ?? 1200)
);

type RegenerationCreditReservation = Extract<
  ReturnType<LocalStore['reserveProjectRegenerationCredit']>,
  { ok: true }
>;

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
  retryFailed?: boolean;
}

export interface ResultRecoverySummary {
  projectId: string;
  status: 'done' | 'active' | 'missing' | 'idle';
  attempted: number;
  recovered: number;
  failed: number;
}

export interface ResultRecoveryBatchSummary {
  scanned: number;
  attempted: number;
  recovered: number;
  failed: number;
  skippedActive: number;
  projects: ResultRecoverySummary[];
}

function createProcessingText(status: HdrItem['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'error') return '处理失败';
  if (status === 'review') return '待确认';
  return '处理中';
}

function createEmptyWorkflowState() {
  return {
    stage: 'idle' as const,
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

export class ProjectProcessor {
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly activeRegenerations = new Map<string, Promise<void>>();
  private readonly activeResultRecoveries = new Map<string, Promise<ResultRecoverySummary>>();
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

    if (options.retryFailed) {
      this.resetFailedItemsForRetry(projectId);
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
      phase: 'queued',
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

    const promise = this.run(projectId, options).catch((error) => {
      this.handleRunFailure(projectId, error);
    }).finally(() => {
      this.activeJobs.delete(projectId);
    });
    this.activeJobs.set(projectId, promise);
    return this.store.getProject(projectId);
  }

  private handleRunFailure(projectId: string, error: unknown) {
    const project = this.store.getProject(projectId);
    if (!project) {
      return;
    }

    const completedCount = this.countCompletedHdrItems(project);
    const failedCount = Math.max(0, project.hdrItems.length - completedCount);
    const message = error instanceof Error ? error.message : String(error);
    captureServerError(error, {
      event: 'project.processor.failed',
      projectId,
      phase: 'workflow_running',
      details: {
        completedCount,
        failedCount,
        message
      }
    });

    for (const item of project.hdrItems) {
      if (this.isHdrItemCompleted(item) || item.status === 'error') {
        continue;
      }

      this.store.setHdrItemState(projectId, item.id, (entry) => ({
        ...entry,
        status: 'error',
        statusText: createProcessingText('error'),
        errorMessage: '处理被中断，请重试这张照片。',
        workflow: {
          ...createEmptyWorkflowState(),
          ...(entry.workflow ?? {}),
          stage: 'failed',
          updatedAt: new Date().toISOString(),
          errorMessage: '处理被中断，请重试这张照片。'
        }
      }));
    }

    this.store.updateProject(projectId, (current) => ({
      ...current,
      status: completedCount > 0 ? 'completed' : 'failed',
      currentStep: completedCount > 0 ? 4 : 3,
      pointsSpent: completedCount
    }));
    this.store.settleProjectProcessingCredits(projectId, POINT_PRICE_USD);
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: completedCount > 0 ? 'completed' : 'failed',
      phase: completedCount > 0 ? 'completed' : 'failed',
      label: completedCount > 0 ? '部分完成' : '处理失败',
      detail:
        completedCount > 0
          ? `已完成 ${completedCount} 张，未完成 ${failedCount} 张可重新处理。`
          : '照片暂时未能完成，请检查后重试。',
      currentHdrItemId: null,
      completedAt: new Date().toISOString(),
      percent: completedCount > 0 ? 100 : Math.max(job.percent, 1),
      workflowRealtime: {
        ...job.workflowRealtime,
        active: 0,
        failed: Math.max(job.workflowRealtime.failed, failedCount),
        succeeded: Math.max(job.workflowRealtime.succeeded, completedCount),
        returned: Math.max(job.workflowRealtime.returned, completedCount),
        monitorState: completedCount > 0 ? 'partial-completed' : 'failed',
        detail: message
      }
    }));
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

  async recoverFailedRunningHubResults(options: { limit?: number } = {}): Promise<ResultRecoveryBatchSummary> {
    const limit = Math.max(1, Math.min(50, Math.round(options.limit ?? 5)));
    const projects = this.store.listProjectsNeedingResultRecovery().slice(0, limit);
    const summary: ResultRecoveryBatchSummary = {
      scanned: projects.length,
      attempted: 0,
      recovered: 0,
      failed: 0,
      skippedActive: 0,
      projects: []
    };

    for (const project of projects) {
      const projectSummary = await this.recoverRunningHubResults(project.id);
      summary.projects.push(projectSummary);
      summary.attempted += projectSummary.attempted;
      summary.recovered += projectSummary.recovered;
      summary.failed += projectSummary.failed;
      if (projectSummary.status === 'active') {
        summary.skippedActive += 1;
      }
    }

    return summary;
  }

  async recoverRunningHubResults(projectId: string): Promise<ResultRecoverySummary> {
    const activeRecovery = this.activeResultRecoveries.get(projectId);
    if (activeRecovery) {
      return await activeRecovery;
    }

    const recovery = this.performRunningHubResultRecovery(projectId).finally(() => {
      this.activeResultRecoveries.delete(projectId);
    });
    this.activeResultRecoveries.set(projectId, recovery);
    return await recovery;
  }

  private async performRunningHubResultRecovery(projectId: string): Promise<ResultRecoverySummary> {
    if (this.activeJobs.has(projectId)) {
      return { projectId, status: 'active', attempted: 0, recovered: 0, failed: 0 };
    }

    const project = this.store.getProject(projectId);
    if (!project) {
      return { projectId, status: 'missing', attempted: 0, recovered: 0, failed: 0 };
    }

    const recoverableItems = this.getRecoverableResultItems(project);
    if (!recoverableItems.length) {
      return { projectId, status: 'idle', attempted: 0, recovered: 0, failed: 0 };
    }

    const now = new Date().toISOString();
    const completedBefore = this.countCompletedHdrItems(project);
    this.store.updateProject(projectId, (current) => ({
      ...current,
      status: 'processing',
      currentStep: 3
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      phase: 'result_returning',
      label: 'Recovering RunningHub results',
      detail: `Recovering ${recoverableItems.length} completed RunningHub result${recoverableItems.length === 1 ? '' : 's'}.`,
      startedAt: job.startedAt ?? now,
      completedAt: null,
      currentHdrItemId: recoverableItems[0]?.id ?? null,
      percent: Math.max(job.percent, this.calculateBaselinePercent(project, completedBefore)),
      workflowRealtime: {
        ...job.workflowRealtime,
        total: project.hdrItems.length,
        entered: Math.max(job.workflowRealtime.entered, completedBefore + recoverableItems.length),
        returned: completedBefore,
        succeeded: completedBefore,
        active: recoverableItems.length,
        monitorState: 'recovering',
        detail: 'recovering_runninghub_results'
      }
    }));

    const taskExecution = this.taskExecution.createRunContext();
    const projectDirs = this.store.getProjectDirectories(project);
    const summary: ResultRecoverySummary = {
      projectId,
      status: 'done',
      attempted: 0,
      recovered: 0,
      failed: 0
    };

    for (const candidate of recoverableItems) {
      const latestProject = this.store.getProject(projectId);
      const latestItem = latestProject?.hdrItems.find((item) => item.id === candidate.id);
      if (!latestProject || !latestItem || !this.getRecoverableResultItems(latestProject).some((item) => item.id === candidate.id)) {
        continue;
      }

      summary.attempted += 1;
      this.store.setHdrItemState(projectId, latestItem.id, (item) => ({
        ...item,
        status: 'workflow-running',
        statusText: createProcessingText('workflow-running'),
        errorMessage: null,
        workflow: {
          ...createEmptyWorkflowState(),
          ...(item.workflow ?? {}),
          stage: 'runninghub',
          updatedAt: now,
          completedAt: null,
          errorMessage: null
        }
      }));

      const recovered = await this.tryRecoverWorkflowItem(projectId, latestProject, latestItem, taskExecution, projectDirs.hdr);
      if (recovered) {
        summary.recovered += 1;
      } else {
        summary.failed += 1;
        this.store.setHdrItemState(projectId, latestItem.id, (item) => ({
          ...item,
          status: 'error',
          statusText: createProcessingText('error'),
          errorMessage: item.errorMessage || 'RunningHub result recovery did not return an output yet.',
          workflow: {
            ...createEmptyWorkflowState(),
            ...(item.workflow ?? {}),
            stage: 'failed',
            updatedAt: new Date().toISOString(),
            errorMessage: item.workflow?.errorMessage || 'RunningHub result recovery did not return an output yet.'
          }
        }));
      }
    }

    const finalProject = this.store.getProject(projectId);
    if (finalProject) {
      const completedCount = this.countCompletedHdrItems(finalProject);
      const hasSuccess = completedCount > 0;
      const failedCount = Math.max(0, finalProject.hdrItems.length - completedCount);

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
        phase: hasSuccess ? 'completed' : 'failed',
        detail:
          summary.recovered > 0
            ? `Recovered ${summary.recovered} RunningHub result${summary.recovered === 1 ? '' : 's'}.`
            : 'No RunningHub result was recovered.',
        currentHdrItemId: null,
        completedAt: new Date().toISOString(),
        percent: hasSuccess ? 100 : Math.max(job.percent, 1),
        workflowRealtime: {
          ...job.workflowRealtime,
          total: finalProject.hdrItems.length,
          returned: completedCount,
          succeeded: completedCount,
          active: 0,
          failed: failedCount,
          monitorState: summary.recovered > 0 ? 'recovered' : 'recovery_failed',
          detail: summary.recovered > 0 ? 'runninghub_results_recovered' : 'runninghub_recovery_no_output',
          remoteProgress: hasSuccess ? 100 : job.workflowRealtime.remoteProgress,
          currentNodePercent: hasSuccess ? 100 : job.workflowRealtime.currentNodePercent
        }
      }));
    }

    return summary;
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

    const colorCardNo = normalizeHex(input.colorCardNo);
    if (!colorCardNo) {
      throw new Error('Invalid regeneration color.');
    }

    const creditReservation = this.store.reserveProjectRegenerationCredit(projectId, POINT_PRICE_USD);
    if (!creditReservation.ok) {
      throw new Error(creditReservation.error || 'Insufficient credits for regeneration.');
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
      phase: 'regenerating',
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

    const promise = this.runRegeneration(projectId, hdrItemId, colorCardNo, creditReservation).finally(() => {
      this.activeRegenerations.delete(activeKey);
    });
    this.activeRegenerations.set(activeKey, promise);
    void promise;
    return this.store.getProject(projectId);
  }

  private async runRegeneration(
    projectId: string,
    hdrItemId: string,
    colorCardNo: string,
    creditReservation: RegenerationCreditReservation
  ) {
    const taskExecution = this.taskExecution.createRunContext();
    const initialProject = this.store.getProject(projectId);
    const initialHdrItem = initialProject?.hdrItems.find((item) => item.id === hdrItemId);
    if (!initialProject || !initialHdrItem) {
      this.store.refundProjectRegenerationCredit(projectId, creditReservation);
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
            phase: 'regenerating',
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
          freeUsed: creditReservation.free,
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
        phase: 'completed',
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
      this.store.refundProjectRegenerationCredit(projectId, creditReservation);
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
        phase: 'failed',
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

    const pendingHdrItems = this.getPendingHdrItems(initialProject, { readyOnly: true });
    if (!pendingHdrItems.length && this.isProjectInputComplete(initialProject)) {
      this.finishRecoveredProject(projectId, initialProject);
      return;
    }

    const taskExecution = this.taskExecution.createRunContext();
    const projectDirs = this.store.getProjectDirectories(initialProject);
    this.store.updateProject(projectId, (project) => ({
      ...project,
      status: 'processing',
      currentStep: 3
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      phase: 'hdr_merging',
      label: '澶勭悊涓?',
      detail: options.recovery ? '姝ｅ湪鎭㈠鏈畬鎴愮殑 HDR 浠诲姟' : '姝ｅ湪鍚堝苟 HDR',
      percent: Math.max(1, job.percent)
    }));

    await this.runParallelMergeAndWorkflow(projectId, taskExecution, projectDirs.hdr);
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

  private getPendingHdrItems(project: ProjectRecord, options: { readyOnly?: boolean } = {}) {
    return project.hdrItems.filter(
      (item) =>
        !this.isHdrItemCompleted(item) &&
        item.status !== 'error' &&
        (!options.readyOnly || this.isHdrItemReadyForProcessing(item))
    );
  }

  private hasRecoverableRunningHubTask(item: HdrItem) {
    return Boolean(item.workflow?.runningHubTaskId?.trim());
  }

  private isHdrItemCompleted(item: HdrItem) {
    return Boolean(item.resultUrl && item.resultFileName && (item.resultKey || item.resultPath));
  }

  private getRecoverableResultItems(project: ProjectRecord) {
    return project.hdrItems.filter(
      (item) =>
        !this.isHdrItemCompleted(item) &&
        this.hasRecoverableRunningHubTask(item) &&
        (item.status === 'error' || item.workflow?.stage === 'failed')
    );
  }

  private isProjectInputComplete(project: ProjectRecord) {
    return Boolean(project.uploadCompletedAt);
  }

  private isHdrItemReadyForProcessing(item: HdrItem) {
    if (this.hasRecoverableRunningHubTask(item)) {
      return true;
    }

    return (
      item.exposures.length > 0 &&
      item.exposures.every(
        (exposure) =>
          isConfiguredObjectStorageKey(exposure.storageKey) ||
          Boolean(exposure.storagePath && fs.existsSync(exposure.storagePath))
      )
    );
  }

  private resetFailedItemsForRetry(projectId: string) {
    this.store.updateProject(projectId, (project) => {
      let resetCount = 0;
      project.hdrItems = project.hdrItems.map((item) => {
        if (this.isHdrItemCompleted(item) || item.status !== 'error') {
          return item;
        }

        resetCount += 1;
        const hasRunningHubTask = this.hasRecoverableRunningHubTask(item);
        return {
          ...item,
          status: hasRunningHubTask ? 'workflow-running' : 'review',
          statusText: createProcessingText(hasRunningHubTask ? 'workflow-running' : 'review'),
          errorMessage: null,
          workflow: {
            ...createEmptyWorkflowState(),
            ...(item.workflow ?? {}),
            stage: hasRunningHubTask ? 'runninghub' : 'idle',
            errorMessage: null,
            completedAt: null,
            updatedAt: new Date().toISOString()
          }
        };
      });

      if (resetCount > 0) {
        project.status = 'processing';
        project.currentStep = 3;
        if (project.job) {
          project.job = {
            ...project.job,
            status: 'queued',
            phase: 'queued',
            completedAt: null,
            detail: `Retrying ${resetCount} failed item${resetCount === 1 ? '' : 's'}.`,
            workflowRealtime: {
              ...project.job.workflowRealtime,
              failed: 0,
              active: 0
            }
          };
        }
      }

      return project;
    });
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

  private async runParallelMergeAndWorkflow(projectId: string, taskExecution: TaskExecutionRunContext, hdrDir: string) {
    const mergeQueue = new AsyncQueue<MergeQueueItem>();
    const workflowQueue = new AsyncQueue<WorkflowQueueItem>();
    const workflowBatchQueue = new AsyncQueue<WorkflowQueueItem[]>();
    const queuedHdrItemIds = new Set<string>();
    const initialProject = this.store.getProject(projectId);
    const mergeProgress = {
      completed: 0,
      total: initialProject?.hdrItems.length ?? 0
    };
    let lastReadyAt = Date.now();

    const markUnreadyItemsFailed = (project: ProjectRecord, message: string) => {
      let failed = 0;
      for (const item of this.getPendingHdrItems(project)) {
        if (queuedHdrItemIds.has(item.id) || this.isHdrItemReadyForProcessing(item)) {
          continue;
        }
        failed += 1;
        this.store.setHdrItemState(projectId, item.id, (entry) => ({
          ...entry,
          status: 'error',
          statusText: createProcessingText('error'),
          errorMessage: message
        }));
      }

      if (failed > 0) {
        this.store.setJobState(projectId, (job) => ({
          ...job,
          workflowRealtime: {
            ...job.workflowRealtime,
            failed: job.workflowRealtime.failed + failed
          },
          detail: message
        }));
      }
    };

    const mergeWorkerCount = taskExecution.getMergeConcurrency(Math.max(1, mergeProgress.total));
    const mergeWorkers = Array.from({ length: mergeWorkerCount }, () =>
      this.mergeWorker(projectId, mergeQueue, workflowQueue, taskExecution, hdrDir, mergeProgress)
    );
    const workflowWorkerCount = taskExecution.getMaxConcurrency(Math.max(1, mergeProgress.total));
    const workflowBatcher = this.workflowBatcher(workflowQueue, workflowBatchQueue, taskExecution);
    const workflowWorkers = Array.from({ length: workflowWorkerCount }, () =>
      this.workflowBatchWorker(projectId, workflowBatchQueue, taskExecution)
    );

    while (true) {
      const currentProject = this.store.getProject(projectId);
      if (!currentProject) {
        break;
      }

      mergeProgress.total = Math.max(mergeProgress.total, currentProject.hdrItems.length);
      this.store.setJobState(projectId, (job) => ({
        ...job,
        workflowRealtime: {
          ...job.workflowRealtime,
          total: Math.max(job.workflowRealtime.total, currentProject.hdrItems.length)
        }
      }));

      const readyItems = this.getPendingHdrItems(currentProject, { readyOnly: true }).filter(
        (item) => !queuedHdrItemIds.has(item.id)
      );
      if (readyItems.length > 0) {
        lastReadyAt = Date.now();
        for (const item of readyItems) {
          queuedHdrItemIds.add(item.id);
          mergeQueue.push({ hdrItemId: item.id });
        }
      }

      if (this.isProjectInputComplete(currentProject)) {
        markUnreadyItemsFailed(currentProject, 'Some original photos were not uploaded. Please check and retry.');
        const refreshedProject = this.store.getProject(projectId);
        const hasUnqueuedPending = refreshedProject
          ? this.getPendingHdrItems(refreshedProject).some((item) => !queuedHdrItemIds.has(item.id))
          : false;
        if (!hasUnqueuedPending) {
          break;
        }
      } else if (Date.now() - lastReadyAt > STREAMING_UPLOAD_IDLE_TIMEOUT_MS) {
        markUnreadyItemsFailed(currentProject, 'Upload did not finish in time. Please retry the unfinished photos.');
        break;
      }

      await delay(STREAMING_UPLOAD_POLL_MS);
    }

    mergeQueue.close();

    await Promise.all(mergeWorkers);
    workflowQueue.close();
    await workflowBatcher;
    workflowBatchQueue.close();
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

      const recovered = await this.tryRecoverWorkflowItem(projectId, currentProject, hdrItem, taskExecution, hdrDir);
      if (recovered) {
        mergeProgress.completed += 1;
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
        status: 'running',
        phase: 'hdr_merging',
        label: 'HDR processing',
        detail: `Merging ${hdrItem.title}`,
        currentHdrItemId: hdrItem.id
      }));

      try {
        const { mergedFileName, mergedPath, mergedStorageKey } = await taskExecution.ensureMergedHdrItem(currentProject, hdrItem, hdrDir);
        const mergedUrl = mergedStorageKey ? this.store.toStorageUrlFromKey(mergedStorageKey) : this.store.toStorageUrl(mergedPath);
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
          phase: 'workflow_uploading',
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
        captureServerError(error, {
          event: 'project.hdr_merge.failed',
          projectId,
          taskId: hdrItem.id,
          phase: 'hdr_merging',
          details: {
            hdrItemId: hdrItem.id,
            title: hdrItem.title
          }
        });
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

  private resolveMergedFileName(hdrItem: HdrItem) {
    const selectedExposure =
      hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0];
    const sourceName = selectedExposure?.originalName ?? selectedExposure?.fileName ?? hdrItem.title;
    const baseName = sanitizeSegment(path.basename(sourceName, path.extname(sourceName))) || sanitizeSegment(hdrItem.id) || 'hdr';
    return `${baseName}.jpg`;
  }

  private async tryRecoverWorkflowItem(
    projectId: string,
    project: ProjectRecord,
    hdrItem: HdrItem,
    taskExecution: TaskExecutionRunContext,
    hdrDir: string
  ) {
    if (!taskExecution.recoverWorkflowTask || !this.hasRecoverableRunningHubTask(hdrItem)) {
      return false;
    }

    const mergedFileName = this.resolveMergedFileName(hdrItem);
    const mergedPath = hdrItem.mergedPath || path.join(hdrDir, `${path.basename(mergedFileName, '.jpg')}_recover.json`);
    const executionItem: WorkflowBatchExecutionItem = {
      hdrItem,
      mergedPath,
      mergedFileName
    };

    try {
      const artifact = await taskExecution.recoverWorkflowTask(
        project,
        hdrItem,
        mergedPath,
        mergedFileName,
        (update) => this.markWorkflowBatchProgress(projectId, [executionItem], update)
      );
      if (!artifact) {
        return false;
      }

      await this.completeWorkflowItem(projectId, hdrItem, artifact);
      return true;
    } catch (error) {
      logServerEvent({
        level: 'warning',
        event: 'project.workflow_recovery.failed',
        projectId,
        taskId: hdrItem.id,
        phase: 'workflow_running',
        details: {
          hdrItemId: hdrItem.id,
          runningHubTaskId: hdrItem.workflow?.runningHubTaskId ?? null,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return false;
    }
  }

  private async collectWorkflowBatch(
    firstItem: WorkflowQueueItem,
    queue: AsyncQueue<WorkflowQueueItem>,
    taskExecution: TaskExecutionRunContext
  ) {
    const maxBatchSize = taskExecution.executeWorkflowBatch
      ? Math.max(1, taskExecution.getWorkflowBatchSize?.(Number.MAX_SAFE_INTEGER) ?? 1)
      : 1;
    const queuedItems = [firstItem];

    while (queuedItems.length < maxBatchSize) {
      const nextItem = await queue.shiftWithTimeout(WORKFLOW_BATCH_FILL_WAIT_MS);
      if (!nextItem) {
        break;
      }
      queuedItems.push(nextItem);
    }

    return queuedItems;
  }

  private async workflowBatcher(
    sourceQueue: AsyncQueue<WorkflowQueueItem>,
    batchQueue: AsyncQueue<WorkflowQueueItem[]>,
    taskExecution: TaskExecutionRunContext
  ) {
    while (true) {
      const firstItem = await sourceQueue.shift();
      if (!firstItem) {
        return;
      }

      const queuedItems = await this.collectWorkflowBatch(firstItem, sourceQueue, taskExecution);
      batchQueue.push(queuedItems);
    }
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
    const now = new Date().toISOString();
    for (const executionItem of executionItems) {
      this.store.setHdrItemState(projectId, executionItem.hdrItem.id, (entry) => ({
        ...entry,
        status: 'workflow-upload',
        statusText: createProcessingText('workflow-upload'),
        workflow: {
          ...createEmptyWorkflowState(),
          ...(entry.workflow ?? {}),
          stage: 'runpod',
          updatedAt: now,
          completedAt: null,
          errorMessage: null
        }
      }));
    }

    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      phase: 'workflow_uploading',
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
    const now = new Date().toISOString();

    for (const executionItem of targetItems) {
      this.store.setHdrItemState(projectId, executionItem.hdrItem.id, (entry) => ({
        ...entry,
        status: 'workflow-running',
        statusText: createProcessingText('workflow-running'),
        workflow: {
          ...createEmptyWorkflowState(),
          ...(entry.workflow ?? {}),
          stage: update.stage ?? entry.workflow?.stage ?? 'runninghub',
          runpodJobId:
            update.stage === 'runpod' && targetItems.length === 1
              ? update.taskId
              : entry.workflow?.runpodJobId ?? null,
          runpodBatchJobId:
            update.stage === 'runpod' && targetItems.length > 1
              ? update.taskId
              : entry.workflow?.runpodBatchJobId ?? null,
          runningHubTaskId:
            update.stage === 'runninghub' ? update.taskId : entry.workflow?.runningHubTaskId ?? null,
          runningHubWorkflowName:
            update.stage === 'runninghub'
              ? update.workflowName
              : entry.workflow?.runningHubWorkflowName ?? null,
          lastTaskId: update.taskId,
          lastTaskProvider: update.stage ?? entry.workflow?.lastTaskProvider ?? null,
          submittedAt: entry.workflow?.submittedAt ?? now,
          updatedAt: now,
          completedAt: null,
          errorMessage: null
        }
      }));
    }

    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      phase: 'workflow_running',
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

  private async completeWorkflowItem(projectId: string, hdrItem: HdrItem, result: WorkflowExecutionArtifact) {
    const resultStorageKey = result.resultStorageKey ?? this.store.toStorageKey(result.resultPath);
    const now = new Date().toISOString();
    this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
      ...entry,
      mergedKey: result.mergedStorageKey ?? entry.mergedKey,
      mergedPath: result.mergedPath ?? entry.mergedPath,
      mergedUrl: result.mergedStorageKey
        ? this.store.toStorageUrlFromKey(result.mergedStorageKey)
        : result.mergedPath
          ? this.store.toStorageUrl(result.mergedPath)
          : entry.mergedUrl,
      resultKey: resultStorageKey,
      resultPath: result.resultPath,
      resultUrl: result.resultStorageKey ? this.store.toStorageUrlFromKey(result.resultStorageKey) : this.store.toStorageUrl(result.resultPath),
      resultFileName: result.resultFileName,
      status: 'completed',
      statusText: createProcessingText('completed'),
      errorMessage: null,
      workflow: {
        ...createEmptyWorkflowState(),
        ...(entry.workflow ?? {}),
        stage: 'completed',
        updatedAt: now,
        completedAt: now,
        errorMessage: null
      }
    }));
    this.store.setJobState(projectId, (job) => ({
      ...job,
      status: 'running',
      phase: 'result_returning',
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
    logServerEvent({
      level: 'warning',
      event: 'project.item.failed',
      projectId,
      taskId: hdrItem.id,
      phase: 'workflow_running',
      details: {
        hdrItemId: hdrItem.id,
        title: hdrItem.title,
        message
      }
    });
    this.store.setHdrItemState(projectId, hdrItem.id, (entry) => ({
      ...entry,
      status: 'error',
      statusText: createProcessingText('error'),
      errorMessage: message,
      workflow: {
        ...createEmptyWorkflowState(),
        ...(entry.workflow ?? {}),
        stage: 'failed',
        updatedAt: new Date().toISOString(),
        errorMessage: message
      }
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

  private async processWorkflowBatch(
    projectId: string,
    queuedItems: WorkflowQueueItem[],
    taskExecution: TaskExecutionRunContext
  ) {
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
          await this.completeWorkflowItem(projectId, hdrItem, result.artifact);
        } else {
          this.failWorkflowItem(projectId, hdrItem, result.errorMessage || 'Cloud processing did not return a result.');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      captureServerError(error, {
        event: 'project.cloud_batch.failed',
        projectId,
        phase: 'workflow_running',
        details: {
          itemCount: executionItems.length,
          hdrItemIds: executionItems.map((executionItem) => executionItem.hdrItem.id)
        }
      });
      for (const executionItem of executionItems) {
        this.failWorkflowItem(projectId, executionItem.hdrItem, message);
      }
    }
  }

  private async workflowBatchWorker(
    projectId: string,
    queue: AsyncQueue<WorkflowQueueItem[]>,
    taskExecution: TaskExecutionRunContext
  ) {
    while (true) {
      const queuedItems = await queue.shift();
      if (!queuedItems) {
        return;
      }

      await this.processWorkflowBatch(projectId, queuedItems, taskExecution);
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
