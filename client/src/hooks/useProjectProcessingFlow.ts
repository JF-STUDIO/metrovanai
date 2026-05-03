import {
  applyHdrLayout,
  isDirectUploadIntegrityError,
  patchProject,
  retryFailedProcessing,
  startProcessing,
  uploadFiles,
  type FailedUploadFile,
  type UploadPauseController,
  type UploadProgressSnapshot,
  type UploadedObjectReference
} from '../api';
import type { MutableRefObject } from 'react';
import type { UiLocale } from '../app-copy';
import { getUserFacingErrorMessage, isInsufficientCreditsError, type FailedUploadEntry } from '../app-utils';
import type { LocalHdrItemDraft, LocalImportDraft } from '../local-import';
import type { HdrItem, ProjectRecord } from '../types';
import {
  buildHdrLayoutPayload,
  collectLocalHdrItemFiles,
  getLocalFileUploadIdentity,
  getUploadedObjectsForFiles,
  getUploadReferenceIdentity,
  mergeUploadedObjectReferences
} from '../upload-flow';

interface ProcessingFlowCopy {
  importPhotosFirst: string;
  uploadOriginalsDoNotClose: string;
  uploadOriginalsReceived: string;
  uploadOriginalsCanClose: string;
  startProcessingFailed: string;
}

interface UseProjectProcessingFlowInput {
  activeLocalDraft: LocalImportDraft | null;
  billingSummary: { availablePoints: number } | null;
  copy: ProcessingFlowCopy;
  currentProject: ProjectRecord | null;
  failedUploadFiles: FailedUploadEntry[];
  getProcessingCreditRequirement: () => number;
  locale: UiLocale;
  openRechargeForInsufficientCredits: (requiredPoints: number, availablePoints: number) => void;
  refreshBilling: () => Promise<{ summary: { availablePoints: number } } | null>;
  resetUploadPause: () => void;
  setBusy: (busy: boolean) => void;
  setFailedUploadFiles: (files: FailedUploadEntry[]) => void;
  setMessage: (message: string) => void;
  setUploadActive: (active: boolean) => void;
  setUploadMode: (mode: 'local' | 'originals' | null) => void;
  setUploadPercent: (percent: number) => void;
  setUploadSnapshot: (snapshot: UploadProgressSnapshot | null) => void;
  updateLocalImportDraft: (projectId: string, updater: (draft: LocalImportDraft) => LocalImportDraft) => void;
  uploadAbortControllerRef: MutableRefObject<AbortController | null>;
  uploadPauseControllerRef: MutableRefObject<UploadPauseController>;
  upsertProject: (project: ProjectRecord) => void;
  workspaceHdrItems: HdrItem[];
}

export function useProjectProcessingFlow({
  activeLocalDraft,
  billingSummary,
  copy,
  currentProject,
  failedUploadFiles,
  getProcessingCreditRequirement,
  locale,
  openRechargeForInsufficientCredits,
  refreshBilling,
  resetUploadPause,
  setBusy,
  setFailedUploadFiles,
  setMessage,
  setUploadActive,
  setUploadMode,
  setUploadPercent,
  setUploadSnapshot,
  updateLocalImportDraft,
  uploadAbortControllerRef,
  uploadPauseControllerRef,
  upsertProject,
  workspaceHdrItems
}: UseProjectProcessingFlowInput) {
  async function handleStartProcessing(options: { retryFailed?: boolean; retryUploadFileIdentity?: string } = {}) {
    if (!currentProject) return;
    if (!workspaceHdrItems.length) {
      setMessage(copy.importPhotosFirst);
      return;
    }

    setBusy(true);
    try {
      if (!options.retryFailed) {
        const requiredPoints = getProcessingCreditRequirement();
        let availablePoints = billingSummary?.availablePoints ?? null;
        const refreshedBilling = await refreshBilling().catch(() => null);
        availablePoints = refreshedBilling?.summary.availablePoints ?? availablePoints;
        if (availablePoints !== null && requiredPoints > availablePoints) {
          openRechargeForInsufficientCredits(requiredPoints, availablePoints);
          return;
        }
      }

      if (activeLocalDraft) {
        const projectId = currentProject.id;
        const retryUploadFileIdentity = options.retryUploadFileIdentity;
        resetUploadPause();
        let failedUploadBuffer = retryUploadFileIdentity
          ? failedUploadFiles.filter((file) => file.fileIdentity !== retryUploadFileIdentity)
          : [];
        if (!retryUploadFileIdentity) {
          setFailedUploadFiles([]);
        }
        const uploadHdrItems = retryUploadFileIdentity
          ? activeLocalDraft.hdrItems.filter((item) =>
              collectLocalHdrItemFiles(item).some((file) => getLocalFileUploadIdentity(file) === retryUploadFileIdentity)
            )
          : activeLocalDraft.hdrItems;
        if (retryUploadFileIdentity && !uploadHdrItems.length) {
          setFailedUploadFiles(failedUploadBuffer);
          setMessage(locale === 'en' ? 'That file is no longer in this project.' : '这个文件已不在当前项目里。');
          return;
        }
        let uploadedObjects = [...(activeLocalDraft.uploadedObjects ?? [])];
        const completedFileIdentities = new Set(
          uploadedObjects.map((uploaded) => getUploadReferenceIdentity(uploaded))
        );
        const uploadTotalGroups = Math.max(1, uploadHdrItems.length);
        const isHdrItemUploaded = (hdrItem: LocalHdrItemDraft) => {
          const groupFiles = collectLocalHdrItemFiles(hdrItem);
          return (
            groupFiles.length > 0 &&
            groupFiles.every((file) =>
              completedFileIdentities.has(getUploadReferenceIdentity({ originalName: file.name, size: file.size }))
            )
          );
        };
        const completedHdrItemIds = new Set(
          uploadHdrItems.filter((hdrItem) => isHdrItemUploaded(hdrItem)).map((hdrItem) => hdrItem.id)
        );
        const filesByUploadIdentity = new Map<string, File>();
        const uploadIdentityToHdrItemId = new Map<string, string>();
        for (const hdrItem of uploadHdrItems) {
          const groupFiles = collectLocalHdrItemFiles(hdrItem);
          for (const file of groupFiles) {
            if (retryUploadFileIdentity && getLocalFileUploadIdentity(file) !== retryUploadFileIdentity) {
              continue;
            }
            const identity = getLocalFileUploadIdentity(file);
            if (!filesByUploadIdentity.has(identity)) {
              filesByUploadIdentity.set(identity, file);
              uploadIdentityToHdrItemId.set(identity, hdrItem.id);
            }
          }
        }
        const uploadFilesForRun = Array.from(filesByUploadIdentity.values());
        const updateAggregateUploadProgress = (
          stage: UploadProgressSnapshot['stage'] = 'uploading',
          details: Pick<Partial<UploadProgressSnapshot>, 'currentFileName' | 'attempt' | 'maxAttempts' | 'offline'> = {},
          percentOverride?: number
        ) => {
          const uploadedGroups = Math.min(uploadTotalGroups, completedHdrItemIds.size);
          const percent =
            stage === 'completed'
              ? 100
              : percentOverride === undefined
                ? Math.max(1, Math.min(99, Math.round((uploadedGroups / uploadTotalGroups) * 100)))
                : Math.max(1, Math.min(99, Math.round(percentOverride)));
          setUploadPercent(percent);
          setUploadSnapshot({
            stage,
            percent,
            uploadedFiles: uploadedGroups,
            totalFiles: uploadTotalGroups,
            ...details
          });
        };
        const uploadAbortController = new AbortController();
        uploadAbortControllerRef.current = uploadAbortController;
        const rememberUploadedObject = (uploaded: UploadedObjectReference) => {
          uploadedObjects = mergeUploadedObjectReferences(uploadedObjects, [uploaded]);
          completedFileIdentities.add(getUploadReferenceIdentity(uploaded));
          updateLocalImportDraft(projectId, (draft) => ({
            ...draft,
            uploadStatus: 'uploading',
            uploadedObjects: mergeUploadedObjectReferences(draft.uploadedObjects, [uploaded])
          }));
        };
        const rememberFailedUploadFile = (failed: FailedUploadFile) => {
          const hdrItemId = uploadIdentityToHdrItemId.get(failed.fileIdentity) ?? '';
          const entry: FailedUploadEntry = { ...failed, hdrItemId };
          failedUploadBuffer = [...failedUploadBuffer.filter((item) => item.fileIdentity !== failed.fileIdentity), entry];
          setFailedUploadFiles(failedUploadBuffer);
        };
        setUploadActive(true);
        setUploadMode('originals');
        const initialUploadPercent = Math.max(1, Math.min(99, Math.round((completedHdrItemIds.size / uploadTotalGroups) * 100)));
        setUploadPercent(initialUploadPercent);
        setUploadSnapshot({
          stage: 'preparing',
          percent: initialUploadPercent,
          uploadedFiles: Math.min(uploadTotalGroups, completedHdrItemIds.size),
          totalFiles: uploadTotalGroups
        });
        setMessage(copy.uploadOriginalsDoNotClose);

        const uploadStep = await patchProject(projectId, { currentStep: 3, status: 'uploading' }).catch(() => null);
        if (uploadStep?.project) {
          upsertProject(uploadStep.project);
        }

        updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'uploading' }));

        if (uploadFilesForRun.length) {
          const existingUploadsForRun = getUploadedObjectsForFiles(uploadedObjects, uploadFilesForRun);
          try {
            const uploadResponse = await uploadFiles(projectId, uploadFilesForRun, (_percent, snapshot) => {
              const stage =
                snapshot?.stage === 'paused' ||
                snapshot?.stage === 'retrying' ||
                snapshot?.stage === 'verifying' ||
                snapshot?.stage === 'preparing'
                  ? snapshot.stage
                  : 'uploading';
              updateAggregateUploadProgress(
                stage,
                {
                  currentFileName: snapshot?.currentFileName,
                  attempt: snapshot?.attempt,
                  maxAttempts: snapshot?.maxAttempts,
                  offline: snapshot?.offline
                },
                snapshot?.percent
              );
            }, {
              signal: uploadAbortController.signal,
              completedObjects: existingUploadsForRun,
              onFileUploaded: rememberUploadedObject,
              onFileFailed: rememberFailedUploadFile,
              pauseController: uploadPauseControllerRef.current,
              continueOnFileError: true
            });
            uploadedObjects = mergeUploadedObjectReferences(
              uploadedObjects,
              'directUploadFiles' in uploadResponse ? uploadResponse.directUploadFiles : getUploadedObjectsForFiles(uploadedObjects, uploadFilesForRun)
            );
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              throw error;
            }
            throw error;
          }
        }

        if (retryUploadFileIdentity && !failedUploadBuffer.some((file) => file.fileIdentity === retryUploadFileIdentity)) {
          failedUploadBuffer = failedUploadBuffer.filter((file) => file.fileIdentity !== retryUploadFileIdentity);
          setFailedUploadFiles(failedUploadBuffer);
        }

        for (const hdrItem of uploadHdrItems) {
          const allGroupFiles = collectLocalHdrItemFiles(hdrItem);
          const groupUploads = getUploadedObjectsForFiles(uploadedObjects, allGroupFiles);
          if (groupUploads.length < allGroupFiles.length) {
            continue;
          }
          for (const file of allGroupFiles) {
            completedFileIdentities.add(getUploadReferenceIdentity({ originalName: file.name, size: file.size }));
          }
          completedHdrItemIds.add(hdrItem.id);
        }

        updateAggregateUploadProgress(failedUploadBuffer.length ? 'uploading' : 'finalizing', {}, failedUploadBuffer.length ? undefined : 96);

        if (failedUploadBuffer.length) {
          updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'paused', uploadedObjects }));
          setUploadActive(false);
          setUploadMode(null);
          setUploadSnapshot(null);
          setMessage(
            locale === 'en'
              ? `${failedUploadBuffer.length} file${failedUploadBuffer.length === 1 ? '' : 's'} need retry before processing.`
              : `${failedUploadBuffer.length} 个文件需要重试后才能开始处理。`
          );
          return;
        }

        const completedLayoutResponse = await applyHdrLayout(projectId, buildHdrLayoutPayload(activeLocalDraft, uploadedObjects), {
          mode: 'replace',
          inputComplete: true
        });
        const syncedProject = completedLayoutResponse.project;
        setUploadPercent(100);
        setUploadSnapshot({
          stage: 'completed',
          percent: 100,
          uploadedFiles: uploadTotalGroups,
          totalFiles: uploadTotalGroups
        });
        setMessage(copy.uploadOriginalsReceived);
        upsertProject(syncedProject);
        updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'completed', uploadedObjects }));
        const processingResponse = await startProcessing(projectId);
        upsertProject(processingResponse.project);
        setUploadActive(false);
        setUploadMode(null);
        setUploadPercent(100);
        setUploadSnapshot(null);
        setMessage(copy.uploadOriginalsCanClose);
      } else {
        const response = options.retryFailed
          ? await retryFailedProcessing(currentProject.id)
          : await startProcessing(currentProject.id);
        upsertProject(response.project);
        setMessage('');
      }
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (currentProject) {
          updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'paused' }));
          void patchProject(currentProject.id, { currentStep: 2, status: 'review' })
            .then((response) => upsertProject(response.project))
            .catch(() => {
              // The local draft still keeps uploaded object references; retry can continue after refresh.
            });
        }
        setMessage(locale === 'en' ? 'Upload cancelled. Uploaded files were saved and can be resumed.' : '上传已取消，已上传的文件会保留记录，可继续上传。');
        return;
      }
      if (isDirectUploadIntegrityError(error) && currentProject) {
        updateLocalImportDraft(currentProject.id, (draft) => ({
          ...draft,
          uploadStatus: 'paused',
          uploadedObjects: []
        }));
      }
      if (isInsufficientCreditsError(error)) {
        openRechargeForInsufficientCredits(getProcessingCreditRequirement(), billingSummary?.availablePoints ?? 0);
      }
      setMessage(getUserFacingErrorMessage(error, copy.startProcessingFailed, locale));
    } finally {
      uploadAbortControllerRef.current = null;
      resetUploadPause();
      setBusy(false);
    }
  }

  return { handleStartProcessing };
}
